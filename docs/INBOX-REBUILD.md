# The Inbox — rebuilding how anything gets named, placed and filled in

Status: **PROPOSAL, not started.** Erica asked for a whole-function redesign rather
than another fix, and for a rule that an approved value is never overwritten.

> "instead of using the Strava name create something that is more accurate…
> make sure after a user approves it in the application, nothing overwrites it.
> Create a place where anything auto-written is logged for approval that suggests
> the name of the place, visit, trail, activity, where it belongs… and photos are
> pulled from phone and/or Google Photos as suggestions."
> "this could be the recent activities page too"

---

## 1. Why the current thing keeps going wrong

Every naming bug so far has the same shape: **a guess was written straight into the
record as though it were a fact, and then something else overwrote it.**

| What happened | Root cause |
|---|---|
| 181 activities called "Morning Walk" | the importer invented a name from the clock and wrote it |
| This morning's hike called "Camp Fraser" | MapTiler returns the nearest *point*; the adjacent Scout camp beat the containing park |
| Trailhead hikes called "SR630", "TR408" | the start point is a car park on a road |
| Places called "-" | MapTiler's placeholder when an address has no house number |
| "Reston Community Storage Lot", "Potomac Interceptor Long Term Odor Abatement Program" | nearest-POI with no plausibility filter |
| A Strava re-sync would restore "Morning Hike" over a corrected name | `name` was treated as a Strava-owned field |

There are already four ad-hoc, inconsistent versions of "don't touch this":
`places.name_locked`, `visits.manual`, `photos.visit_id` (pin), and "only rename
while it still says 'New place'". None of them cover activities, and none of them
record *who* decided or *when*.

**So the rebuild is one idea, applied everywhere: a machine may only ever propose.
A person's decision is the only thing that writes, and it is permanent.**

---

## 2. The model

### 2.1 Two new tables

```sql
-- One proposed change to one field of one record.
create table suggestions (
  id             uuid primary key default gen_random_uuid(),
  subject_type   text not null check (subject_type in ('activity','place','visit','photo')),
  subject_id     uuid not null,
  field          text not null,          -- 'name' | 'place_id' | 'visit_id' | 'is_trip' | 'is_trail'
  current_value  jsonb,                  -- what it was when proposed; detects staleness
  proposed_value jsonb not null,
  label          text not null,          -- "Call this Potomac Heritage Trail"
  source         text not null,          -- 'osm' | 'maptiler' | 'alltrails' | 'exif' | 'google-photos' | 'rule'
  confidence     numeric,                -- 0..1
  evidence       jsonb,                  -- {samples:9, trails:{...}, parks:{...}} — shown on demand
  group_key      text not null,          -- everything about one activity = one card
  rank           int  not null default 0,-- 0 = the recommended option
  status         text not null default 'pending'
                 check (status in ('pending','approved','rejected','superseded','stale')),
  decided_by     uuid references profiles(id),
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);

-- A decision. Permanent. The only thing that blocks an automatic writer.
create table approved_fields (
  subject_type text not null,
  subject_id   uuid not null,
  field        text not null,
  value        jsonb not null,
  approved_by  uuid not null references profiles(id),
  approved_at  timestamptz not null default now(),
  primary key (subject_type, subject_id, field)
);
```

### 2.2 The one guard every writer must pass

```sql
create function may_autowrite(p_type text, p_id uuid, p_field text) returns boolean
  -- false as soon as a person has approved that field
```

Every ingest path, backfill, cron job and geocoder calls this before touching a
field. Nothing else is allowed to write those fields. That is the whole guarantee,
and it is enforceable by a single grep: any `update places set name` /
`update activities set name` that is not behind `may_autowrite` is a bug.

**Migration of the existing locks:** `places.name_locked = true` → an
`approved_fields` row for `(place, id, 'name')`; `visits.manual = true` →
`(visit, id, 'place_id')`. Nothing is dropped — the old columns stay and keep
working — so this is additive and reversible.

### 2.3 What "approve" does

1. writes the value onto the record
2. inserts `approved_fields`
3. marks that suggestion `approved` and every sibling in the group `superseded`
4. never runs again for that field

Rejecting records `rejected`, which the suggester reads so it does not propose the
same thing twice.

---

## 3. The Inbox (a.k.a. Recent Activities) — `/inbox`

One screen. Newest first. One card per thing that wants a look — a new activity, a
place still called "New place", a photo with no home, a visit with no name.

