# Ingest rebuild — the build plan

Companion to `docs/INGEST-REBUILD.md` (the design) and `docs/RESUME-HERE.md` (the state).
This file answers only one question: **in what order do we build it, and what proves
each step worked.**

Written 2026-08-09 after checking the live database and the deployed edge functions.

---

## Live facts this plan is built on (verified, not assumed)

| Fact | Number | Why it matters |
|---|---|---|
| Activities with a `summary_polyline` | **445 of 445** | Route scoring applies to *every* activity. No start-point fallback needed for existing data. |
| Places | 148, of which **61** `name_locked` | Size of the §9.1 backfill. |
| Visits | 486, of which **12** `manual` | §9.2 backfill is small. |
| Photos with a `visit_id` | **0 of 168** | §9.3 backfill is a **no-op** — drop it. Photo pinning starts fresh at step 5. |
| Deployed `strava-webhook` / `strava-backfill` | v18 / v20, **no `usablePlaceName`** | The urgent loose end is still open. See step 0. |
| Prototype scorer | `scripts/naming/route_namer.py` (93 lines, in-repo) | Already rescued from `/tmp`. Port from here, not from memory. |

---

## Step 0 — Deploy the Strava fix (do this first, on its own)

**Not part of the rebuild. It is the reason the rebuild can be trusted.**

Right now `supabase/functions/_shared/strava.ts` in the repo no longer treats `name` as a
Strava-owned field — but the *deployed* functions still do. Until this ships, a Strava
re-sync can overwrite any name, including one Erica just approved. Building an approval
system on top of that is building on sand.

```bash
cd adventureorno-claude-code && set -a && . ./.env.local && set +a
supabase functions deploy strava-webhook  --project-ref aanfyhsjbtnqzphuoiem
supabase functions deploy strava-backfill --project-ref aanfyhsjbtnqzphuoiem
```

**Gate:** fetch each deployed body back and grep for `usablePlaceName` — must be present.
Then re-run one backfill page against a known-renamed activity and confirm the name survives.

**Also in this step (housekeeping, no risk):** move the work onto a branch and open the PR
that house style wants. Everything since `9b81572` landed on `main` via the auto-save hook.

---

## Step 1 — The ledger: `suggestions`, `approved_fields`, the guard

Migration `0148_a_machine_may_only_propose.sql`.

**Ships:**
- `suggestions`, `approved_fields`, `ingest_runs` exactly as §3.1/3.2/3.4.
  (`naming_rules` waits for step 7 — no table without a consumer.)
- `may_autowrite(type, id, field)` (§4).
- RLS on all three: member-only select; **no client INSERT/UPDATE/DELETE on
  `approved_fields` at all** — every write goes through a SECURITY DEFINER RPC.
- Backfill (§9), corrected: 61 places → `approved_fields(place, id, 'name', via='backfill')`,
  12 manual visits → `(visit, id, 'place_id')`. **No photo backfill — there is nothing to
  migrate.** The 328 renamed activities stay unlocked on purpose.

**Nothing changes behaviour yet.** No function reads the guard until step 4. This step is
pure addition, so it can ship the day it's written.

**Gate — `supabase/tests/0148_a_machine_may_only_propose.test.sql`:**
- `may_autowrite` returns true before an approval, false after. *(Negative control: false
  for the approved field only — a different field on the same subject stays true.)*
- The no-repeats unique index rejects re-inserting a rejected suggestion.
- A logged-in non-member reads zero rows from all three tables.
- Backfill counts land exactly: 61 + 12 rows, no more.

---

## Step 2 — The suggester: `suggest` edge function

Port `scripts/naming/route_namer.py` to Deno at `supabase/functions/suggest/`.

**Shape:** `POST /suggest { activity_ids: uuid[] }` → writes `suggestions` rows only.
Never touches `activities`, `places`, `visits`, `photos`.

**The work, in order:**
1. **Polyline decoding.** `summary_polyline` is Google-encoded. Small vendored decoder in
   `_shared/polyline.ts` with its own unit tests — this is the one piece where a silent bug
   would poison every suggestion downstream.
2. **The scorer**, §5.1 verbatim: 9 samples → one Overpass call → trail ≥50% = rank 0,
   park ≥40% = rank 1 (rank 0 if no trail won), everything else rank 2+.
3. **Failure handling**, §5.5: 3 retries with backoff → MapTiler through the existing
   plausibility filter → give up and log to `ingest_runs`. **A failure writes nothing.**
4. **The Red Rock case**, §5.4: no OSM result → no suggestion, no row, no card. Explicitly
   tested, because the tempting bug is to "helpfully" fall through to a town name.
5. **Throttling.** The public Overpass endpoint allows ~2 concurrent queries and rate-limits
   beyond that. Serialise with a small delay; a 445-activity sweep is a background job, not
   a request.

**Gate:** run it over the 14 routes in `scripts/naming/route-scoring-results-2026-08-09.txt`
and reproduce the §5.2 table — Connector → Potomac Heritage Trail (7/9), Clarke County →
Appalachian Trail (9/9) *with* Sky Meadows SP offered second, and Red Rock → nothing.
Same inputs, same outputs as the Python prototype, or the port is wrong.

---

## Step 3 — `/inbox`

The screen from §8. One card, one button, evidence on its face, undo.

