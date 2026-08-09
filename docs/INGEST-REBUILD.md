# Rebuilding ingest: nothing is written until you say so

Status: **DESIGN, not started.** Supersedes the fix-by-fix approach.
Scope: **ingest only** — how an activity, place, visit or photo gets named, placed
and filled in. Not Memories (still parked, and you asked to plan that look together).

> "instead of using the Strava name create something that is more accurate…
> make sure after a user approves it in the application, nothing overwrites it.
> Create a place where anything auto-written is logged for approval that suggests
> the name of the place, visit, trail, activity, where it belongs… and photos are
> pulled from phone and/or Google Photos as suggestions."
> "this could be the recent activities page too"

---

## 1. Why the current thing keeps going wrong

Every naming bug has had the same shape: **a guess was written into the record as
though it were a fact, and then something else overwrote it.**

| What happened | Root cause |
|---|---|
| 181 activities called "Morning Walk" | the importer invented a name from the clock and wrote it |
| Today's hike called "Camp Fraser" | MapTiler returns the nearest *point*; an adjacent Scout camp beat the containing park |
| Trailhead hikes called "SR630", "TR408" | the start point is a car park on a road |
| Places called "-" | MapTiler's placeholder when an address has no house number |
| "Reston Community Storage Lot", "Potomac Interceptor Long Term Odor Abatement Program" | nearest-POI with no plausibility filter |
| A Strava re-sync would restore "Morning Hike" over a fix | `name` was treated as a Strava-owned field |
| Hikes filed under Elizabeth Furnace that were never there | placement written silently, no way to see or undo it |

There are already four inconsistent, partial versions of "don't touch this":
`places.name_locked`, `visits.manual`, `photos.visit_id` (pin), and "only rename
while it still says 'New place'". None cover activities. None record who decided,
or when, or why. So there is nothing to trust and nothing to audit.

---

## 2. The one rule

> **A machine may only propose. A person's decision writes, and it is permanent.**

Two corollaries that make it practical:

- **A person's edit in the UI *is* an approval.** Renaming a place on its card
  doesn't just set the name — it locks it. You should never have to approve the
  same thing twice, once in the editor and again in a queue.
- **"No suggestion" means leave it alone.** Never blank a value because the
  machine had nothing. (Red Rock has no OSM polygon — see §5.4.)

---

## 3. Data model

### 3.1 `suggestions` — one proposed change to one field

```sql
create table public.suggestions (
  id             uuid primary key default gen_random_uuid(),
  subject_type   text not null check (subject_type in ('activity','place','visit','photo')),
  subject_id     uuid not null,
  field          text not null,           -- 'name' | 'place_id' | 'visit_id' | 'is_trip' | 'is_trail'
  current_value  jsonb,                   -- value when proposed; detects staleness
  proposed_value jsonb not null,
  label          text not null,           -- "Call this Potomac Heritage Trail"
  source         text not null,           -- 'osm' | 'maptiler' | 'alltrails' | 'exif'
                                          -- | 'google-photos' | 'rule' | 'strava'
  confidence     numeric check (confidence between 0 and 1),
  evidence       jsonb,                   -- {samples:9, trails:{...}, parks:{...}}
  group_key      text not null,           -- everything about one activity = one card
  rank           int not null default 0,  -- 0 = recommended
  status         text not null default 'pending'
                 check (status in ('pending','approved','rejected','superseded','stale')),
  decided_by     uuid references public.profiles(id),
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);

-- The queue read: what still needs a look, newest first.
create index suggestions_pending_idx
  on public.suggestions (created_at desc)
  where status = 'pending';

create index suggestions_group_idx on public.suggestions (group_key);
create index suggestions_subject_idx on public.suggestions (subject_type, subject_id, field);

-- NEVER PROPOSE THE SAME THING TWICE. A rejected suggestion keeps its row, so the
-- suggester cannot re-offer what you already turned down.
create unique index suggestions_no_repeats_idx
  on public.suggestions (subject_type, subject_id, field, md5(proposed_value::text))
  where status in ('pending','rejected');
```