```
┌───────────────────────────────────────────────────────┐
│ Saturday 9 August · Hike · 6.3 mi · 2h 14m            │
│                                                       │
│ WHERE                                                 │
│   ● Potomac Heritage Trail      OSM · 7 of 9 points   │
│   ○ Seneca Regional Park        OSM · contains 4 of 9 │
│   ○ Fraser Preserve             OSM · contains 2 of 9 │
│   ○ somewhere else…                                   │
│                                                       │
│ CALL IT                                               │
│   ● Potomac Heritage Trail                            │
│   ○ ________________________  (your own words)        │
│                                                       │
│ IS IT                                                 │
│   ○ a trip      ● just a visit                        │
│                                                       │
│ PHOTOS FROM THAT DAY — 8 found                        │
│   [▣] [▣] [▢] [▣]      Google Photos 5 · uploads 3    │
│                                                       │
│              [ Looks right ]      [ Skip ]            │
└───────────────────────────────────────────────────────┘
```

- **One button.** "Looks right" approves every selected option on the card at once
  and locks all of them. Skipping leaves it pending; nothing is written.
- **Evidence is visible** ("7 of 9 points"), because a suggestion you can't check is
  just another guess.
- No icons anywhere — text controls only.
- Every photo shown is a real thumbnail, never a placeholder.

---

## 4. The namer, rebuilt

The current namer asks "what is the nearest point of interest to where this
started?" — which is why it answers with car parks and Scout camps. The new one
asks **"where did this route actually go?"**

```
suggest_place_for_route(polyline, start, type):
  1. sample 9 points evenly along the route
  2. ONE Overpass call, which for each sample returns
       - named ways underfoot (path/footway/track/bridleway/cycleway)
       - named areas containing it (leisure=park|nature_reserve,
         boundary=protected_area|national_park, landuse=forest)
  3. a TRAIL carrying >= 50% of the samples wins
       (a long point-to-point crosses several parks; the trail is what you call it)
  4. else the PARK containing the most samples (>= 40%) wins
       (a loop inside one park)
  5. else MapTiler POI, through the plausibility filter
  6. else the town
  → returns the top 3 as SUGGESTIONS with their tallies. Writes nothing.
```

**This is measured against the real routes, not assumed.** Run over 14 of the worst
place names in the database:

| Was called | AllTrails said | Route scoring says | Evidence |
|---|---|---|---|
| Connector | Seneca Regional Park | **Potomac Heritage Trail** | trail 7/9; parks Seneca 4, Fraser Preserve 2 |
| Warren County | SNP — Dickey Ridge | **Dickey Ridge Trail** | trail 7/9; Shenandoah NP 9/9 |
| Shenandoah County | GWNF — Massanutten | **Massanutten Trail** | trail 6/9; GW National Forest 9/9 |
| Top Hill | AT — Bluemont | **Appalachian Trail** | trail 8/9 |
| Locust Valley | AT — South Mountain | **Appalachian National Scenic Trail** | trail 8/9; South Mountain Battlefield 6/9 |
| Clarke County | Sky Meadows State Park | **Appalachian Trail** | trail 9/9; Sky Meadows SP 8/9 |
| Madison | SNP — Old Rag | **Shenandoah National Park** | no single trail; park 9/9 |
| Chesterfield | Pocahontas State Park | **Pocahontas State Park** | park 9/9 — agrees |
| Bern Township | Blue Marsh Lake | **Lake Border Trail** | trail 7/9; Blue Marsh 8/9 |
| Stream Weir | GWNF — Buzzard Rock | **George Washington National Forest** | park 9/9 |
| W&OD | W&OD Trail | **Washington & Old Dominion Trail** | trail 11 |

"Connector" turned out to be a literal OSM way name near the trailhead — exactly the
nearest-point failure. And the tallies show why one park name was never right for it:
the route crosses two.

**Three findings that shape the design, from the same run:**

1. **The trail and the park are both true, and only you know which you want.**
   "Appalachian Trail, 9/9, inside Sky Meadows State Park, 8/9" is one hike with two
   correct names. The scorer must not pick silently — it offers both, ranked, and the
   Inbox is where you say which. That is the strongest argument for the whole design.

2. **Overpass returns nothing for Red Rock / Lake of the Red Rocks — 97 of your
   activities.** There is no OSM park polygon or named path there. The existing place
   name is already right and must simply be kept; a "no suggestion" result has to mean
   *leave it alone*, never *blank it*.

3. **Overpass 504'd on one of fourteen calls.** The public instance is best-effort.
   Ingest therefore needs retry with backoff, a MapTiler fallback, and — because a
   suggestion is not a fact — the freedom to fail quietly and try again later.

### Why Overpass and not a bulk OSM load

