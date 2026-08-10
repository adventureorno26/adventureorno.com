# AdventureOrNo — what this is, and what is left to build

**This is the only planning document.** Everything else in `docs/archive/` is history.
If a plan is not written here, it is not the plan. If this file and any other document
disagree, this file wins.

Last updated: 2026-08-10.

---

## 1. What the app is

A private map of everywhere Erica and Josh have been, built automatically from photos,
phone location and Strava — so that **going somewhere is enough to have it recorded**.
No data entry as the price of admission.

It answers one question well: *where have we been, when, together or apart, and what did
it look like.*

It is invite-only, has no public pages, and it is the prototype for a commercial
multi-tenant product ("Spaces").

---

## 2. The one model

Every screen should express the same shape:

> **Place → Visits → The day**

- A **place** is somewhere you went. It **counts once**, however many times you go.
- A **container** is a place that holds other places: a trail, a trip, a city, a region.
  The Appalachian Trail holds Maryland Heights and Bear's Den. A container appears
  **once** and lists each **section once**.
- A **visit** is one date at a place. Visits **count every time**.
- **The day** is what actually happened: photos, the activity, the route, the note, who
  was there.

**Opening a container gives its sections. Opening a section gives its dates. Opening a
date gives the card.** That is the design — the Sections area Erica already likes — and
it applies to trails, trips, cities and regions alike, not just trails.

Attribution (just me / just Josh / both) lives on the **visit**, never on the place: the
same place can be solo one time and shared the next.

### The rule the ingest rebuild exists to enforce

> **A machine may only propose. A person's decision writes, and it is permanent.**

Two corollaries:
- **An edit in the app IS an approval.** Never ask her to confirm the same thing twice.
- **"No suggestion" means leave it alone.** Never blank a value because the machine had
  nothing to offer.

---

## 3. What you can do — ONE place

The page formerly called Inbox is renamed **Edit**, and it absorbs every kind of data
work:

