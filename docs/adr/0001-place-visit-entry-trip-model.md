# ADR 0001 — Canonical Place / Visit / Entry / Trip model

- **Status:** Proposed — **DECISION NEEDED** (do not implement until approved).
- **Date:** 2026-07-29
- **Scope:** Private two-person family app (Erica owner, Josh editor, children as
  people, viewers reaction-only). No commercial/multi-tenant abstractions.

This ADR defines what our core nouns mean, one creation contract they all use,
and an additive/reversible path to a single canonical hierarchy — so we can safely
refactor `addSpot` and the creation flows afterward. **No behavior or schema
changes are made by this document.**

## Context — what exists today (measured, read-only)

- **Places = 156.** Both leaf places and containers. `holds_children = 45`
  (33 `trip`, 8 `trail`, 4 `city`), `suggested = 24` (auto-detected trip drafts),
  `bucket = 5`.
- **Hierarchy is represented TWICE:** a legacy `places.part_of uuid[]` array
  **and** a `place_membership(child_id, parent_id, created_at)` join table.
  Measured: `place_membership` = **230 rows, all valid** (0 dangling child/parent).
  `part_of` = 237 pairs = the same 230 **plus 7 dangling parent references** to
  places that no longer exist. A `sync_membership_from_part_of` trigger mirrors
  `part_of → place_membership`. So **`place_membership` is already the clean,
  canonical set; `part_of` is redundant and carries the only bad data (7 pairs).**
- **No `trips` table.** "Trip" is modelled as a container **Place** with
  `category='trip'`/`holds_children` (33 of them). Trips therefore currently *are*
  Places — a category error against the intended meaning below.
- **Visits = 533, all derived** (`manual = 0`) by `rebuild_place_visits`
  (consecutive-day islands from photos/activities). Attribution is per-visit
  (`solo_profile`), never per-place.
- **Entries = 2**, both `kind='dining'` — the "entry-as-spot" concept is
  effectively dead. Each entry has a single `place_id` (cannot represent a story
  spanning several places).
- **Activities = 443, all placed** (`place_id` never null). Type-aware placement
  lives in `place_for_activity` (Hike/Bike/Jeep own place ≤300 m; Run ≤1.5 km;
  Walk → enclosing city/region → nearest ≤2 km → geocoded; **never named from the
  activity title**).
- **Creation paths (converging targets):** `AddWizard` (5-step, `/add`),
  `NewPlaceDraft` (map-click modal), `MapView` add menu, `PlacePanel.addSpot`
  ("+ Add a place here" → `createPlace({part_of:[container]})`, **no dedupe**),
  `DayView` (activity reassignment via `reassign_activity`), and imports
  (`place_for_activity`). These use overlapping-but-different logic.

## Intended meanings (authoritative unless code proves a serious conflict)

- **Place** — a durable real-world destination or legitimate geographic container.
- **Visit** — the canonical dated occurrence of ≥1 people at a Place, with
  visit-specific notes/evidence and per-visit attribution.
- **Entry** — a narrative memory referencing Visits/Places/a Trip; **not** an
  alternate representation of a Place or Visit.
- **Trip** — a planning + journal container (planned stops, completed Visits,
  reservations, notes, routes, activities).
- **Activity/route** — movement evidence linked to a Visit or Trip; **never** a
  fake child Place.
- **Media** — evidence attached primarily to a Visit, discoverable via its
  Place/Trip.
- **Parent/child Place** — genuine geographic containment only.
- **"Spot"** — retired as an ambiguous term. It maps to exactly: *create a Place +
  first Visit* (the `addExperience` operation), never a distinct entity.

## Scenario mappings

| # | Scenario | Canonical mapping |
|---|----------|-------------------|
| 1 | New place + first visit | Create leaf **Place** (saved) → one **Visit** (date, people) → attach media to the Visit. |
| 2 | Another visit to an existing place | Reuse **Place** → new **Visit** (separate date island) → media on the new Visit. (Cape Cod every July = distinct Visits.) |
| 3 | Trail inside a park | Park = container **Place**; Trail = container **Place**, child of Park via `place_membership(type='contains')`. Hikes are **Activities** → **Visits** of the trail. |
| 4 | "San Diego walk" regression | A Walk **Activity** must resolve to an existing Place (city/region → nearest → geocoded) and attach as evidence to a **Visit**. It **never** creates a Place, and Place names are **never** derived from an activity title. Blanket re-placement is forbidden. |
| 5 | Future planned stop that later occurs | **Trip** holds a **planned stop** (references a Place, status `planned`). When it happens it becomes a real **Visit** of that Place, linked to the Trip; the stop flips to `completed`. |
| 6 | Indoor / coordinate-free activity | **Activity** with null coords → linked to a **Visit** (if placed) or directly to a **Trip**, flagged `unplaced`; counts in mileage/timeline, **absent from the map**. Never a child Place. |
| 7 | Story spanning several places | One **Entry** linked to multiple Visits/Places (and optionally a Trip) via an `entry_links` table — not a single `place_id`. |

