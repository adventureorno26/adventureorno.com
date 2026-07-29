# AdventureOrNo — Get It In Order

*Plan written 2026-07-22, after reading the code, the migrations (0047–0062), and the live database.*

---

## Part 1 · What's actually wrong (diagnosis, from the live data)

The good news first: **the model you designed is sound and mostly built.** One object (Place), visits carry attribution, containers fuse visits, cities have real boundaries (Seattle / West Palm Beach / Reston already have polygons and ST_Contains works). The San Diego walks are currently attached to the San Diego trip — not their own places — and the trip shows one fused visit (Jul 11–16). Elizabeth Furnace shows 7 separate visits. The worst of what you saw yesterday is no longer in the data.

What's broken is that **the same three problems keep un-fixing themselves**, because they were patched as one-time data edits instead of rules:

**1. Attribution keeps reverting to "Both."**
The spec's rule — *pre-cutoff (before 2025-12-21) → Erica, post-cutoff → Both* — was applied once as a data fix, but it was never written into `rebuild_place_visits`. That function re-infers attribution from activities only; a visit backed by photos (no activity) gets `null` = Both every time it rebuilds. **Right now 89 pre-cutoff visits are sitting on "Both" again.** This is why "Josh's miles are on Both" and "pre-cutoff stuff shows on the Both map" keep coming back no matter how many times it's "fixed." Visits rebuild constantly (every photo/activity insert/move fires the trigger), so any fix not inside the rebuild function has a shelf life of days.

**2. The activity→place rule has no judgment.**
The spec said "every activity becomes a leaf place at its start point." That rule, applied literally, produced exactly what you screamed about: a morning walk in San Diego became a "place," and Josh's Garmin import created **9 separate "Loudoun County Running" places in one minute** (the reuse radius is 150 m, so every run starting from a different street corner spawned a new place). There are also 6 near-duplicate "Washington & Old Dominion Trail" places from the same mechanism. Your actual mental model is more nuanced than the spec — see Part 2.

**3. Junk enters silently.**
The live DB has **10 places with a completely blank name**, all pinned at (38.056, −95.750) — the geographic center of the US, i.e. a default coordinate from a broken add-place flow. Plus a blank-named trip container. Plus duplicate trips (Frederick VA ×2, Linden VA ×2, Morgan WV ×2). Nothing validates inserts, so garbage accumulates and makes every list and dropdown look chaotic.

**Also worth knowing:** the git tree is clean on `phase-7-globe-fog`, migrations 0059–0062 are applied, and the "activities became their own places" conversion from the last session appears to have been reverted in the data (no "Morning stroll" places exist; the 6 SD walks are back on the trip). And the AI auto-tagging that was wired into the nightly geocode job is inert until an `ANTHROPIC_API_KEY` is set in Supabase secrets.

---

## Part 2 · The model, stated the way you actually want it

This is the piece the spec got wrong and everything else inherits. Restated from everything you've said:

**A place is a destination. An activity is a thing you did.** They are not the same thing, and an activity only *earns* a place when the activity's location is itself the destination.

Defaults by activity type:

| Activity | Default | Why |
|---|---|---|
| **Hike** | Its own place | The trail is the destination |
| **Bike / Jeep** | Its own place | Same |
| **Run** | Its own place — but repeat runs from the same area collapse into ONE place | "Loudoun County Running," singular. Never nine. |
| **Walk** | **Not a place.** Attaches to the place you were at (the trip, the city, the campground) and shows as activity detail on that card | A morning walk in San Diego is part of being in San Diego |
| Walk with nowhere to attach (no enclosing trip/city, nothing nearby) | Attaches to a geocoded *destination* place (the town/park), created if needed | You still walked somewhere new; the town counts, the stroll doesn't |

**And the override you asked for:** every activity row gets a small control — "make this its own place" / "move this to …" — flagged manual so no recompute ever undoes your choice. Defaults are defaults; you decide.

Two supporting rules:

- **Naming:** a place is never named after an activity title. "Morning stroll in San Diego" is an activity name and stays on the activity row; places get geocoded names (trail, park, town). This alone kills the most absurd artifacts.
- **Containers unchanged:** trip/city/region hold members (by boundary or part_of), fuse one visit per stay, several stays = several visits, count once as a place. That machinery (0061/0062) works — Elizabeth Furnace's 7 visits and San Diego's single fused visit prove it. We keep it.

---

## Part 3 · The plan, in order

### Phase A — Encode the rules so fixes stop reverting *(do first; everything else is pointless until these hold)*

**A1. Put attribution defaults inside `rebuild_place_visits`.**
New inference order: manual override wins → activity owner (all-Josh visit → Josh, all-Erica → Erica) → **date rule: before 2025-12-21 → Erica, on/after → Both** → VA Beach 2026-03-22 exception stays Erica. One migration. After this, attribution literally cannot drift, because the default is re-derived correctly on every rebuild instead of being erased by it.