| Function | What it means |
|---|---|
| **Add** | a place, a visit, an activity, by hand |
| **Import** | Google Photos (guess the location from the photo's own coordinates, then let her correct it), file upload, Strava, the phone |
| **Ingest** | what arrives automatically — proposed for approval, never written as fact |
| **Sort** | photos into places and visits, with the location editable **right there** |
| **Edit** | names, locations, dates, who was there, categories, ratings |
| **Organize** | sections into trails, places into trips and cities, merges |
| **Delete** | with undo |
| **Fix** | duplicates, unnamed, unplaced — anything needing attention |

`/photos/sort`, `/attention` and the Settings → Data grid **fold into Edit and stop
existing separately**. `/places/edit` survives **only** as the bulk spreadsheet, because
editing 149 rows at once is a genuinely different job.

Nothing gets added *beside* this page. Things get removed *into* it.

### Interface rules (hers, non-negotiable)

- **No icons.** Text controls only. Emoji reactions on photos are the one exception.
- **Every map marker is a photo.**
- Evidence on the face of a card — "underfoot at 7 of 9 route points". A suggestion you
  cannot check is just another guess.
- **Transient UI must be transient**: the upload box and "finish importing your Google
  Photos" disappear when they are done.
- One door per action. Not three ways to Add.
- Batch changes and deploy once. No rapid deploys.
- Her recorded distances are the truth. Strava and AllTrails may never overwrite them.

---

## 4. Where the build actually is

### Live and working
- Map, places, visits, photos, videos, activities, trips-as-marked-visits, bucket list,
  timeline, stats with per-person attribution, races, peaks, elevation, weather.
- Strava, file import, phone ingest, Google Photos import.
- **The ingest rebuild, all 8 steps**: the `suggestions` / `approved_fields` ledger,
  `may_autowrite`, the route scorer (OpenStreetMap, measured against 13 real routes),
  the review page, the guard on every machine writer, learned naming rules, photo
  suggestions, and OSM attribution.
- Offline mode (service worker, network-first HTML, immutable assets cached).
- The authz matrix, and anon holding no table grants.
- Accessibility: zero WCAG A/AA violations across the authed routes, nothing allowlisted.

### Broken or wrong right now
1. **The map is blank.** MapTiler suspended the account for exceeding quota. Root cause
   found: the idle globe auto-rotate had **no stop condition** — it panned ~7°/second
   for as long as a tab stayed open, streaming tiles for hours. Now bounded to 45s and
   never while hidden, but **unverified**, because tiles cannot load to prove it.
2. **Containers are invisible in Places** — `app/src/lib/data.ts:443` filters out
   anything with `holds_children`, so the Appalachian Trail vanished while its sections
   remained. A stats rule ("containers don't count twice") leaked into visibility.
3. **Sections repeat.** The trail card renders one row per outing, so "Maryland Heights"
   appears 9 times instead of once-with-9-dates.
4. **Data work is scattered** across six screens with different words for the same thing.
5. **Three doors to Add**: nav tab, map button, `/add` redirect.
6. **Transient UI is not transient** (upload box, "finish importing").
7. **Sorting photos cannot edit the location** — removed 2026-07-26, see §7.

---

## 5. The plan

Each phase ends the same way: **it works when Erica drives it**, a test that fails if it
regresses, an entry in `decisions.md`, and this file updated. Not "deployed and probably
fine."

### Phase 0 — One source of truth ✅ (2026-08-10)
This file. Every other planning document moved to `docs/archive/`. The "removed on
purpose" register in §7 exists so nothing is silently lost again.

### Phase 1 — Make erasure impossible
- Build **fails** when a required `VITE_*` is empty. (`VITE_GOOGLE_CLIENT_ID` went
  missing and the Google Photos button silently disappeared — nothing errored.)
- Deploys go through **CI on green**, not by hand. Hand-deploying shipped a live
  regression that CI had already caught.
- An acceptance list for the things she cares about, as tests that fail loudly if a
  feature is removed.

### Phase 2 — Make the model show through
- Containers back in Places, as containers.
- **Sections listed once**, opening to their dates; dates opening to the card.
- Card wording that says what it does ("Add a place here" / "Add existing places" read as
  the same button twice).
- One Add.

### Phase 3 — The one page
Inbox → **Edit**, absorbing add / import / ingest / sort / edit / organize / delete /
fix per §3. Inline location editing. Transient UI that disappears. The other surfaces are
**removed**, not left beside it.

### Phase 4 — A map that cannot be switched off
Decision (2026-08-10): **go straight to self-hosted.**
- Own basemap: Protomaps `.pmtiles` in R2, served through a Worker via HTTP range
  requests. No API key in the client, no per-request quota, **nobody outside can suspend
  it**. Cost is storage + egress, flat and predictable.
- The Worker also gives edge caching, real usage numbers, and a budget guard.
- MapTiler stays as failover only.
- Accepted costs: we own basemap styling and refresh cadence, and OpenStreetMap
  attribution remains required.

### Phase 5 — Commercial readiness
Multi-tenant Spaces, per-tenant quotas, branding, install flows. Two constraints already
established and not negotiable by wishing:
- **Google Photos can no longer answer "photos from that day."** The library scopes were
  removed in March 2025; the Picker returns no GPS and cannot search by date or location.
  Date-based photo suggestion needs the phone, not Google.
- **Strava forbids showing Josh's data to Erica** in the same application. Josh has given
  personal approval, which settles it between them; it does not change Strava's terms for
  a commercial product. The route through it is bulk export as user-owned records — 265
  of 445 activities already arrived that way.

---

## 6. Why work kept getting erased — and what now prevents it

Five mechanisms, all evidenced:

| Mechanism | Fix |
|---|---|
| Six competing "what to do next" documents (~380 KB across ~40 files) | This file, and only this file |
| Removals not recorded as reversible | The register in §7 |
| Hand-deploys bypassing CI | Phase 1 |
| Model rules leaking across layers (`holds_children` → invisible) | Phase 2, plus a test |
| Config vanishing silently (`VITE_GOOGLE_CLIENT_ID`) | Phase 1 build assertion |

---

## 7. Removed on purpose — the register

Anything deliberately removed goes here, with the commit, so it is never mistaken for
lost work and can be restored in minutes.

| What | When | Why | Restore from |
|---|---|---|---|
| Address/place editing in the photo sorter (`PlaceQuickEdit`) | 2026-07-26 | She asked for "JUST THE VISIT INFORMATION" — place-level fields were confusing inside a visit-sorting flow | commit `5bb5b6e`; the component still exists, unused. **She now wants it back (Phase 3).** |
| The `trips` and `trip_stops` tables | 2026-08-08 | A trip is a visit you marked, not a separate object | commit `aa6e553` |
| The 5-step Add wizard | 2026-08-08 | Replaced by one add sheet | commit `fd3004d` |
| Service-worker registration | earlier | A cached shell served stale code | restored 2026-08-10 with HTML network-first |
| `apply_naming_rule(uuid)` (geofence-only) | 2026-08-10 | It could rename 76 activities on start-point alone | migration `0152` |
| "downtown Leesburg, VA" as an Appalachian Trail section | 2026-08-10 | Not on the AT. **The place itself was kept** — it holds 3 photos and 2 visits | membership row only |

---

## 8. Facts that must not be relearned

- **Overpass** rate-limits 2 slots per IP and edge functions share Supabase egress:
  rotate mirrors, hard-abort at 25s, keep batches ≤8.
- **Overpass returns nothing for Red Rock / Lake of the Red Rocks** — 97 activities. No
  suggestion must mean leave it alone.
- **`admin.rpc(...).catch()` is a TypeError** — an rpc() is a thenable, not a Promise.
- **A date-only string parses as UTC midnight** and renders as the previous day west of
  Greenwich. Parse `YYYY-MM-DD` with local components.
- **The app's global input CSS is `display:block; width:100%`** — it makes a radio 238px
  wide. Pin size on any radio or checkbox.
- **MapLibre 6** removed the default export; **Vite 8** removed object `manualChunks` and
  preloads lazy chunks (both put 1 MB of MapLibre back on `/login`).
- **A branch deploy goes to a preview alias**, not production; the alias serves a stale
  `index.html` for a while — verify against the exact deploy-hash URL.
- **`AON_SUPABASE_SECRET_KEY` in `.env.local` is the disabled legacy JWT.** Use
  `SUPABASE_SECRET_KEY`.
- **No local Deno, no psql.** Edge-function pure logic is tested by vitest; SQL tests run
  against production inside a rolled-back transaction — which is **not** equivalent to a
  fresh database, so tests must never assert production row counts.
- **Never** reintroduce the home exclusion zone. **Never** force-push. The service_role
  key is already rotated — do not ask her to rotate it again.

---

## 9. Where things live

- **Model reference:** `docs/SCHEMA.md`
- **Decision history (append-only):** `docs/decisions.md`
- **Agent instructions and business rules:** `CLAUDE.md`
- **Operations:** `docs/MANUAL-SETUP.md`, `docs/backup-restore.md`,
  `docs/deploy-cloudflare.md`, `docs/deploy-photo-gateway.md`, `docs/ios-shortcut-*.md`
- **History:** `docs/archive/`, `docs/adr/`

Superseded and **not** to be worked from, even though they live outside this repo:
`../CLAUDE-CODE-INSTRUCTIONS-2-70.md`, `../AdventureOrNo-private-originals/NewClaude.md`.