## The one creation contract — `addExperience`

A single typed, transactional, **idempotent** service every creation path calls:

```ts
addExperience({
  clientOpId: string,                     // idempotency key (unique per attempt)
  place: { id: string }                   // reuse an existing Place …
        | { new: { name, lat, lng, admin1?, country?, address?, categories? } }, // … or create one
  relationship?: { parentId: string, type?: 'contains' }, // add to a container (was addSpot's part_of)
  visit?: { startDate: string, endDate?: string, people?: string[] | 'both', note?: string },
  details?: { rating?: number, review?: string, tags?: string[] }, // non-destructive on existing places
  media?: MediaRef[],                     // becomes truthful PENDING upload jobs, NOT in the DB txn
  tripId?: string,                        // optionally attach the visit as a trip stop/visit
}): { placeId: string, visitId?: string, created: {...} }
```

- **Idempotent:** `clientOpId` is recorded; a retry with the same id returns the
  original result instead of creating duplicates (prevents the double-tap / retry
  duplication that blank-record flows cause today).
- **Atomic core:** Place + Visit + attribution + details commit together, or the
  call returns a precise recoverable error. **Media stays a pending job** (it can't
  join a DB transaction) — surfaced truthfully, never reported as "saved" until the
  upload is durably acknowledged.
- **Non-destructive on existing Places:** `details.tags` merge; a Place's existing
  review is never overwritten (matches the current `AddWizard`/`addToExisting`).