The licensing research settled this. Live Overpass lookups that yield **names** are
"insubstantial extracts" under the ODbL Geocoding Guideline — no share-alike, no
obligation to publish anything, and they may be stored alongside our own data
freely. Bulk-loading park polygons into PostGIS would instead create a *Derivative
Database* (systematic, >100 features), which is defensible but needs care. Live
queries avoid the question entirely, need no key, and are always current.

**One obligation we must meet either way:** the app has to show
`© OpenStreetMap contributors`, linked to `openstreetmap.org/copyright`, visible
without interaction — map corner or About screen. Individual records need no
attribution. *This is currently missing and is a genuine compliance gap.*

### AllTrails — what it can and cannot do here

AllTrails is available to me through the Claude connector, **not as a server API**.
So the edge function cannot call it. What it *can* do:

- I can run it in bulk, on demand, for backfills and for hard cases (it is what
  resolved 25 junk place names today: Valley of Fire, Sky Meadows, Pocahontas,
  Lost River, Blue Marsh, Mount Erie, Watkins Glen, Morven Park…).
- Its `location_label` is the single best "which park is this" signal I have found.
- For live ingest, Overpass is the automatic source and AllTrails is a manual
  enrichment pass. Making it automatic needs an AllTrails API agreement.

I should not pretend otherwise, so the design does not depend on it.

---

## 5. Photo suggestions

For each activity/visit card, propose photos from three places:

| Source | How | Status |
|---|---|---|
| **Already uploaded** | `photos` with the same local date, within ~5 km, not yet on a visit | works today |
| **Google Photos** | `mediaItems.search` over that day's range | OAuth now connects (the CSP fix landed); picker still unproven end-to-end |
| **The phone** | the nightly iOS Shortcut is the mechanism | works today |

**An honest limit:** a web app cannot read the camera roll directly — there is no
browser API for it. "Pull photos from the phone" therefore means the Shortcut
upload plus Google Photos. If you want true on-device suggestion, that arrives with
the native app (§7), not before.

Approving photos on a card pins them to the visit and **keeps their real dates** —
your existing rule, unchanged.

---

## 6. Something you need to decide about Strava

The research turned up a problem that changes the plan, so I am flagging it rather
than building around it silently.

**Strava's API Policy, effective 1 June 2026:**
- **§6.2** — no retention of Strava data beyond 7 days
- **§5.7** — no storing geographic location data
- **§5.3** — no use of Strava data for AI / embeddings / RAG

The entire map is stored coordinates from Strava activities. Under a strict reading,
the current design is not compliant, and the AI features you have asked for are
specifically excluded.

**The mitigation is undramatic:** 265 of your 445 activities already came in by file
import, not the API. Strava supports a full bulk export. Moving to export + Garmin
`.fit` + direct file import makes the data *yours*, removes the retention clock,
removes the AI restriction, and removes a dependency that would block an App Store
release. The cost is that new activities stop appearing automatically within
seconds; they arrive on whatever cadence you export, unless Garmin Connect is wired
up as the live path instead.

I have not changed anything about Strava ingest. This is your call, and it should be
made before the commercial build, not after.

---

## 7. Order of work

Each step is shippable on its own and nothing is removed at any point.

| # | Step | Why first |
|---|---|---|
| 1 | `suggestions` + `approved_fields` + `may_autowrite`, migrate the existing locks | the guarantee everything else leans on |
| 2 | Route-scoring namer as an edge function returning suggestions | proven; kills the whole class of bug |
| 3 | `/inbox` page — one card, one button, evidence visible | the thing you actually asked for |
| 4 | Put every existing writer behind `may_autowrite` | closes the overwrite hole for good |
| 5 | Photo suggestions on the card (uploads → Google Photos) | needs 3 to exist |
| 6 | Backfill: re-suggest the ~40 weakest place names through the route scorer | cleans up history through the same door |
| 7 | OSM attribution in the UI | compliance, small |
| 8 | Strava decision (§6) | blocks the commercial build |

**Deferred, deliberately:** future plans + invites (designed, waiting), the
integrations marketplace, native apps, and the Memories redesign — you asked to plan
that look with you first, and that is still open.

---

## 8. What already landed today (not part of this proposal)

- All **328** clock-reading activity names replaced with real place names; zero
  remain. Snapshot: `supabase/snapshots/2026-08-09-activity-names-before-rename.json`.
- **25** junk place names resolved via AllTrails (counties, townships, road names).
- Migration `0147` — an activity is named after where it happened; a name a person
  wrote is never touched; a Strava re-sync can no longer restore "Morning Hike".
- A plausibility filter on geocoder results ("-", storage lots, odor abatement).

These are consistent with the design above — §4 replaces the *source* of the
suggestion, and §2 puts the approval gate in front of it.
