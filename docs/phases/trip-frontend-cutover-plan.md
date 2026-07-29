# Frontend Trip cutover plan (canonical model)

**Status:** PROPOSED — for review before any UI edits. Depends on the `0096–0101`
backend being deployed to production first (PR #10). Nothing here is built yet.

## Goal
Move the visible app from the **container-Place trip model** (a "trip" = a Place with
`category='trip'`, membership via `places.part_of`, itinerary keyed on the place id)
to the **canonical model** (`trips` + `trip_stops` + `place_membership`), and retire
the orphaned date-range scaffolding — so the UI and `trip_stats` agree.

## What the frontend does today (measured)
- **Active model:** `MapView.addTagged('trip')` creates a Place tagged `trip`;
  `PlacePanel` shows members via `part_of` and the itinerary via `TripItinerary`
  keyed on `place.id`; `Trips.tsx`/`Wrapped.tsx` list Places where
  `categories.includes('trip')`. `trip_notes.trip_id`/`trip_timeline(p_trip)` key on
  **`places.id`**.
- **Orphaned (imported by nothing):** `lib/trips.ts` (first-class `trips` table +
  date-range `fetchTripPlaces` + `trip_stats`), `detectTrips`/`resolveSuggestedTrip`.
  Safe to supersede/delete.

## Backend prerequisite — migration `0103` (frontend-enablement; NOT in PR #10) — ✅ DRAFTED + TESTED
The canonical UI passes a `trips.id`, but `0081`'s itinerary keys on a container
`places.id`. `0103` re-points it. Production `trip_notes` has **0 rows**, so the data
migration is trivial. **DECISION 1 resolved: tightened** — `trip_timeline` now resolves
members from explicit `trip_stops` only (member-gated + draft-private), matching
`trip_place_ids`/`trip_stats`. Test: `supabase/tests/0103_trip_notes_timeline.test.sql`.
1. `trip_notes.trip_id`: map any existing rows via `trips.source_place_id`
   (`update trip_notes tn set trip_id = t.id from trips t where t.source_place_id = tn.trip_id`),
   then drop the `→ places(id)` FK and re-add `→ trips(id) on delete cascade`.
2. Rewrite `trip_timeline(p_trip)` to take a **`trips.id`** and resolve member places
   from **`trip_stops`** (the explicit, canonical set) instead of `part_of`/boundary,
   unioning activities + entries on those places by day.
3. `add_trip_note`/`delete_trip_note`: unchanged signatures; `p_trip` is now a trips id.
4. Tests: note round-trips against a `trips.id`; timeline reflects only stopped places.

**DECISION 1 — timeline scope.** Today's `trip_timeline` also pulls activities for any
place inside the trip's spatial boundary (not just explicit members). Canonical =
only places with a `trip_stop`. That's tighter (drops incidental in-boundary activity).
OK to tighten, or keep a boundary fallback? (Recommend: tighten — matches the model.)

## Write path (no new RPCs needed)
`trips` and `trip_stops` both have editor/owner RLS for insert/update/delete, so the
client writes them directly:
- **Create a trip:** insert into `trips` (replaces `createPlace(categories:['trip'])`).
- **Add a stop:** insert into `trip_stops` (planned) / link a `visit_id` (completed)
  (replaces `togglePartOf`/`addMembers` on `places.part_of`).
- **List a trip's places:** `trip_place_ids(trip_id)` RPC (draft-private, already ships
  in `0097`/`0099`). Stats: `trip_stats(trip_id)`.

## Frontend changes, file by file
1. **`lib/trips.ts`** — rewrite as the single canonical trips module: `fetchTrips`
   (from `trips`), `createTrip`, `addStop`/`removeStop` (trip_stops), `fetchTripPlaces`
   (via `trip_place_ids`), `fetchTripStats`. Delete `fetchTripPlaces`'s date-range
   query and the `updatePlace(first_visit=range)` hack in `addPlaceToTrip`.
2. **`lib/types.ts`** — bind `Trip`/`TripStop` to the generated `database.types.ts`
   rows (post-deploy `gen:types`); drop the "compatibility representation" note.
3. **`routes/Trips.tsx`** — list from `fetchTrips()` (the `trips` table), not
   `fetchPlaces().filter(category==='trip')`; rows link to a canonical trip route.
4. **Trip route/detail** — a trip is no longer a Place route (`/place/:id`). Add a
   `/trip/:id` view (or adapt) reading `trips` + `trip_place_ids` + `trip_stats` +
   `trip_timeline`. `TripItinerary` takes a `trips.id`.
5. **`components/PlacePanel.tsx`** — remove the `category==='trip'` branches
   (memberPlaces via `part_of`, the fused "· Trip" visit row, the itinerary embed);
   "Add to a trip" becomes an `add_trip_stop` action, not `togglePartOf`.
6. **`routes/MapView.tsx`** — `addTagged('trip')` creates a `trips` row + navigates to
   `/trip/:id` (not a Place).
7. **`routes/Wrapped.tsx`, `routes/DayView.tsx`, `routes/AttentionDashboard.tsx`,
   `lib/categories.ts`** — count/label trips from `trips`; the "tie to a trip" picker
   offers `trips`, not `category==='trip'` Places.
8. **`lib/data.ts`** — `detectTrips`/`resolveSuggestedTrip` and the `detect-trips` edge
   function write **draft `trips`** (via `source_place_id` provenance), not container
   Places. (Coordinate with the edge-function owner — Codex's rotation touches
   `detect-trips`.)

## Sequencing
1. Deploy `0096–0101` to prod (PR #10 runbook). → `gen:types` → commit types.
2. Land + deploy `0103` (trip_notes/timeline re-point). → `gen:types` → commit types.
3. Frontend edits above, verified on the disposable stack + a preview; keep the old
   container-Place trips readable during transition (they carry `source_place_id`).
4. Data cleanup (later): once the UI is canonical, retire `places.category='trip'`
   containers + `part_of` (ADR's `part_of` retirement).

## Open decisions for Erica
- **DECISION 1** (timeline scope, above).
- **DECISION 2 — trip route.** New `/trip/:id` view, or keep trips rendering through
  the Place card shell for now? (Recommend a dedicated `/trip/:id` — a trip isn't a
  Place.)
- **DECISION 3 — id-space migration.** Existing deep links `/place/:containerId` for
  the 33 old trips: redirect to `/trip/:newId` (map via `source_place_id`), or leave
  them? (Recommend a redirect shim.)