### 3.2 `approved_fields` — the decision. Permanent.

```sql
create table public.approved_fields (
  subject_type text not null check (subject_type in ('activity','place','visit','photo')),
  subject_id   uuid not null,
  field        text not null,
  value        jsonb not null,
  approved_by  uuid not null references public.profiles(id),
  approved_at  timestamptz not null default now(),
  via          text not null default 'inbox',  -- 'inbox' | 'edit' | 'rule' | 'backfill'
  primary key (subject_type, subject_id, field)
);
```

There is deliberately **no delete cascade from a rule change and no expiry**. The
only way a lock goes away is a person explicitly clearing it (§8, "Change my mind").

### 3.3 `naming_rules` — what it learns from you

You do the same walk constantly: 64 activities at Lake of the Red Rocks, 33 at Red
Rock Regional Park, 36 on the W&OD. After you approve the same name for the same
area a few times, it should stop asking.

```sql
create table public.naming_rules (
  id            uuid primary key default gen_random_uuid(),
  center        geography(Point,4326),   -- geofence…
  radius_m      int check (radius_m between 50 and 20000),
  place_id      uuid references public.places(id) on delete cascade,  -- …or an existing place
  activity_type text,                    -- null = any type
  name          text not null,
  learned_from  int not null default 0,  -- how many approvals taught it
  auto_apply    boolean not null default false,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  check (center is not null or place_id is not null)
);
create index naming_rules_center_idx on public.naming_rules using gist (center);
```

A rule that `auto_apply`s still writes a `suggestions` row with
`status='approved', source='rule'` — so every automatic name remains visible,
attributable and undoable. **Silent automation is what got us here.**

### 3.4 `ingest_runs` — so failures are visible, not mysterious

```sql
create table public.ingest_runs (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,          -- 'strava-webhook' | 'file-import' | 'suggester' | 'backfill'
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           int not null default 0,
  failed       int not null default 0,
  notes        jsonb                   -- {"overpass_504": 1, ...}
);
```

One in fourteen Overpass calls 504'd during testing. Today that would vanish
silently. It should show up as "3 activities couldn't be looked up — retry".

### 3.5 RLS

Every table above: `enable row level security`, member-only select, and
insert/update only through the SECURITY DEFINER RPCs in §7. `approved_fields`
takes **no client UPDATE or DELETE at all** — changing a decision goes through
`clear_approval()`, which is audited.

---

## 4. The guard, and who it applies to

```sql
create function public.may_autowrite(p_type text, p_id uuid, p_field text)
returns boolean language sql stable as $$
  select not exists (
    select 1 from public.approved_fields
     where subject_type = p_type and subject_id = p_id and field = p_field);
$$;
```

I inventoried the database: **31 functions write to `places`, `activities`,
`visits` or `photos`.** They split cleanly in two, and the split is the design.

### 4.1 Person-initiated — these APPROVE (write + lock)

You are already deciding when you call these. They must set the value *and* insert
`approved_fields`, so the Inbox never asks again.

`set_place_name` · `update_activity` · `reassign_activity` · `set_visit_place` ·
`set_visit_dates` · `set_visit_is_trip` · `set_visit_note` · `set_photo_visit` ·
`set_photo_caption` · `set_activity_solo` · `set_visit_solo` · `set_place_solo` ·
`set_my_rating` · `set_activity_race` · `merge_places` · `add_to_container` ·
`remove_from_container` · `set_city_boundary`

### 4.2 Machine-initiated — these must ASK (check the guard, or propose)

`import_file_activity` · `cluster_unassigned` · `merge_places_auto` ·
`assign_activity_to_race` · `tag_place_from_entry` · `dedupe_shared_outings` ·
`ensure_visit` · `clear_city` · plus the edge functions `strava-webhook`,
`strava-backfill` (`nameNewPlace`) and `ingest-overland`.