- **No blank rows:** nothing is written before the user confirms (fixes map-click
  inserting a place immediately, and `PlacePanel.addSpot`'s dedupe-less create).

**Convergence:** `AddWizard` (already ~90 % this shape) → calls `addExperience`.
`NewPlaceDraft` + map add → `addExperience` (with `place.new`, dedupe → `place.id`).
`PlacePanel.addSpot` → `addExperience({ place:{new|id}, relationship:{parentId} })`
(adds a **membership** row, not a bogus `part_of`, and dedupes first). `DayView`
keeps `reassign_activity` (moves evidence, never creates a Place). Imports call
`place_for_activity` then `addExperience` to attach the activity to a Visit.

## Records that could change meaning (measured)

| Item | Count | Handling |
|------|-------|----------|
| Dangling `part_of` parent refs | **7** | Quarantine in an exceptions table for review — **do not auto-repair** (ambiguous). |
| Valid `part_of` pairs (already in membership) | 230 | Already canonical; `part_of` becomes read-compat then retired. |
| `suggested` trip drafts | 24 | Represent as **draft Trips** (or draft container-Places) with an explicit status; accept → reviewable draft, dismiss → persisted. |
| Entries used as spots | 2 (dining) | Re-link via `entry_links`; trivially small, low risk. |
| Manual visits | 0 now | Model + rebuild must **preserve** manual visits when they exist (reconciliation, not delete). |
| Trip container-Places | 33 | Option A migrates to a `trips` table; Option B keeps as container-Places. |
| Activities | 443 (all placed) | Confirm none are "places created from an activity" during backfill validation. |

## Proposed additive, reversible migrations (for Prompt 2B — not now)

1. **Constrain `place_membership` as canonical:** add FKs `child_id`/`parent_id →
   places(id)` (`NOT VALID` then `VALIDATE`), `unique(child_id, parent_id)`, a
   `relationship_type` column default `'contains'`, a **cycle-prevention** trigger,
   and a check that the parent is a valid container.
2. **Exceptions table** `place_membership_exceptions` — insert the 7 dangling
   `part_of` pairs with reason; **no destructive repair**.
3. **Compatibility:** keep `part_of` + its sync trigger readable until every caller
   migrates; add a `place_children`/`place_parents` view over `place_membership`.
4. **Trip entity (Option A):** additive `trips` + `trip_stops(status)` tables;
   deterministic backfill from the 33 `category='trip'` container-Places
   (preserving ids where safe via a mapping table), completed stops → existing
   Visits; container-Place representation remains a compat read during migration.
5. **Entry links:** additive `entry_links(entry_id, ref_type, ref_id)`; backfill the
   2 existing entries from their `place_id`.
6. **Validation queries:** membership dangling = 0, cycles = 0, every child has a
   valid parent, activity→place integrity, visit counts unchanged.
7. **Rollback:** each migration drops only its own additions; `part_of` and all
   existing rows are untouched, so any step reverses cleanly.
8. **Retirement of `part_of`:** only after all readers use `place_membership`; then
   a final migration drops the sync trigger and the column (reversible by
   re-deriving `part_of` from membership).

## DECISION NEEDED

**Recommended contract:** adopt `addExperience` as the single creation path;
make **`place_membership` the canonical typed hierarchy** (FKs, uniqueness,
`relationship_type`, cycle prevention) and retire `part_of` in stages; quarantine
the 7 dangling refs; restructure the 2 entries via `entry_links`.

**Trip decision (pick one):**
- **Option A (recommended):** promote **Trip to a first-class `trips` + `trip_stops`
  entity**, migrating the 33 trip container-Places. Matches the intended meaning and
  unblocks the trip-planner MVP (Prompt 10); larger but additive/reversible backfill.
- **Option B:** keep **Trip as a container Place**, adding planned-stop status to
  membership. Least change now, but conflates Trip with Place and complicates
  Prompt 10.

**Precise data impact:** 0 rows deleted; 230 membership rows already correct; 7
`part_of` pairs quarantined (not repaired); 2 entries re-linked; (Option A) 33 trip
Places mapped into `trips`. All reversible.

**Unresolved exceptions (need a human ruling):**
1. The **7 dangling `part_of` parents** — delete the stale pair, or was the parent
   place wrongly removed and should be restored from a snapshot? (Ambiguous →
   quarantined by default.)
2. **Trip = entity (A) or container-Place (B)?**
3. Should `suggested` trip drafts become draft **Trips** (A) or stay draft
   container-Places (B)?

**To approve, reply with exactly:**

> Approved: implement ADR 0001 with Trip Option A

*(or "…with Trip Option B" to keep trips as container-Places).* Implementation is
Prompt 2B and must not start before this phrase.

## Implementation status (2026-07-29) — Option A approved

Verified on a disposable local Supabase stack (never production); not deployed.

**Backend — DONE:**
- `place_membership` canonicalized (`0096`): FKs, unique, cycle-prevention,
  exceptions quarantine.
- First-class `trips` table + RLS (`0097`).
- **`trip_stops`** table (planned/completed/skipped) + **migration of the 33
  container-Place trips** into `trips`+`trip_stops` (`0099`): additive, idempotent
  (`trips.source_place_id`), reversible. Read-only preflight vs prod: **0 → 33
  trips, 221 trip_stops, 25 undated, 1 nested-trip exception**.
- **Compatibility read** `trip_place_ids(trip)` = explicit stops ∪ date-range
  **leaf** places (containers excluded), DISTINCT — so reads work for
  stops-only, date-range-only, or both.
- **Overlap-safe `trip_stats`** (`0099`) recomputes over that DISTINCT union,
  **superseding the naive date-range `trip_stats` from `0097`** (which
  double-counted on overlap). Both are member-gated + anon-revoked.

**Still container-Place based (transition pending):** the entire UI —
`routes/Trips.tsx` (filters Places by `categories∋'trip'`), the trip card
(PlacePanel, members via `part_of`), and `components/TripItinerary.tsx` — plus
`trip_timeline`/`trip_notes`, which key on the **container-Place id**. The
new-model `lib/trips.ts` is currently unwired.

**Transition follow-up (separate, planned):** point `Trips.tsx`, the trip card,
and "+ Add → Trip" at the `trips` table; wire `lib/trips.ts`; re-point
`trip_timeline`/`trip_notes` from the container-Place id to the `trips` id
(**id-space hazard** — those RPCs/tables take a `places.id` today). Retire the
container-Place representation only after the UI fully reads the `trips` table.