**A2. Rewrite `place_for_activity` to be type-aware (the Part 2 table).**
Walks: attach to enclosing container (boundary or proximity), else nearest existing place within ~2 km, else geocoded destination place. Runs: reuse radius ~1.5 km (collapses neighborhood variance). Hikes/bikes: reuse 300 m, else create. Never name from the activity title — create as "needs_geocode" and let the geocoder name it. This fixes Strava webhook, Garmin/GPX import, and backfill in one spot, because they all call this one function.

**A3. Input hygiene.**
Reject/flag inserts with a blank name or the (38.056, −95.750) default coordinate; a nightly (or on-ingest) merge pass that folds auto-created places sharing a geocoded name within ~250 m into one.

### Phase B — One-time cleanup *(safe now, because Phase A stops regressions)*

**B0. Snapshot first.** Full export of places / activities / visits / entries / photos-metadata to dated JSON files in the repo before touching anything. Non-negotiable after this week.

Then, in one reviewed batch:

- Delete the 10 blank places + the blank trip container (nothing references them meaningfully).
- Merge the 9 "Loudoun County Running" → 1 (repoint activities, rebuild visits). Same for "Bay Lake Running" strays.
- Fold the 6 duplicate W&OD-named leaves into the W&OD trail structure (one leaf per real trailhead, members of the W&OD trail container).
- Merge the pairs: C&O Canal ×2, Difficult Run ×2, Old Rag Fire Road ×2, Slaughter Trail ×2, Madison ×2, and the duplicate trips (Frederick VA, Linden VA, Morgan WV).
- Re-run attribution once under the new A1 rule; **verify: zero pre-cutoff visits on Both** (today: 89).
- Re-run the type-aware placement over existing walks: any walk-place that shouldn't exist folds back into its enclosing trip/city (the SD walks are already correct; this catches stragglers elsewhere).
- Rebuild all visits + stats; verify `wander_stats` and spot-check San Diego (1 fused visit, 6 walks as detail rows), Elizabeth Furnace (7 visits), Loudoun (1 running place).

### Phase C — Finish the spec + your queue *(UI, one deployable slice at a time)*

In priority order, each slice = build → verify in a real browser on a place card and the map → deploy → commit:

1. **Per-activity place control** — the "own place / part of…" override from Part 2. This is the control you've been asking for.
2. **§3a city/region UI** — the backend is live and proven; the panel UI got pulled during the crash fix. Rebuild: "Make this a city/region" on a place card → fetches the OSM boundary → members appear automatically. Then designate your obvious cities (San Diego, Seattle, WPB, Reston are done or trivial).
3. **§5 spot simplification** — "+ Add a place here" wording, remove the visit-level spot sub-flow, reconcile the "N visits" count with the visible list.
4. **Race stats** — "Races" in Our Stats = number of race-tagged activities; dropdown shows total race miles + count by distance bucket (5K / 10K / 10-mile / half / full — "51 5Ks"). The `race` tag already exists.
5. **Alphabetical everywhere** — places list, search results, all dropdowns, tag pickers. One sweep, one deploy.
6. **Odds and ends** — verify the "Reviews"-word removal is live everywhere; either set `ANTHROPIC_API_KEY` in Supabase secrets so auto-tagging actually runs, or pull the dead code; delete the `Trip`/`TripStats` legacy types still in `types.ts`.

### Phase D — Working agreement *(so this never happens again)*

- **Snapshot before any data-touching batch.** Dated dumps kept in the repo.
- **Never fix data without encoding the rule** that keeps it fixed. If a fix doesn't live in a trigger/function/constraint, it will revert.
- **One slice at a time, verified in the browser before the next.** No more 6-workstream mega-batches — that's how the card-crash and the walk-places both shipped.
- **Migrations as files, applied once** (already the convention — keep it), and after this cleanup, pull the live schema so the repo matches the database again.

---

## Part 4 · Three decisions that are yours (defaults marked, I'll proceed with them unless you say otherwise)

1. **Runs near home** — collapse ALL home-zone runs into one "Loudoun County Running"-style place per general area *(my default)*, or keep a separate place per distinct route/start area?
2. **Walks with no enclosing trip/city** — attach to the geocoded town/park as the place *(my default)*, or make them visible only in the day view and not on the map at all?
3. **Activities sitting directly on trail containers** (AT ×10, Billy Goat ×6, Maryland Heights ×7, Seneca Rocks ×4, W&OD ×6…) — these look like your hand-curated groupings. Leave them exactly as they are *(my default)*, or move each onto a trailhead leaf under the trail per the spec?

---

## Suggested execution order, concretely

1. Phase A (three migrations, reviewed before applying) — one sitting.
2. Phase B snapshot + cleanup batch — one sitting, with before/after counts shown to you.
3. Phase C slices 1–2 (activity control + city UI) — these are the visible payoff.
4. Phase C slices 3–6 as follow-ups.

Each step gets your go before it touches the live DB, and every data batch starts with a snapshot.