Rule for this group: before writing a field the Inbox owns
(`name`, `place_id`, `visit_id`, `is_trip`, `is_trail`), call `may_autowrite`. If
false, skip. If true, write only when confidence is high; otherwise insert a
suggestion and leave the record alone.

### 4.3 Neither — derived data, always safe to recompute

`recompute_place_stats` · `rebuild_place_visits` · `restore_place` ·
`restore_photo` · `soft_delete_*`. These touch counts, geometry and dates, never a
name or a placement, and stay exactly as they are.

**This is greppable, and that is the point.** After the migration, any
`update public.places set name` or `update public.activities set place_id` outside
group 4.1 that isn't behind `may_autowrite` is a bug a test can catch.

---

## 5. The suggester

### 5.1 The algorithm (measured, not assumed)

```
suggest_for_route(polyline, start_point, activity_type):
  1. sample 9 points evenly along the route
  2. ONE Overpass call: for each sample return
       - named ways underfoot        (path|footway|track|bridleway|cycleway|steps)
       - named areas containing it   (leisure=park|nature_reserve|recreation_ground,
                                      boundary=protected_area|national_park,
                                      landuse=forest)
  3. TRAIL carrying >= 50% of samples  -> rank 0
  4. PARK containing >= 40% of samples -> rank 1  (or rank 0 if no trail won)
  5. any other park/trail seen         -> rank 2+
  6. nothing from OSM -> MapTiler POI through the plausibility filter
  7. still nothing -> propose NOTHING and leave the record alone
```

### 5.2 It works, on the real routes

| Was called | Route scoring says | Evidence |
|---|---|---|
| Connector | **Potomac Heritage Trail** | trail 7/9; parks Seneca 4, Fraser Preserve 2 |
| Warren County | **Dickey Ridge Trail** | trail 7/9; Shenandoah NP 9/9 |
| Shenandoah County | **Massanutten Trail** | trail 6/9; GW National Forest 9/9 |
| Top Hill | **Appalachian Trail** | trail 8/9 |
| Locust Valley | **Appalachian National Scenic Trail** | trail 8/9; South Mountain Battlefield 6/9 |
| Clarke County | **Appalachian Trail** | trail 9/9; Sky Meadows SP 8/9 |
| Madison | **Shenandoah National Park** | no single trail; park 9/9 |
| Chesterfield | **Pocahontas State Park** | park 9/9 |
| Bern Township | **Lake Border Trail** | trail 7/9; Blue Marsh 8/9 |
| Stream Weir | **George Washington National Forest** | park 9/9 |
| W&OD | **Washington & Old Dominion Trail** | trail 11 |

"Connector" was a literal OSM way name near the trailhead — the nearest-point
failure exactly. The tallies also show why one park name was never right for it:
the route crosses two.

### 5.3 The trail and the park are both true

"Appalachian Trail 9/9, **inside** Sky Meadows State Park 8/9" is one hike with two
correct names. The scorer must not choose silently. It offers both, ranked, and you
pick — once — and then §3.3 learns it.

This single finding is the best argument for the whole design.

### 5.4 When it has nothing — the Red Rock case

Overpass returns **nothing** for Red Rock / Lake of the Red Rocks. That is **97 of
your activities**, your most-used place. There is no OSM park polygon or named path
there, and the names you already have are correct.

So: no suggestion, no write, no card. A suggester that "helpfully" replaced a good
name with a town would be worse than the bug it fixed.

### 5.5 When it fails — the 504

One call in fourteen returned `504 Gateway Timeout`. The public Overpass endpoint is
best-effort. Therefore: 3 retries with backoff, then MapTiler, then give up and
record it in `ingest_runs`. Because a suggestion is not a fact, **failing is cheap** —
nothing is wrong in the database, it just gets retried later.