**RPCs** (migration `0149`): `inbox`, `approve_card`, `skip_card`, `reject_suggestion`,
`undo_approval`, `inbox_counts`. `approve_card` is **one transaction** — every chosen value
written, an `approved_fields` row per field, siblings marked superseded, an undo token
returned. A half-approved card is exactly the inconsistency this whole design exists to stop.

**UI:** `app/src/Inbox.tsx`, route `/inbox`, link in `PrimaryNav` with a pending count.
No icons. Text controls. Real thumbnails when photos arrive at step 5.

**Relationship to `/attention`:** the existing Attention-Needed page overlaps this. Do
**not** delete it in this step. Once the Inbox is proven, `/attention` rows that duplicate
Inbox cards get removed and the rest stays — and only after asking Erica.

**Gate:** Erica can clear a day of activities in under a minute; undo restores the previous
values *and* removes the locks; Skip writes nothing and the card returns.

---

## Step 4 — Put the machines behind the guard

The greppable split from §4. This is the step that makes the rule real.

- **Group 4.1 (18 person-initiated RPCs)** — `set_place_name`, `update_activity`,
  `reassign_activity`, `set_visit_place`, … — each also inserts `approved_fields`
  (`via='edit'`). Erica's edit in the app **is** an approval; she never confirms twice.
- **Group 4.2 (13 machine-initiated)** — `import_file_activity`, `cluster_unassigned`,
  `ensure_visit`, `nameNewPlace` in the Strava functions, … — check `may_autowrite` before
  writing `name`, `place_id`, `visit_id`, `is_trip`, `is_trail`. False → skip. True → write
  only on high confidence, else insert a suggestion.
- **Group 4.3** — untouched.

**Gate — the test that makes this stick:** a SQL test that greps every function body and
fails if any function outside group 4.1 writes an Inbox-owned field without
`may_autowrite` in scope. Plus §10's headline: approve a name, re-run a Strava sync, the
name is unchanged. *(Negative control: an un-approved name still gets improved.)*

---

## Step 5 — Photo suggestions

`subject_type='photo', field='visit_id'` — inherits approval and locking for free.

- **Uploads** (works today): same local date, within ~5 km, not on a visit.
- **Google Photos**: that day's date range. The OAuth connects; the **picker is unproven
  end to end** and needs Erica to test it once before this step can be called done.
- **Phone**: the nightly iOS Shortcut. A web app cannot read the camera roll — no browser
  API exists. Saying so now rather than building toward it.

Approving pins the photo to the visit and **keeps its real date**.

---

## Step 6 — Backfill: re-suggest the weak names

Sweep all 445 activities through the scorer. Every result is a *suggestion* — nothing is
written. Expect the 11 improvements from §5.2 to surface, Red Rock's 97 to produce nothing,
and the 61 locked places to be skipped entirely.

Run it as a throttled background job with an `ingest_runs` row, so a batch of Overpass 504s
shows up as "N couldn't be looked up — retry" instead of vanishing.

**Gate:** the §5.2 eleven come back better, and `select count(*) from suggestions where
subject_id in (locked places)` is 0.

---

## Step 7 — `naming_rules`

Migration adds the §3.3 table. After the 3rd identical approval in one area the card offers
*"Always call routes here Lake of the Red Rocks?"* → `learn_rule`.

An auto-applied rule **still writes a `suggestions` row** with `status='approved',
source='rule'`, so every automatic name stays visible, attributable and undoable. Silent
automation is what caused all of this.

**Gate:** Red Rock stops asking; the audit row exists.

---

## Step 8 — OSM attribution

`© OpenStreetMap contributors` linked to `openstreetmap.org/copyright`, visible without
interaction. Currently missing — a real compliance gap, and a 20-minute job.

**Fold this into the first UI deploy (step 3)** rather than leaving it last. It is already
overdue: the AllTrails/Overpass work today used OSM data.

---

## Sequencing, and what can overlap

```
0 ─ deploy Strava fix        ← blocking, do alone, today
│
1 ─ tables + guard + backfill      ┐ 1 and 2 are independent —
2 ─ suggest edge function          ┘ 2 needs no schema from 1 until it writes rows
│
3 ─ /inbox (+ step 8 attribution)  ← needs 1 and 2
│
4 ─ guard the 31 functions   ← needs 1; safest once 3 gives a way to see the effect
5 ─ photo suggestions        ← needs 3
6 ─ backfill re-suggest      ← needs 2 and 3
7 ─ naming_rules             ← needs 3 and enough approvals to learn from
```

Steps 1–3 are the spine. Everything after is additive and can be reordered around whatever
Erica wants to see first.

Each step: migration applied → `npm run lint && npm run test` clean → preview verified by
actually driving the app → PR → an entry in `docs/decisions.md`.

---

## Two decisions still needed from Erica

**a) Trail or park, when both are right?** Clarke County scores Appalachian Trail 9/9 *and*
Sky Meadows State Park 8/9. Both are true. The proposed default is **the trail when the
route mostly follows one, otherwise the park**, with the other always offered as the second
option — she picks once and step 7 learns it. This only sets which one is pre-selected;
nothing is ever chosen silently. **Needed before step 2 ships.**

**b) Strava's API policy.** The claim that the policy effective 1 June 2026 bans retained
location data, >7-day retention and AI use is **still unverified against the primary
source.** It does not block steps 0–7 — none of them change what Strava data is stored. It
does decide whether the long-term answer is bulk export (265 of 445 activities already came
that way). **Verify before it drives any decision.**