### 5.6 Where it runs

A new Deno edge function `suggest`, called (a) at the end of Strava/file ingest,
(b) by a nightly sweep over records with no `approved_fields` row, (c) on demand
from the Inbox ("look again"). It writes only to `suggestions`.

### 5.7 AllTrails — honest scope

AllTrails reaches me through the Claude connector, **not as a server API**, so the
edge function cannot call it. It is the best "which park is this" signal I have —
it resolved 25 junk names today — but it stays a **manual enrichment pass I run in
bulk**, not part of automatic ingest. Making it automatic needs an API agreement.
The design does not depend on it.

### 5.8 OpenStreetMap licensing — settled, with one gap

Live Overpass lookups returning **names** are "insubstantial extracts" under the
ODbL Geocoding Guideline: no share-alike, nothing to publish, and results may be
stored beside our own data. Bulk-loading park polygons into PostGIS would instead
create a *Derivative Database* — defensible but needing care. Live queries avoid the
question, need no key, and are always current.

**Gap to close:** the app must display `© OpenStreetMap contributors`, linked to
`openstreetmap.org/copyright`, visible without interaction (map corner or About).
Individual records need no attribution. This is currently missing.

---

## 6. Photo suggestions

For each activity/visit card, propose photos from three places:

| Source | Mechanism | Status |
|---|---|---|
| **Already uploaded** | `photos` with the same local date, within ~5 km, not yet on a visit | works today |
| **Google Photos** | search that day's date range | OAuth connects since the CSP fix; **picker unproven end-to-end** |
| **The phone** | the nightly iOS Shortcut upload | works today |

Approving pins them to the visit and **keeps their real dates** — your rule,
unchanged. A photo suggestion is just a suggestion with
`subject_type='photo', field='visit_id'`, so it inherits approval and locking for
free.

**An honest limit.** A web app cannot read your camera roll; there is no browser
API. "Photos from the phone" means the Shortcut plus Google Photos until there is a
native app. I would rather say that now than build toward something that can't work.

---

## 7. The RPC surface

```sql
inbox(p_limit int, p_cursor timestamptz) -> jsonb   -- cards, newest first
  -- one card = the subject + its pending suggestions grouped by field + photo candidates

approve_card(p_group_key text, p_choices jsonb) -> jsonb
  -- {"name": "<suggestion_id>", "place_id": "<suggestion_id>",
  --  "photos": ["<photo_id>", ...], "custom_name": "..."}
  -- ONE transaction: writes every chosen value, inserts approved_fields for each,
  -- marks siblings superseded, returns an undo token.

skip_card(p_group_key text)                   -- leaves everything pending
reject_suggestion(p_id uuid)                  -- never offer this again
undo_approval(p_token uuid)                   -- restores prior values, clears the locks
clear_approval(p_type text, p_id uuid, p_field text)  -- "actually, keep suggesting"
learn_rule(p_group_key text, p_scope text)    -- "always call routes here X"
inbox_counts() -> jsonb                       -- badge: how many pending
```

`approve_card` being one transaction matters: a half-approved card is exactly the
kind of inconsistency that produced this mess.

---

## 8. The Inbox screen — `/inbox`

Also the "recent activities" page you asked for; they are the same screen. Reached
from the bottom nav, with a count when something is waiting.

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

Rules:
- **One button finishes a card.** "Looks right" commits every selection at once and
  locks all of them.
- **Evidence is on the face of it** ("7 of 9 points"). A suggestion you can't check
  is just another guess.
- **No icons.** Text controls only.
- **Real thumbnails**, never placeholder boxes.
- **Undo** by snackbar immediately, and every decision stays reversible later via
  `clear_approval`.
- **Skip is free** — nothing is written, the card returns tomorrow.
- **After the 3rd identical approval in one area**, the card offers:
  *"Always call routes here Lake of the Red Rocks?"* → `learn_rule`.

States: loading · empty ("Nothing to review") · error (with retry) · all-done.

A UX research pass is running on triage patterns (one-card vs list, batching,
keyboard/screen-reader flow); it will refine the layout, not the model.

---

## 9. Migrating what already exists

Additive and reversible. Nothing is dropped; the old columns keep working.

1. `places.name_locked = true` → `approved_fields(place, id, 'name', via='backfill')`
   — 60 places today.
2. `visits.manual = true` → `approved_fields(visit, id, 'place_id')`.
3. `photos.visit_id is not null` → `approved_fields(photo, id, 'visit_id')`.
4. The **328 activity names** fixed today: these were machine-written from place
   names, so they are **not** locked — they stay open to a better suggestion from
   the route scorer, which we now know does better on at least 11 of them (§5.2).
5. Seed `naming_rules` from the obvious repeats (Lake of the Red Rocks ×64, Red Rock
   Regional Park ×33, W&OD ×36) — proposed, not auto-applied, so you confirm once.

---

## 10. Testing

Each with a negative control, per house style.

| Test | Must prove |
|---|---|
| `may_autowrite` | false after approval; true before |
| approve → re-ingest | a Strava re-sync does **not** change an approved name |
| person edit = approval | `set_place_name` inserts `approved_fields` |
| no-suggestion case | Red Rock keeps its name; no card, no write |
| Overpass failure | a 504 leaves the record untouched and logs to `ingest_runs` |
| no repeats | a rejected suggestion cannot be re-inserted |
| `approve_card` atomicity | a failure mid-card writes nothing |
| undo | restores prior values *and* removes the locks |
| learned rule | auto-applies, and still leaves an auditable `suggestions` row |
| **negative** | a name a person wrote is never replaced by any path |

---

## 11. Order of work

Each step ships on its own; nothing is removed at any point.

| # | Step | Gate |
|---|---|---|
| 1 | `suggestions`, `approved_fields`, `may_autowrite`, RLS + backfill (§9) | tests in §10 rows 1–3 |
| 2 | `suggest` edge function: route scoring, retries, fallbacks (§5) | reproduces the §5.2 table |
| 3 | `/inbox` — one card, one button, evidence, undo | you can clear a day's activities in under a minute |
| 4 | Put group 4.2 behind the guard; group 4.1 approves | grep test passes |
| 5 | Photo suggestions: uploads → Google Photos | needs 3 |
| 6 | Backfill: re-suggest the weak place names through the scorer | the 11 in §5.2 come back better |
| 7 | `naming_rules` + "always call routes here X" | Red Rock stops asking |
| 8 | OSM attribution in the UI | compliance |

---

## 12. Two things that need your decision

**a) Trail or park, when both are right?** "Appalachian Trail" or "Sky Meadows State
Park"? My default is *the trail if the route mostly follows one, else the park*,
with the other always offered as the second option. Say if you'd rather it went the
other way.

**b) Strava.** Their API Policy effective 1 June 2026 reportedly bans retaining data
beyond 7 days (§6.2), storing geographic location (§5.7), and AI use (§5.3). Your
whole map is stored coordinates. Research is verifying the exact clauses now. If it
holds, it blocks the commercial build, and the fix is moving to bulk export — 265 of
your 445 activities already came in that way. **I have changed nothing about Strava
ingest.**

---

## 13. Already landed today (context, not proposal)

- All **328** clock-reading activity names replaced with real place names; none
  remain. Snapshot: `supabase/snapshots/2026-08-09-activity-names-before-rename.json`.
- **25** junk place names resolved via AllTrails.
- Migration `0147` — an activity is named after where it happened; a name a person
  wrote is never touched; a Strava re-sync can no longer restore "Morning Hike".
- A plausibility filter on geocoder results ("-", storage lots, odor abatement).

These are consistent with the above: §5 replaces the *source* of a suggestion, and
§2 puts the approval gate in front of it.
