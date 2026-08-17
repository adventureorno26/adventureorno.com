ok ok I ready

# AdventureOrNo — what this is, and what is left to build

**This is the only planning document.** If a plan is not written here, it is not the plan.
Every competing one was DELETED on 2026-08-11 — `README.md`, `docs/archive/`, `docs/adr/`,
CLAUDE.md's backlog ledger, `NewClaude.md`, `CLAUDE-CODE-INSTRUCTIONS-2-70.md` — and they
are recoverable from git history if a decision needs looking up. Do not recreate them:
plans go HERE.

Last updated: 2026-08-16.

**HOW TO READ A ✅ IN THIS FILE (new 2026-08-16).** A tick used to mean "somebody
finished it", and that turned out to cover five different states — which is how this
document came to say Phase 4 was DONE while the live site still drew a Mapbox map.
Every claim of doneness now names which of these it means, and they are not
interchangeable:

| Status                  | Means                                                             |
| ----------------------- | ----------------------------------------------------------------- |
| **Built**         | the code exists on a branch                                       |
| **Merged**        | it is in`origin/main`                                           |
| **DB-applied**    | its migration is applied to production AND recorded in the ledger |
| **Deployed**      | it is in the bundle`/version.json` reports                      |
| **Live-verified** | Erica opened it in the real app and it was right                  |

Only **Live-verified** is what §5 means by "it works when Erica drives it". Merged is
not deployed; deployed is not verified.

## NOW — the order of work (locked 2026-08-14)

The immediate product is a reliable private web app for **Erica and Josh**. The future
commercial Apple and Android product **has no decided name** (2026-08-15 — "Flok" was a
working title and is NOT decided; do not write it into the product, the docs or the
repo). The two goals share a core, but
commercial scale must not destabilize the app Erica and Josh are trying to use today.

The sequence is:

1. **Stabilize the private core.** Place, visit, trip, trail, card, saves, imports,
   photos/videos, statistics, authentication, backup, CI and production deployment must
   agree and work for both accounts.
2. **Self-host the map.** Finish the MapLibre + PMTiles path in Phase 4, approve the
   visual palette, cut production over with rollback, then remove paid basemap dependence.
3. **Build the complete web feature set.** The one-page editing flow, collaborative trip
   planning, Together approvals, remaining importers, and the other work recorded below
   are queued here. They are not cancelled or abandoned.
4. **Build the native Apple and Android apps, then commercialize.** Reuse the proven domain
   model and APIs; add tenancy, privacy boundaries, billing, legal/provider compliance,
   support and native-only integrations only after the private core is dependable.

**“Later” means sequenced, not postponed indefinitely.** Do not delete desired features
to make the schedule look shorter. Finish one vertical slice, deploy it, verify it in the
real app, and then take the next slice.

### Current stabilization gate

Do not begin a new feature lane until all items below are true for the same commit:

- [X] Production migration `0177_the_card_answers_in_one_call` is applied and recorded.
  Verified 2026-08-14: all 177 migrations are in the ledger, `videos.visit_id` exists,
  and production `card_view` was version 2. **It is version 3 as of 0188** — the card
  reads participants from rows rather than a nullable `solo_profile`.
- [X] A current recoverable backup exists. Re-verified 2026-08-16 after it had gone
  **stale at 42h against a 36h limit** — the nightly Backup workflow could not run while
  GitHub Actions was blocked on billing, so the freshness gate and the thing it guards
  failed together. Fresh encrypted backup taken 2026-08-16, seven generations, 362 media
  objects. **The restore is now fully proven** (2026-08-16 21:11): after the
  identity-column fix, all 45 tables restore with row counts matching the manifest
  exactly — 21,143 rows, zero load errors. It had failed earlier the same day with
  `service_health` at 0 of 415; no table holding real data was ever affected.
- [ ] Erica can sign in, open a place card, edit and save a visit, reload, and see the
  saved result.
- [ ] Josh can sign in and perform every action allowed to the editor role without seeing
  an unexplained permission or save failure.
- [ ] Map, place card, visit page, Add/import, photos, stats and logout pass a short manual
  smoke test on the production commit recorded in `/version.json`.
- [ ] Required CI is green on Node 22; production deploys only the exact gated SHA.
- [ ] Backup freshness and migration-ledger checks are hard production-deploy gates.
- [ ] GitHub CLI authentication is healthy for the repository owner, so commits, checks,
  PRs and deploy evidence can be inspected instead of guessed.

### How to move faster without repeating work

- Keep **one active implementation PR**. Finish, deploy and verify it before starting the
  next feature PR. Separate worktrees are allowed for independent documentation or audit
  work, but two agents must not edit the same files at the same time.
- Database contract first: migration → generated types → backend/RPC → frontend → tests →
  production verification. Never deploy a frontend that requires an unapplied migration.
- Use a small required gate for every PR: format/lint, unit tests, database migration tests,
  build, and one deterministic smoke test. Run broader browser/accessibility/security suites
  nightly or when their files change; do not remove the tests that protect data and deploys.
- Batch Erica's visual decisions into one preview gate per feature. Code after approval,
  then verify the finished production screen once.
- Record every accepted decision and its proof here. Do not create another backlog,
  decisions log or competing agent instruction file.

### THE PLAN — revised 2026-08-17

**The 08-16 plan is finished and has been moved to §7e.** It ran Steps 0–3: production
caught up to `main`, Phase 4 went Live-verified, the restore was proved, and the three
monitoring traps were closed. Keeping a completed plan at the top of the file is how this
document turned into a history of itself last time, so what remains is below and the
narrative is in §7e where the other days live.

**The order is unchanged from 08-14** — stabilize the private core, then the web feature
set, then native. What changed is that the top of the list is no longer maintenance.

#### 1. ✅ `verify:live` IS TRUE AGAIN — one red check left, and it is a question for Erica

`e2e/erica-asked-for.spec.ts` decides whether Erica got what she asked for: a request is
done when its check is green **on the live site**, and a changed instruction gets its check
**rewritten, with the old one noted** — never deleted. That rewriting had never happened,
so the list was failing against an app that was correctly obeying her newer decisions.

**Five red became one, 2026-08-17. Four of the five were the list's fault, not the app's:**

| Check | What was actually wrong | Fix |
| ----- | ----------------------- | --- |
| *"stats moved to the top of places"* | Asserted a stats bar **on** Places — the exact thing she told us on 08-15 to remove, and #94 did. Two instructions in direct opposition | **Rewritten to the newer instruction** per rule 4, with the old wording recorded in the test. Now asserts no stats bar and no gear on Places, and that Stats is on Settings where she moved it |
| *"clicking Trips pulls up a list"* | **Not a missing feature.** `openStats()` clicked the FIRST of /settings' four `stats-dropdown` summaries, and only if none was open — so whenever another was open it clicked nothing, Stats stayed shut, and the Trips button read "not visible" | Helper now finds the **Stats** card by its summary text |
| *sections are Visits, Photos, Routes, …* | Demanded a Routes heading unconditionally; `PlacePanel` renders it only when the place has activities | Asserts the ORDER of the sections that exist; Routes is checked where it belongs |
| *Routes holds the map AND the list* | Same, on one hard-coded card | Walks Places until it finds a place that HAS routes, then asserts map + list |

**A correction to what this section said an hour ago**: it claimed the Trips check was red
from "the same removal" as the stats bar. That was wrong — it never touched Places. The
cause was the helper above, and the difference matters because one reading says a feature
is missing and the other says a test is.

**The one still red — `:145`/`:162`, and it needs her answer.** The visit section reads
`Together / Just Erica / Just Josh`. §0.1 relaxed the blanket ban on the word "Trip"
*inside an edit control* — "the visit editor may say **Count this as a trip**" — while
keeping passive badges banned. The participant picker is an edit control of exactly that
kind, so the newer rule probably permits "Together" and the check probably wants
rewriting. **Probably is not good enough for a rule she wrote:**

> *Does "no together in the visit section" still stand, now that the words sit on a control
> you press rather than a badge that just asserts something?*

Two of the fixes above were bugs in the replacement code, found by running it against
production rather than assuming: counting place links before the list had loaded (0 links
on an account with 151), and matching `.our-stats` where /settings has six of them. Both
are the same mistake this file keeps naming — reading the DOM before the thing exists.

#### 2. THE STRAVA LEAK, THEN THE IMPORT SYSTEM — Erica's order, 2026-08-17

She set the sequence: *close the cross-visibility first*, then build the import workflow
with a provenance ledger, then cross-source de-duplication, then backfill Josh's Strava.
The whole design is **Phase 7a**, written against the live database rather than the repo.

**The one number that says why it is first:** acting as Josh, the real reader
`mileage_by_person(josh)` returns 124 activities and 992.5 miles — of which **46
activities and 356.1 miles are Erica's Strava runs**. His stats screen is showing him her
mileage today.

The cause is not the guard — #100 works, 15 readers go through `visible_activities` — and
not the Strava trigger, which credits only the athlete whose token fetched the activity. It
is `0039`, which asserted **by date** that everything Erica recorded after 2025-12-21 was
also Josh's. 44 of the 46 still carry that migration's fingerprint.

**That backfill was deliberate and stays** (Erica, 2026-08-17: it *"was just meant for the
specific timeline when I initially added activities"*). What goes is the rule's future
tense, which survives in `import_file_activity` **and in `rebuild_place_visits`** — the
second being a machine job that re-asserts it on every rebuild. The visibility fix is what
makes keeping the history safe: a true "we were both there" tag stops being a key to
Strava's copy of the data.

#### 3. THREE LINKS ON /settings ARE UNTAPPABLE ON PRODUCTION

Measured on the live site with her data: `Celebrate Virginia`, `Mill Mountain Trail`,
`Red Spring Gap`. A list overflows its collapsed container by 2,566px and paints under the
floating nav, so no amount of page padding reaches it. Full diagnosis in §7e.

**Needs a decision before code**: should a long category list inside a stats dropdown get
its own scroll, a max height, or not be nested in that grid at all? Then it is a small fix.

#### 4. WAITING ON ERICA — none of it blocks the rest

- **`GITHUB_TOKEN` for the watchtower** — `npx wrangler secret put GITHUB_TOKEN` (read-only,
  `contents:read`). Until then the deploy probe honestly reports that it cannot check.
- **The iOS Shortcut** — send `Authorization: Bearer`, and the `?token=` fallback can go.
  Note §C5: the device path has not run since 07-29, so "where we are" is a browser tab for
  both of them right now.
- **The 122 photos** — one visit, one day, one place, no ambiguity, and `0157` makes the
  attachment permanent. The 32 with fabricated `12:00:00` stamps must be proposed instead.
- **Her manual smoke pass** — the last unticked box in the stabilization gate. The
  automated acceptance flows cover the same ground but do not replace her driving it once.

#### 5. THEN THE QUEUED LANES, in the order locked on 08-14

Nothing here starts while §1 is red.

| Lane | State | Next concrete step |
| ---- | ----- | ------------------ |
| Phase 3 — the one page | not started | Needs her preview approval FIRST: `/attention`, `/photos/sort`, `/duplicates`, `/health`, `/trash` and Settings → Data fold into `/add`, then are REMOVED. Restore `PlaceQuickEdit`; make transient UI transient |
| Phase 4d — geocoding we own | nothing built | Overture → PMTiles; Mapbox stays the fallback |
| Phase 6 — what we own | nothing built | §6a-ii first: Copernicus terrain kills the last Mapbox call AND its attribution question |
| Phase 7 — fitness ingest | nothing built | intervals.icu first; email-in is the best effort-to-coverage item |
| Phase 8 — events, social, privacy floor | nothing built | Much of it gated on the LLC and the native shell |

**Two dead components are named and unremoved**: `BucketMiniMap` and `TrailSectionsMap`
have no consumers. `AddSheet` was the same and she said delete it, so these are probably
the same answer — but removals get asked about first.

#### 6. THE STANDING RULES THIS WEEK EARNED

Not process for its own sake — each one is a specific thing that went wrong:

1. **Measure the thing, not a proxy for it, and check what you pointed at.** Three
   findings this week came from measuring and one from inferring; the inferred one was
   wrong, and the retraction of it was *also* wrong because it measured a login page by
   mistake.
2. **A guard that cannot see the failure is not a guard.** The a11y check aimed at a
   dialog that no longer existed. The obstruction check never looked at /settings. The
   nightly suite could not run at all.
3. **Apply the migration BEFORE merging.** It is why #103 deployed and #100 did not, and
   regenerate the types in the same commit.
4. **A null is not a fact.** `solo_profile IS NULL`, a quiet cron row, an empty
   `last_query_auth_at` — absence of evidence keeps getting read as evidence of absence.

---

## 0. AUTHORITATIVE BUILD DIRECTIVE — PLACE, VISIT, TRIP, TRAIL AND THE CARD

**Approved direction, 2026-08-12. Read this section before every older discussion of
places, visits, trips, trails, cards, containment or statistics. When an older passage
conflicts with this section, this section wins. Do not create another planning document.**

This is an implementation brief, not permission to improvise another model. The work is
complete only when the database, RPCs, frontend, generated types, tests, live data audit,
and this document all describe the same rules.

### 0.1 Non-negotiable outcome

There is one model:

```text
PLACE = where something happened
VISIT = one occurrence at one place
TRIP = a qualifying visit, never a separate place or table
CHILD VISIT = a visit explicitly grouped under a parent trip visit
ACTIVITY = something done during a visit; its recorded route is evidence
TRAIL = a non-counting place rollup whose sections are counting places
```

Do not restore `trips`, `trip_stops`, a `trip` place category, or trip-places. Do not infer
trip contents from overlapping dates alone. Do not create a second visit at a trail when a
section visit already represents the outing. A machine may propose; only an accepted write
changes history.

The new decision supersedes these older rules where they conflict:

- date-only global trip containment;
- `solo_profile IS NULL` as the permanent participant model;
- `places.part_of` as a writable/canonical relationship;
- direct frontend insert/update/delete operations on `visits`;
- cached place dates/counts as an independent source of truth;
- a drawn trail definition stored as an `activity`;
- the blanket ban on the word “Trip” inside an edit control. Passive badges remain banned,
  but the visit editor may say **“Count this as a trip”** so a person can make or undo that
  decision intentionally.

### 0.2 Before writing code

Claude must do all of the following and record the results in this section:

1. Read this entire file, the final definitions of migrations `0133` through `0162`, the
   current `PlacePanel`, visit-detail route, stats RPCs, `detect-trips`, and trail rollup code.
2. Open the authenticated card preview supplied by Erica:
   `https://claude.ai/code/artifact/7d3ec882-b79c-4c7c-a889-69bcfaa618ed?via=auto_preview`.
   Capture desktop and mobile screenshots for comparison. If it cannot be opened, stop the
   visual portion and ask Erica for screenshots; do not claim it was reviewed.
3. Compare that preview with the locked card rules in §2. Preserve its visual language:
   cover, type, colors, spacing, ratings, blue section rules, section order and footer.
   The redesign is a data/interaction correction, not a new visual concept.
4. Run a read-only production preflight. Report row counts and exceptions; never print keys,
   tokens, exact private coordinates, or private notes. At minimum measure:
   planned/taken visits, exact duplicate visits, overlapping visits, deleted/draft places
   still contributing to stats, legacy `trip` tags, orphan `trip_people`/`trip_notes`,
   `part_of`/`place_membership` disagreement, and trail/member same-outing duplicates.
5. Take and verify a recoverable database backup before any production migration.
6. Create new sequential migrations. Never edit an already-applied migration.

### 0.2a PREFLIGHT RESULTS — recorded 2026-08-12, production READ-ONLY

Nothing in production was changed to produce this. No keys, tokens, coordinates or notes
are reproduced here.

**Backup taken and PROVEN restorable first (§0.2.5).** `db/2026-08-12/s0-preflight-…age`,
2.44 MB, encrypted. Restored into a disposable Postgres 17 from the migration chain:
**all 38 tables matched the manifest exactly, 18,834 rows, zero errors.**

| #  | Measure                                          | Result                                                                                                     |
| -- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1  | Visits by status                                 | **489 taken, 0 planned.** 52 multi-day, 9 carry `is_trip`                                          |
| 2  | Exact duplicate visits                           | **0**                                                                                                |
| 3  | Overlapping visits at one place                  | **0**                                                                                                |
| 4  | Deleted/draft/suggested places with taken visits | **7 places, 8 visits** — none deleted or suggested; all are `saved = false`                       |
| 5  | Legacy`trip` place tags                        | **0**                                                                                                |
| 6  | Orphan`trip_people` / `trip_notes`           | **0 rows each** (the tables still exist)                                                             |
| 7  | `part_of` vs `place_membership`              | **In perfect sync** — 0 either way, 19 rows each. Only `relationship_type` in use is `contains` |
| 8  | Trail/member same-outing duplicates              | **78 pairs** — 77 trail visits, 78 section visits, across 7 trails                                  |
| 9  | Attribution                                      | 388 visits name a profile;**101 use null-means-both**                                                |
| 10 | `activities.visit_id`                          | **Does not exist.** 445 activities, and **0 rows with `source='drawn'`**                     |
| 11 | Trails                                           | 6 trails, 19 membership rows, 143`counts_as_place`                                                       |
| 12 | §0.3's new visit fields                         | **None exist yet** — clean slate                                                                    |
| 13 | Headline numbers today                           | 132 places, 489 taken visits, 16 trips (Both)                                                              |
| 14 | Authorization surface §0.4 must audit           | **127 SECURITY DEFINER functions**, 43 public tables                                                 |

**What this changes about the plan:**

- **Item 8 is the only large data problem.** 78 pairs is the same duplication found on
  2026-08-11 and deliberately left alone. §0.5.6 says resolve it through an audit table and
  explicit review, never a mass delete — and the numbers confirm that is the right call:
  77 of the trail-level visits are involved, so a blind delete would touch most of the
  Appalachian Trail's history.
- **Item 7 removes a whole risk.** `part_of` and `place_membership` already agree exactly,
  so the §0.3 migration off `part_of` is a rename of the source of truth, not a
  reconciliation. `trail_section` still has to be added to `relationship_type`.
- **Item 10 removes another.** There are **no** `source='drawn'` activities, so the
  `trail_routes` migration has no ambiguous legacy rows to classify — §0.5's "migrate
  current drawn rows carefully" is a no-op on this dataset.
- **Item 1 means the planned-visit rules are untested by real data.** 0 planned visits
  exist, so §0.9's planned/cancelled tests must be built on fixtures.
- **Item 4 is smaller than it looks.** None are deleted or suggested; all 7 are
  `saved = false` auto-created admin areas. They need a decision, not a cleanup script.
- **Item 6:** the tables are empty but still present, so §0.7's removal is safe whenever
  the parity phase completes.

**§0.7's first requirement is already satisfied:** `detect-trips-nightly` was already
unscheduled (production has three cron jobs — `dedupe-joint-outings`, `purge-trash`,
`rebuild-revealed-area`), and the Edge Function deployment was deleted 2026-08-12. It
cannot run during the migration because it no longer exists.

**VISUAL REFERENCE — RESOLVED BY ERICA, 2026-08-12: "it is acceptable."** The published
artifact source (held locally, and the same content the artifact serves) is the approved
visual reference for §0.6. Screenshots of the authenticated page were never obtainable
here; that is recorded below rather than papered over, and her decision closes it.

**⚠️ Why it was blocked, for the record — not done by Claude, not claimed.** The authenticated artifact
`7d3ec882…?via=auto_preview` returns *"Page not found – Claude / Sign in"* to this
browser, and the content frame (`…frame.claudeusercontent.com`) 404s unauthenticated. The
HTML Erica pasted is the claude.ai shell, not the card — the card renders inside a
sandboxed iframe. Claude published that artifact and still holds its exact source, and
rendering that source locally confirms the STRUCTURE matches §2: section order Visits →
Photos and videos → Routes → Notes and reviews, rating under the name, cover with close
control, address line, category pills, Save/Cancel footer, the trail question asked once,
and none of the banned words. **But screenshots cannot be captured in this environment**
(the tool times out), so desktop and mobile rendering have NOT been visually compared.
Per §0.2.2 this is reported, not glossed: **Erica needs to supply screenshots**, or
confirm that the published source is an acceptable reference.

**⚠️ CONFLICT TO NAME — §0.2.6 vs work already merged today.** §0.2.6 says *never edit an
already-applied migration*. Earlier on 2026-08-12, in merged PR #30, migrations `0001` and
`0044` **were edited** — guarded, so a fresh database could apply the chain at all (it was
previously appliable only through `scripts/db-bootstrap.sh`). No object definition changed
and the end state is identical, but the rule was broken before it existed. Recorded here
rather than left for someone to discover. From now on: new sequential migrations only.

### 0.4a PARITY PROVED — on a production-shaped snapshot, 2026-08-12

§0.8 phase 4. Today's encrypted backup was restored into a disposable **Postgres 17**,
the idempotent backfills were run against that real data, and the old counting was
compared with the canonical `accepted_visits` + `visit_profiles` model.

| Scope           | Places old → new   | Visits old → new   | Trips old → new  |
| --------------- | ------------------- | ------------------- | ----------------- |
| **Both**  | 52 →**52**   | 101 →**101** | 16 →**16** |
| **Erica** | 128 →**128** | 442 →**442** | 42 →**42** |
| **Josh**  | 57 →**57**   | 148 →**148** | 29 →**29** |

**Every number matches. There is no intentional difference to explain yet** — which is
the point of doing this before switching any reader: the new model reproduces today's
answers exactly, so a later change in a number will mean a real decision rather than an
accident.

Backfill results on that snapshot:

- **participants:** 590 rows across all 489 visits, 2 real members, **0 sent for review**
- **activities → visits:** **445 linked, 0 ambiguous, 0 with no covering visit**

The zero-ambiguity result is worth stating plainly, because the 78 known trail/member
same-day pairs were expected to produce two candidate visits. They did not: each
activity sits at ONE place, and the duplicate pairs are a trail visit and a *section*
visit — different places — so the "same place, covering day, exactly one candidate" rule
never had to choose. The duplication is still there and still needs §0.5.6's review; it
simply does not corrupt the activity links.

**A disaster-recovery bug was found and fixed doing this.** `jsonb_populate_record`
leaves a column that is absent from an older dump as NULL — it does **not** apply the
column default — so the moment `0163` added NOT NULL columns, restoring **any earlier
backup** died with *"null value in column trip_marked violates not-null constraint"*.
The backup you need is always older than the schema you restore onto, so this would have
bitten precisely when it mattered. `scripts/verify-restore.sh` now inserts only the
columns the dump actually contains and lets the schema default the rest, and reports
which columns were newer than the backup.

### 0.5a READERS SWITCHED — parity held, 2026-08-12

§0.8 phase 5. `wander_stats` and `trips_list` now read the canonical model, and the
numbers did not move — measured again through the live functions against a restored
production snapshot:

| Scope | Places        | Miles  | Trips        |
| ----- | ------------- | ------ | ------------ |
| Both  | **52**  | 436.5  | **16** |
| Erica | **128** | 1956.8 | **42** |
| Josh  | **57**  | 992.6  | **29** |

`trips_list(null)` returns exactly 16 rows — the list and the count now come from the
same definition and cannot disagree.

**A hardcoded household size was caught by the test suite.** The obvious translation of
`solo_profile IS NULL` was "exactly two participant rows" — which bakes in that this
household has two people. `0137` failed immediately: *"marking a visit as a trip must add
one trip (0 -> 0)"*, because a test database does not happen to contain two members.
The honest rule is about membership, not arithmetic: **a visit is shared when every real
member was on it** (`public.is_shared_visit`). Two members gives exactly the 101 that
`solo_profile IS NULL` gave; one gives that person's visits; three gives what all three
shared. Nothing hardcodes 2 — which matters, because adding a third person is the entire
point of the shared-group work.

The same mistake was in the WRITER trigger and was fixed there too: `NULL` means "not
solo", so it now populates every real member when the household is small enough for that
to be unambiguous (one or two), and sends the row to review at three or more rather than
guessing which two were meant.

### 0.7a APPLIED TO PRODUCTION — 2026-08-13

§0.8 phase 7. Migrations `0163`–`0169` are live. **Parity held exactly.**

| Scope | Places              | Visits              | Trips             |
| ----- | ------------------- | ------------------- | ----------------- |
| Both  | 52 →**52**   | 101 →**101** | 16 →**16** |
| Erica | 128 →**128** | 442 →**442** | 42 →**42** |
| Josh  | 57 →**57**   | 148 →**148** | 29 →**29** |

Measured on production before the migration with the OLD rules, and after it through the
CANONICAL model. Not one number moved, which is the whole point of phases 3–6.

**Migration ledger versions recorded** (the Management API runs SQL and records nothing —
the 2026-08-11 audit found eight applied-but-unrecorded migrations, and a restore rebuilds
from this ledger):

    20260813170000  0163_visits_gain_a_spine
    20260813170001  0164_add_an_activity
    20260813170002  0165_who_was_there
    20260813170003  0166_evidence_and_trail_routes
    20260813170004  0167_link_activities_to_their_visit
    20260813170005  0168_the_numbers_read_the_canonical_model
    20260813170006  0169_one_way_to_change_a_visit

**Backfill results in production:**

|                              |                                                             |
| ---------------------------- | ----------------------------------------------------------- |
| participant rows             | **590** across all 489 visits, **0 for review** |
| activities linked to a visit | **445 of 445**, **0 ambiguous**, 0 orphaned     |
| evidence rows                | **620**                                               |
| accepted visits              | **489** — all of Erica's history                     |
| dropdown options seeded      | **8**                                                 |

**Frontend state:** `15458752` — unchanged, and deliberately so. The app still writes visits
directly; both spellings of every field stay in step during the compatibility period, so
this migration is invisible to anyone using the site. `verify:live` confirms it: the same
**18 checks pass and the same 4 fail** as before, and the 4 are the UI work that has not
been built yet, not regressions.

Types regenerated from the deployed schema; `tsc` clean; 112 unit tests pass.

**Pre-migration backup**, taken and PROVEN restorable first:
`db/2026-08-13/pre-phase7-aon-db-2026-08-13.tar.gz.age` — 18,838 rows, all 38 tables
matching on restore into a disposable Postgres 17.

### 0.3 Target database model

#### Places

`places` remains the identity table for every real location. A city, restaurant, beach,
trail, trail section and destination are places. Keep stable IDs and existing media links.

- A normal place or trail section counts once after it has an accepted, taken visit.
- A trail rollup does not count as another Place; its visited sections already count.
- A deleted, suggested, rejected or otherwise unaccepted place never contributes to
  historical statistics.
- `counts_as_place` may remain a generated compatibility field, but statistics must use the
  canonical accepted-place view rather than trusting miscellaneous cached flags.

#### Visits

Add the following fields additively to `visits` (use exact types and constraints appropriate
for Postgres; names below are the contract):

```text
parent_visit_id  uuid null references visits(id) on delete set null
trip_marked      boolean not null default false
source           text not null  -- manual | evidence | import | approved_suggestion
accepted_at      timestamptz null
accepted_by      uuid null references profiles(id)
updated_at       timestamptz not null
```

Migrate the meaning of the existing `is_trip` human decision into `trip_marked`. During the
compatibility period, keep one synchronized interface or compatibility view; do not leave two
writable trip flags. Remove the old column only after all code and production data are proven.

Constraints and guarded RPC logic must enforce:

- `end_date >= start_date`;
- a visit cannot parent itself;
- parent chains cannot cycle;
- a child visit must fall inside its parent visit's date range;
- a parent must be accepted and `status='taken'` before taken children can be attached;
- participant compatibility must be checked when a child is attached;
- automation cannot write `parent_visit_id`, `trip_marked`, participants, accepted fields, or
  other human decisions directly. It creates a suggestion.

One canonical SQL function/view defines trip qualification:

```text
counts_as_trip =
  status = 'taken'
  AND accepted_at IS NOT NULL
  AND (end_date > start_date OR trip_marked)
```

Every trip number, list, card drill-down and containment reader must use that definition.
No UI component may reimplement it.

#### Participants

Replace null-as-data attribution with explicit rows:

```text
visit_profiles(visit_id, profile_id, created_at, primary key(visit_id, profile_id))
visit_people(visit_id, person_id, created_at, primary key(visit_id, person_id))
```

`visit_profiles` is for account holders such as Erica and Josh. `visit_people` remains for
children, pets and companions without accounts. Backfill `visit_profiles` from
`solo_profile`: a non-null value becomes that profile; null becomes the two currently active
member profiles only when the legacy row truly meant Both. Put ambiguous rows into a review
table; never guess additional participants.

Keep `solo_profile` read-only during compatibility, compare old/new counts, then remove it and
all null-special-case filters in a later migration.

#### Visit evidence

Create an auditable evidence relationship:

```text
visit_evidence(
  visit_id,
  evidence_type,   -- photo | activity | location_ping | entry
  evidence_id,
  evidence_date,
  source_key,
  created_at,
  primary key (visit_id, evidence_type, evidence_id)
)
```

Use database validation or typed link tables if needed to preserve referential integrity.
Every derived visit must be explainable from its evidence. Moving or deleting evidence queues
a reconciliation proposal; it must not silently rewrite an accepted visit. Imported evidence
needs a stable, unique `source_key` so retries are idempotent.

Add `activities.visit_id` and link an activity to the accepted visit it occurred during.
Photos already have a visit link. Routes, photos, entries and notes displayed on a visit card
must be selected by visit identity, not merely by an overlapping date.

#### Canonical relationship and mutation APIs

- `place_membership` is the only canonical place hierarchy. Extend its
  `relationship_type` to include `trail_section` as well as general containment, and add an
  optional per-parent display label/order only if the preview requires it.
- Move every reader and writer from `places.part_of` to `place_membership`, verify parity,
  then remove `part_of` and its mirroring triggers in a later migration.
- Revoke direct authenticated writes to canonical visits and relationship tables after the
  frontend has moved to atomic RPCs.
- Provide atomic, authorized RPCs for creating a place with its first visit, creating a visit,
  editing a visit, deleting/restoring a visit, moving a visit, setting participants, attaching
  or detaching a child visit, and attaching evidence.
- Every RPC must be idempotent, permission-checked, transaction-safe, and return the refreshed
  card/read model. A dropped connection must not create a duplicate visit.

### 0.4 Canonical counting rules

Create one accepted/taken visit view and make all stats, badges, lists, cards, Smart Albums and
exports read it.

| Number           | Exact rule                                                                             |
| ---------------- | -------------------------------------------------------------------------------------- |
| Places           | Distinct accepted, nondeleted, non-trail places with at least one accepted taken visit |
| Place visits     | Accepted taken visits whose`place_id` is that place, including child visits          |
| Headline Visits  | Accepted taken visits with`parent_visit_id IS NULL`                                  |
| Trips            | Top-level accepted taken visits satisfying canonical`counts_as_trip`                 |
| Planned          | Accepted`status='planned'`, shown separately and never in historical totals          |
| First/last visit | `min(start_date)` / `max(end_date)` over accepted taken visits                     |
| Miles            | Sum accepted activity distance once per stable/shared source identity                  |
| Trails taken     | Distinct trail rollups with an accepted taken visit on the trail or a member section   |

A Cape Cod Aug 2–7 parent visit containing Linnell Landing, a restaurant and a museum is one
headline Visit, one Trip, and four distinct Places. Each child place still shows its own visit.

Stop using `places.visit_count`, `first_visit` and `last_visit` as independent facts. Prefer
the canonical view at the current dataset size. If performance later requires caches, they
must be maintained for insert/update/delete/restore/move and proven against the view in tests.

All `SECURITY DEFINER` stats functions must explicitly filter authorization, acceptance,
`status`, `deleted_at`, draft/suggestion state and participants. Never assume RLS filters rows
inside a definer function.

### 0.5 Working trail model

A trail is a place rollup, not an outing and not an activity.

```text
Trail place (does not increment Places)
└── place_membership relationship_type='trail_section'
    ├── Section place (counts as a Place when visited)
    └── Trailhead/section place (counts as a Place when visited)
```

Rules:

1. A real outing has one canonical visit row. If the section is known, `visits.place_id` is the
   section. Do not also create a visit on the parent trail. If the section is unknown, the
   visit may temporarily belong directly to the trail and be moved later through an RPC.
2. A trail card rolls up visits, activities, photos and miles from the trail and its member
   sections. Deduplicate by stable visit/evidence/activity identity, never merely by calendar
   day: two genuine outings on one day are still two visits.
3. The visit row on a trail card displays the section name from canonical membership. There is
   no separate Sections list on the card.
4. `trails_taken` counts a trail once if any qualifying direct or member visit exists. A trail
   itself does not increment Places; visited section places do.
5. Expand `place_membership` queries recursively only where nested trail structures are
   intentionally supported, with cycle prevention and bounded depth.
6. Resolve the known trail/member duplicate data through an audit table and explicit review.
   Do not mass-delete manual visits. Future ingest must attach duplicate evidence to the same
   visit instead of creating trail-level and section-level twins.

A drawn trail definition is not a completed activity. Create a separate table for reference
geometry:

```text
trail_routes(
  id,
  trail_place_id,
  section_place_id null,
  name,
  geometry/polyline,
  distance_m,
  source,            -- drawn | osm | import
  created_by,
  created_at,
  updated_at
)
```

Actual hikes, walks, runs and rides remain `activities`, link to `visit_id`, and contribute
miles. A reference `trail_route` draws the trail but never creates a visit or adds mileage.
Migrate current `source='drawn'` rows carefully: classify them from usage and put ambiguous
ones in review rather than assuming they are reference paths or completed outings.

Expose one `trail_card(place_id, viewer_profile_id)` RPC/read model returning the trail header,
canonical visit rows with section names, participant-scoped counts, actual activities, reference
geometry, media and totals. The frontend must not reconstruct trail rollups independently.

### 0.6 Card implementation — keep the style, fix the contract

The authenticated artifact above is the visual reference. Preserve the locked structure:

1. cover with close control;
2. name over the cover;
3. ratings immediately beneath the name, two columns when two raters exist;
4. address and a human sentence such as “Visited twice · 12 photos” or visit dates;
5. category pills, excluding city/region pills;
6. sections in this order: **VISITS**, **PHOTOS AND VIDEOS**, **ROUTES**, applicable place
   categories such as **RESTAURANTS**, then **NOTES AND REVIEWS**;
7. footer actions. Destination/trail: “Add another visit” and “Delete”. Blank card: Save and
   Cancel. Visit editor: Save and Cancel, with destructive actions visually separated.

Build one shared card shell with typed modes (`place`, `visit`, `activity`, `trail`, `new`).
Do not keep one enormous component full of mode-specific queries. Separate presentation from
backend adapters, and pass a stable card view model into the shared shell.

Backend/card contract:

- Add a versioned `experience_card`/`visit_card` read RPC or equivalent typed query returning
  the complete mode-specific view model. Avoid dozens of browser requests and frontend joins.
- Header totals and list rows come from the same returned dataset so labels cannot disagree.
- Every row has stable IDs and explicit `can_edit`; do not infer permissions in JSX.
- Loading, empty, saving, saved, error and stale-suggestion states must be visible and usable.
- Preserve unsaved input after an RPC error. Never silently catch a failed write and render an
  empty list as the current helpers do.

#### Destination card

- Visits are grouped by year, newest first; only years with visits appear.
- Each visit row shows formatted dates, participant names and a quiet evidence summary.
- A qualifying parent visit may show “3 places” and expand its explicit child visits.
- Do not show passive “Trip” badges. Qualification changes presentation only through the
  explicit nested contents and trip statistics.
- “Add another visit” opens the inline visit form and saves through one atomic RPC.

#### Visit card/editor

- Scope every section to `visit_id`: media, routes/activities, notes, reviews and child places.
- Use an explicit Save action for the complete edit. Do not autosave start and end dates as
  separate writes; an intermediate invalid range must never reach the database.
- Fields: date range, `planned/taken/cancelled` status if cancelled is added, participant
  multi-select, note, “Count this as a trip” switch, optional parent trip selector, and child
  visit management when this visit qualifies as a trip.
- The switch writes `trip_marked`; a multi-day visit qualifies without setting it. Explain
  this in helper text: “Multi-day visits already count. Turn this on only for a single-day
  trip.”
- Attaching a child opens a search of existing visits first. Creating a new child visit is a
  secondary action. Never create a duplicate place merely to add it to a trip.
- Show evidence read-only with its source and date. Corrections use explicit move/detach
  actions that create auditable writes.

#### Trail card

- Use the exact shared visual shell and section order.
- The sub-line reads naturally: “Visited 35 times · 44.8 miles · 27 photos”.
- VISITS contains direct and member-section visits once each; the section name sits on its
  visit row. No Sections list.
- PHOTOS AND VIDEOS rolls up media linked to those canonical visits.
- ROUTES shows a map and list of actual activity routes; reference trail geometry may appear
  as map context but must not be counted as an outing or miles.
- Do not show Restaurants on a trail card unless Erica later explicitly approves it.
- “Add another visit” asks for date(s), participants and an optional section. “Add/edit trail
  route” is a distinct edit action because drawing the trail is not logging an outing.

#### Blank/new card

- Same shell with empty fields, not a separate form design.
- Ask “Is this a trail with sections?” once. If yes, create the trail place and optional
  reference route; create a first visit only when the user supplies an outing date.
- For a normal place, saving with a supplied date creates the place and first visit atomically.
- Address is prefilled from the tapped map location and remains editable.

Accessibility and responsive acceptance:

- mobile width 320–430 px and desktop;
- keyboard-accessible disclosures and controls;
- visible focus, proper labels, `aria-expanded` and `aria-pressed` where appropriate;
- 44 px touch targets for primary actions;
- no color-only status; no modal hidden behind the map/search stacking context;
- existing typography, colors and spacing tokens are reused instead of introducing a second
  design system.

### 0.7 Automation and legacy cleanup

The first production migration must unschedule `detect-trips-nightly`. The current Edge
Function writes retired trip-places and visits directly; it must not run during this migration.
Its replacement may create `suggestions` with evidence and confidence, but may not mutate
places, visits, membership, participants or statistics.

After parity and production verification, remove:

- orphan `trip_people` and `trip_notes` plus their grants, policies, helpers and generated
  types;
- dead `trip_timeline`/trip-note frontend helpers;
- legacy trip-category code and scheduled detector;
- direct visit mutation helpers;
- `places.part_of` and sync triggers after every reader uses `place_membership`;
- `solo_profile` after participant parity;
- misleading comments and tests describing superseded rules.

Search the entire repository, including Edge Functions, cron migrations, generated types,
tests and `docs/STATE.md`; cleanup is not complete while an executable retired mechanism or
contradictory current instruction remains. Historical passages may remain only when clearly
marked superseded.

### 0.8 Required migration sequence

Do not ship this as one destructive migration.

1. **Freeze and measure:** unschedule the detector; backup; production read-only audit.
2. **Add:** new columns, participant/evidence/trail-route tables, constraints, indexes, RLS and
   RPCs. No old column/table removal.
3. **Backfill:** idempotently populate participants, accepted state, evidence and memberships;
   quarantine ambiguity.
4. **Prove parity:** old/new counts by Both/Erica/Josh, cards for representative destination,
   multi-day visit, single-day marked visit, trail, planned visit, deleted place and draft.
5. **Switch readers:** canonical views/RPCs, then frontend card and all stats/badges/exports.
6. **Switch writers:** atomic RPCs only; revoke direct authenticated writes.
7. **Observe:** deploy preview, complete authenticated mobile/desktop verification, then
   production. Re-run counts and inspect logs.
8. **Remove:** only after explicit production sign-off, remove legacy schema and frontend code
   in a later migration.

Every phase is its own commit with a plain-language message. Do not mix backup/Cloudflare/GitHub
workflow repairs into the schema commits. Do not deploy production while required CI is red.

### 0.9 Tests that make the decision permanent

Database tests must prove at least:

- planned/cancelled visits do not affect historical counts;
- deleted, suggested and unaccepted places do not count;
- a multi-day visit appears in both trip count and trip list and can own explicit children;
- a marked single-day visit counts as a trip;
- unmarking it reverses only that human decision;
- child visits count on their place cards but not as extra headline Visits;
- a Josh-only parent cannot swallow an Erica-only child;
- parent cycles and out-of-range children are rejected;
- two real same-day outings remain two visits;
- an idempotent retry remains one visit;
- moving/deleting/restoring a visit updates every relevant read model;
- first/last dates can move inward and clear;
- evidence deletion cannot erase an accepted decision;
- one trail-section outing is one visit, one trail outing and one activity distance, never a
  parent/section twin;
- reference trail geometry adds zero visits and zero miles;
- `place_membership` cannot dangle or cycle;
- anon cannot execute mutation or private read RPCs; viewer/editor/owner rules remain intact.

Frontend tests must prove the shared card order and banned content, plus:

- destination, visit, trail and blank modes render the same shell;
- counts and rows use the same backend payload;
- visit Save is atomic and errors preserve input;
- participant multi-select round-trips explicit rows;
- trip children are explicit, editable and never date-inferred;
- trail visits show section names without a Sections list;
- planned visits are visibly planned and absent from historical totals;
- the card passes the existing accessibility suite at mobile and desktop sizes.

Run the full local migration chain from an empty database, all SQL regression tests, generated
type checks, unit/component tests, production build and the deliberately small browser smoke
suite. Do not delete meaningful tests to make CI faster; move volatile pixel/copy assertions
out of required CI while retaining data-contract, accessibility and core-flow coverage.

### 0.10 Definition of done

Claude must not say this is complete until all of these are true:

- one current model in this file and no executable contradictory mechanism;
- clean migration from empty database and from a production-shaped snapshot;
- old/new parity report reviewed, with every intentional count difference explained;
- detector disabled or proposal-only;
- no direct frontend writes to canonical visit/membership state;
- generated Supabase types match the deployed schema;
- destination, visit, trail and blank card verified against the authenticated artifact on
  mobile and desktop;
- GitHub required checks green;
- Cloudflare preview shows the same tested commit;
- production migration and deploy IDs recorded here;
- post-deploy read-only counts and representative cards verified;
- backup restoration instructions still match the final schema and no longer list retired
  `trips`/`trip_stops` tables.

If any of those is missing, report **in progress** or **blocked**, name the exact gap, and do
not start another redesign.

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

## 2. THE SYSTEM — LOCKED, 2026-08-11

> Erica: *"Make sure you understand it and everything in STATE.md, memory, and history
> understands the system — by system, I mean the way that visits and places are recorded and
> statistics are gathered. I DO NOT WANT TO KEEP REBUILDING THIS."*
>
> **This is the definition. Everything — schema, RPCs, stats, cards, memory — answers to it.**
> If code disagrees with this section, the code is wrong.

### The three nouns

**PLACE** — somewhere she has been. **Counts ONCE in Places**, however many times she goes.
Adding a place is already its first visit.

**VISIT** — **one date, or one set of dates.** Never a scattered collection. **Counts every
time.** A second visit to the same place makes it *a place visited twice*; it does not make a
second place.

**ACTIVITY** — a hike, ride, walk or run. **An activity IS a route.** It lives in the Routes
section, labelled by what it was. It is not a pill, not a tag, and not its own section.

### TRIP — counted, never labelled

**A visit of more than one day counts as a Trip in the stats bar. Nothing is labelled a trip,
anywhere.**

⚠️ **This looks like a rule that was deliberately removed, and the difference matters.**
Migration `0047` made `visits.is_trip` a GENERATED column (`end_date > start_date`), which
promoted every multi-day visit to a trip *by arithmetic* — **50 of 485 visits were flagged
trips Erica never marked**, and the flag then drove labels and fusing behaviour. That is why
§10 says never to reintroduce a derived `is_trip`.

What is being asked for now is **not that**:

| Removed in 0133                               | What Erica asked for, 2026-08-11                                     |
| --------------------------------------------- | -------------------------------------------------------------------- |
| A**stored flag** on the visit row       | **No stored flag**                                             |
| Drove UI labels ("· Trip")                   | **Nothing in the UI says Trip** — already removed from Visits |
| Changed rebuild fusing behaviour              | **Changes nothing but a number**                               |
| Could be wrong about a specific visit forever | A count, recomputed from the dates every time                        |

So: **the stats bar counts visits whose end date is after their start date. No column, no
label, no behaviour.** That satisfies both her instruction and the reason 0047 was reverted.
**✅ DONE AND VERIFIED LIVE, 2026-08-11** (`a4f10ed1`, migrations `0159` + `0160`). The bar
now reads **16 trips** in the shared view, and tapping it opens all 16 in her format:
"Cape Cod · 8/2 - 8/7 · 5 nights".

The jump, measured after the fact rather than estimated: **Erica's view 9 → 42**, **Both
8 → 16**, **Josh 8 → 29**. (The earlier note here said 9 → 52; that counted every visit
row, including ones the stats bar excludes — it only counts `status='taken'` and the
current person scope. 52 is the *places* number.) Most multi-day stays were never marked;
the jump is the intended effect and is recorded here so nobody later "fixes" it back.

**TWO RULES COLLIDED, and both are honoured.** Deriving Trips purely from the dates would
have silently uncounted **three visits marked as trips BY HAND on a single day** — an
automation erasing a human decision, which is what `0157` exists to prevent. So the rule
is: **more than one day, OR marked by hand.** Nothing is erased and nothing needs a label.
Erica: if you want those three to stop counting, unmark them and the number follows.

`is_trip` stays as a thing a person may set — it just stopped being *required* for the count.

### How statistics are gathered

| Stat             | Counts                                                                           |
| ---------------- | -------------------------------------------------------------------------------- |
| **Places** | Distinct places visited —**each place once**                              |
| **Visits** | Every visit, every time                                                          |
| **Trips**  | Visits spanning**more than one day** — derived at read time, never stored |
| **Miles**  | Sum of activity distance                                                         |
| **Routes** | Activities with a track                                                          |

### What every card shows

- **A cover photo on every card.** An activity with no photo shows **the letter of the
  activity** instead — H for hike, R for run, B for biking, W for walking. A letter, because
  there are no icons.
- **The rating under the name**, in **two columns — one line across when there are two
  raters**. Anyone added to the card can rate it.
- Everything on a **visit** card is scoped to that visit. The **destination** rolls up every
  visit.

### THE CARD — LOCKED, approved 2026-08-11

> Erica: **"never redesign the card or add or delete anything from its template without
> my EXPRESS permission and approval of a preview."**

Approved preview (v5): https://claude.ai/code/artifact/8dafa822-fca5-460b-a58f-c914e89cdb97

**This section is the record of what she approved.** It was missing from STATE.md until
2026-08-11 — the one thing she locked was not written down anywhere, which is exactly how
a card gets rebuilt wrong. It is transcribed from the approved preview, not reinvented.

**ONE card. Five things use it and nothing about the template changes between them:**
a destination, a visit, an activity, a trail, and a blank new one.

**Top to bottom, always in this order:**

1. **Cover photo**, with × to close. No photo and it is an activity → **the letter of the
   activity** (H hike, R run, B biking, W walking). Never an icon.
2. **The name**, over the cover.
3. **Ratings, directly under the name** — one row per rater, `Name ★★★★★`, laid out in
   **two columns so two raters read as one line across**. A third wraps to the next line.
   Dim stars mean not rated yet. Anyone added to the card gets their own row.
   *(Her last note on the preview: reduce the space between the name and the stars.)*
4. **The address**, then a **sub-line** saying what this is in plain words:
   "Visited twice · 12 photos" · "Visited 62 times · 44.8 miles · 27 photos". On a VISIT
   card the sub-line is that visit's dates. Never a raw flag or a count with no noun.
5. **Category tags** as pills — Dining, Beach, Winery. **Never city or region pills.**
6. **The sections**, each headed by a **blue rule with an UPPERCASE WHITE heading**, and a
   quiet count or scope on the right ("12 · every visit"):| Section                     | Holds                                                                                                                                                              | On a VISIT card          |
   | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
   | **Visits**            | Years as**dropdowns** (Show / Hide), newest first, only years that have visits. Inside, one line per visit: the date, and the segment name if it is a trail. | the one visit            |
   | **Photos and videos** | ONE carousel, in date order, each with its date and the ♥ / 🔥 marks                                                                                              | scoped to the visit      |
   | **Routes**            | A map showing**every route from every visit**, then the list: name · type · miles · date. **Hikes, biking, walking and running all live here.**     | only that visit's routes |
   | **Restaurants**       | name + stars. Not on a trail card.                                                                                                                                 | scoped to the visit      |
   | **Notes and reviews** | note + date, and "Write a note or review" at the bottom                                                                                                            | scoped to the visit      |
7. **The footer**: "Add another visit" · "Delete". On the blank card: **Save · Cancel**.

**The blank (new) card** is the same card with the fields empty: "Add a cover photo",
"Name this place", the address **prefilled from where you tapped and editable**, and one
extra question asked **once, here only** — *"Is this a trail with sections?"* Its Visits
section says **"this is visit one"**, because **saving a new place IS its first visit**.
Routes and Restaurants say "Added once this first visit is saved".

**Gone from every card, and it stays gone:**

- the **Activities** section — hikes, rides, walks and runs are **routes**, and live in Routes
- **activity pills**
- the words **"Tap a date"**, **"Trip"** and **"Together"**, out of the Visits section entirely
- the **Sections** list on a trail — a segment name rides on the visit, so a trail's Visits
  section reads exactly like every other card's
- **"This is a Trail"** on a destination/visit card
- **city and region pills**, **"N places inside"**, **"+ Put a place inside this one"**,
  the blue **"+ Write a note"** link, and the **PLACES HERE** section

**Dates, everywhere on the card** (implemented once in `app/src/lib/visitDates.ts`, tested):
a single date is **"May 2"**, a range is **"5/4 - 5/7"**, and dates are **grouped by year**.

#### Building it — status 2026-08-11 (destination card)

Verified live on adventureorno.com, San Diego, deploy `cef831d0`:

| Locked                                                                                   | Live                                                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Section order: Visits · Photos and videos · Routes · Restaurants · Notes and reviews | ✅ (was Visits · Photos · Notes · "Routes here")                                        |
| Routes holds the map**and** the list (name · type · miles · date)               | ✅ 6 routes listed under the map                                                           |
| Restaurants is its own section, plural                                                   | ✅ "Restaurants (2)", "Beaches (1)" — they were folds inside Notes                        |
| No "Places" section                                                                      | ✅ removed;**3 places app-wide have no category and need one** (Fort Rosencrans + 2) |
| The name, then the rating under it                                                       | ✅ (the stars were above it)                                                               |
| Sub-line says what this is                                                               | ✅ "Visited once · 12 photos" (was "· 1 visit")                                          |
| A single date "May 2", a range "5/4 - 5/7"                                               | ✅ everywhere on the card, via`lib/visitDates.ts` (tested)                               |
| No "Trip", no "Together" in the Visits section                                           | ✅ both gone; the who-was-here control says "Both"                                         |
| Photos: one carousel, the marks on it                                                    | ✅ (`0913f05d`)                                                                          |

**Still to build on the card — CHECKED AGAINST THE CODE 2026-08-15.** This list was
written 2026-08-11 and had gone stale: six of its seven items are built. Leaving it
standing is how work gets done twice, which §0.7 exists to prevent.

| Was on the list                                                       | Now                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Years as dropdowns** inside Visits                            | ✅`.visit-year` details, newest open, asserted in `lockedCard.test.ts`     |
| **Ratings in two columns**, anyone on the card rates it         | ✅`.dual-rating`, one line across, mapped over every member                  |
| **Category pills** show the whole palette when you can edit     | ✅ the full`CATEGORIES` palette when `canEdit`, this place's tags when not |
| The**VISIT card** carries every section, narrowed to that visit | ✅`VisitPage`: what we did, photos and videos, notes                         |
| The**TRAIL card**: no Sections list, segment on the visit       | ✅ asserted in`lockedCard.test.ts`                                           |
| The**BLANK card** — Add opens it                               | ✅`AddSheet` opens the card, asserted live in `verify:live`                |
| A**Save button that visibly freezes automation**                | ✅ 2026-08-14, PR#65 — and it says what it froze                              |

**The one thing genuinely not built:** the blank card does not ask *"Is this a trail with
sections?"* once. Nothing in the app contains that question. A trail is set by tapping
the Trail pill afterwards, which works but is not what was asked for.

### Remove anything that rewrites or confuses this

Nothing may re-derive, relabel or overwrite the above. Specifically retired and not to return:
a `trip` place category; a stored/derived `is_trip` driving labels or behaviour; activity
pills; an Activities section separate from Routes; a Sections list (segments are visits with a
segment name); "places here"; City/Region pills; "N places inside".

### The earlier wording of this model, kept for context

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

| Function           | What it means                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **Add**      | a place, a visit, an activity, by hand                                                                                       |
| **Import**   | Google Photos (guess the location from the photo's own coordinates, then let her correct it), file upload, Strava, the phone |
| **Ingest**   | what arrives automatically — proposed for approval, never written as fact                                                   |
| **Sort**     | photos into places and visits, with the location editable**right there**                                               |
| **Edit**     | names, locations, dates, who was there, categories, ratings                                                                  |
| **Organize** | sections into trails, places into trips and cities, merges                                                                   |
| **Delete**   | with undo                                                                                                                    |
| **Fix**      | duplicates, unnamed, unplaced — anything needing attention                                                                  |

`/photos/sort`, `/attention` and the Settings → Data grid **fold into Edit and stop
existing separately**. `/places/edit` survives **only** as the bulk spreadsheet, because
editing 149 rows at once is a genuinely different job.

Nothing gets added *beside* this page. Things get removed *into* it.

### Marking something done (her rule, 2026-08-11)

> **This file is updated ONLY after the change is verified live on the app.** Not when the
> code is written, not when it is committed, not when it is deployed — when it has been
> opened on the real site and seen working.

Plans may be written here in advance. **Status** may not: ✅ means seen on the screen.

### EVERY UI CHANGE NEEDS A PREVIEW SHE APPROVES FIRST (her rule, 2026-08-11)

> "From now on, I want a preview of every change to the UI BEFORE you change it, and I
> MUST approve it."

**This is absolute and it comes before shipping speed.** No change to anything a person
can see goes to the site until Erica has seen a preview of it and said yes. Not a
"small" one, not a "fix", not "while I was in there".

What this means in practice:

- Build the preview as a standalone page and send her the link. Wait.
- Backend, migrations, tests, docs and guards do NOT need a preview — they are not UI.
- **Undoing something she explicitly asked to be removed is not a new change**; her
  instruction IS the approval. Do it, and say so.
- If a preview is impractical for something, say so and ask, rather than guessing.

Why: she has now had to give the same UI instructions repeatedly, and the reason each
time was a change that reached the site without her seeing it first. The guard test
(`app/src/lib/lockedCard.test.ts`) stops banned things coming BACK; this rule stops new
ones going in.

### How a new direction gets handled (her rule, 2026-08-11)

> **If a new direction conflicts with this file, say so before acting.** Name the change
> it would make, ask whether that is what she wants, and only then write the decision
> here. Do not silently follow the newer instruction, and do not silently follow the
> older document.

This is not a licence to stop and ask about everything: it applies when a direction
CONTRADICTS something written here. Otherwise keep working (see
[[adventureorno-autonomy]] — she leaves for hours and expects progress).

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
  ⚠️ **This was FALSE from #94 (08-15) to 08-16** — the new-place card shipped an
  unlabelled date input and an unlabelled select, both critical. Found the first time the
  nightly browser suite could run again; fixed the same day. The claim is only ever as
  current as the last suite that actually ran, so read it with the nightly's status.

### Broken or wrong right now

1. ~~**The map is blank.**~~ FIXED 2026-08-10, and it was TWO faults stacked:
   - MapTiler suspended the account for exceeding quota (the idle auto-rotate had no
     stop condition; now bounded to 45s and never while hidden). The basemap is now
     **Mapbox raster tiles** — the OpenStreetMap/Mapbox look Erica asked for — with a
     30k/day tile meter, because through MapLibre Mapbox bills per TILE not per load.
   - **MapLibre 6 broke every worker-backed source.** Vector tiles, GeoJSON sources,
     clusters, routes and fog all silently rendered NOTHING — no error, no console
     message. Reproduced with a one-point GeoJSON source. Reverted to MapLibre 5,
     which CLAUDE.md pins as the stack anyway. Do not upgrade to 6 without checking a
     GeoJSON layer actually draws.
2. ~~**Containers are invisible in Places**~~ — fixed 2026-08-10. Places now lists each
   container once, holding its sections; `lib/containers.ts` decides what a container is,
   under test.
3. ~~**Sections repeat.**~~ — fixed 2026-08-10. Each section is listed once and opens to
   its dates.
4. **Data work is scattered** across six screens with different words for the same thing.
   4b. ~~**THE BIGGEST CONFLICT IN THE REPO: the machine writes visits.**~~ **FIXED
   2026-08-11, migration `0157`.** A person's decision is now permanent by
   CONSTRUCTION, not by remembering a flag: a trigger marks a visit decided whenever a
   signed-in person changes it (`auth.uid()` is null for every machine job, so the
   discriminator is free), pinning a photo marks its visit decided, the rebuild will not
   delete a visit that holds pinned photos, and a pinned photo no longer seeds a day of
   its own. Proven by replaying the destructive case in a rolled-back transaction: an
   unprotected visit holding a pinned photo survived with its photo attached. The
   original diagnosis is kept below because the SHAPE of it will recur.
   ORIGINAL: the machine writes visits.
   `rebuild_place_visits()` DERIVES visits from photo dates, ping dates, activity dates
   and entry dates, and **writes them as fact** — and deletes and recreates them on the
   next run unless `manual = true`. **476 of 488 visits are machine-derived; only 12 are
   protected.** That is the exact opposite of §2's rule, *a machine may only propose*.
   It is also the cause of the Virginia Beach complaint (2026-08-11): the race was
   **22 Mar**, but photos dated 3 Mar, 4 Mar and 20 Jul each produced their own visit, so
   the place reads as three. **34 of 176 photos carry a taken_at of exactly 12:00:00** — a
   placeholder, not real EXIF — so those dates were never trustworthy in the first place.
   §10 (the data model, below) documents the rebuild as intended behaviour, which makes this a
   conflict between the two documents, not just a bug.
5. ~~**Three doors to Add**~~ — fixed 2026-08-10: `/add` is the one door.
6. **Transient UI is not transient** (upload box, "finish importing").
   6b. **THE STRAVA RULE IS NOT ENFORCED IN THE APP** (found 2026-08-16). `0193` built
   `can_see_activity()` and a correct RLS policy, but **31 of the 32 SECURITY DEFINER
   readers of `public.activities` ignore both**, and SECURITY DEFINER bypasses RLS. Every
   count, card and statistic still shows each person the other's Strava-origin activities.
   Josh's personal approval settles it between him and Erica; it does not settle Strava's
   terms, so this is a hard precondition for Phase 7 and for charging anyone. See §7d.
   6c. **Nothing watches whether scheduled jobs SUCCEEDED** (found 2026-08-16).
   `dedupe-joint-outings` failed silently for eight consecutive nights. The watchtower
   probes URLs; `cron.job_run_details` has no reader.
7. **Sorting photos cannot edit the location** — removed 2026-07-26, see §7.

---

## 5. The plan

Each phase ends the same way: **it works when Erica drives it**, a test that fails if it
regresses, and this file records the decision and proof. Not "deployed and probably fine."

**The verification rule (see CLAUDE.md):** every change is opened in the app, on
production, after it deploys. Done means seen on the screen. When the database and the
screen disagree, the screen is right.

### Phase 0 — One source of truth ✅ (2026-08-10)

This file. Every other planning document was archived, then DELETED (2026-08-11). The "removed on
purpose" register in §7 exists so nothing is silently lost again.

### Phase 1 — Stabilize the private core  *(ACTIVE)*

- ✅ **The build FAILS when a required `VITE_*` is empty** (2026-08-11). A Vite plugin,
  `requireClientEnv` in `app/vite.config.ts`, refuses to build without the Supabase URL
  and key, or without at least one map source. Proven by blanking each and watching the
  build exit 1. `scripts/check-env-example.mjs` still only checks DOCUMENTATION — the two
  together now cover both halves.
- ✅ The only live Pages project is `adventureorno-com`; it owns `adventureorno.com` and
  `www.adventureorno.com`. Do not create another project. The earlier two-project notes
  were historical and are superseded by §12b.
- ✅ Production deployment is a GitHub Actions job behind the release gate and the
  `PRODUCTION_DEPLOY_ENABLED` switch. Cloudflare automatic production-branch deployment
  must stay disabled. The workflow builds the exact SHA and verifies it through
  `/version.json`; §6 and §12b are authoritative.
- **Remaining:** make production deployment refuse to run when the repository contains a
  migration that is absent from the production ledger; keep backup freshness visible;
  complete the Erica/Josh acceptance list at the top of this file.

### Phase 2 — Make the model show through ✅ (2026-08-10)

(see above)

### Phase 3 — The one page  *(QUEUED AFTER CORE + MAP; not cancelled)*

Inbox → **Edit**, absorbing add / import / ingest / sort / edit / organize / delete / fix
per §3. `/add` is the door; these still exist as separate surfaces and must fold into it
and then be REMOVED: `/attention`, `/photos/sort`, `/duplicates`, `/health`, `/trash`,
and the Settings → Data grid. Plus:

- **Inline location editing while sorting photos** — restore `PlaceQuickEdit` (§7,
  commit `5bb5b6e`). She asked for it back.
- **Transient UI that disappears** when it is done (the upload box, the "finish importing
  your Google Photos" banner).

### Phase 4 — A map we own  *(THE GOAL. Mapbox is a stopgap, not the destination)*

**Authoritative implementation plan, 2026-08-14. This block supersedes older cost,
project-status and architecture claims later in Phase 4.**

MapLibre GL JS is the renderer, not the map service. It is open source and has no usage
fee, but storage, requests, geocoding, routing, imagery and operations still have costs.
Use OpenStreetMap-derived vector data packaged as PMTiles from Protomaps. Never point a
commercial app at the community `tile.openstreetmap.org` servers.

Architecture:

```text
MapLibre in the web app
        │ HTTP range requests
        ▼
tiles.adventureorno.com — read-only tile Worker + edge cache
        │
        ▼
Cloudflare R2 — versioned PMTiles, glyphs, sprite and style artifacts

Separate admin/copy Worker — imports and verifies a new snapshot; never serves users
```

Build it in this order:

1. **Inventory before creating anything.** Confirm the one Cloudflare account, the live
   Pages project, `aon-basemap` bucket, current copy Worker/upload state, custom-domain
   ownership and secrets. Reuse or remove intentionally; never create another Pages
   project to escape an unclear configuration.
2. **Choose a right-sized first extract.** Start with the regions Erica and Josh actually
   use plus enough context for their routes. Do not copy a whole planet merely because it
   is available. Record measured file size, request volume and monthly cost; widen coverage
   when the product needs it.
3. **Finish resumable import.** Copy to a versioned key such as
   `maps/planet-YYYYMMDD.pmtiles`, retain progress outside the live object, cap concurrency
   below Worker connection limits, and make retries idempotent.
4. **Build a separate read-only tile Worker.** Support byte ranges correctly, set immutable
   cache headers for versioned assets, restrict CORS to approved origins, expose a health
   endpoint, and never put copy/admin controls on its public routes.
5. **Self-host every visual dependency.** Store glyphs and sprites with the PMTiles/style;
   inspect the browser network panel to prove the rendered basemap does not call Mapbox,
   MapTiler, Protomaps build storage or community OSM tile servers.
6. **Approve the palette before styling production.** Provide Erica with visual previews
   of the same recognizable area, zoom and overlays in at least these three directions:
   `Night Navy` (current dark card tokens), `Ink + Sand` (warmer land and restrained blue
   water), and `Slate + Moss` (charcoal base with muted natural greens). Each preview must
   show roads, water, parks/trails, labels, place markers, a selected marker, a route and
   the card beside the map on desktop and mobile. Record the chosen screenshot or artifact
   link here; hex values alone are not approval.
7. **Integrate behind a source switch.** Preserve map camera, markers, clusters, routes,
   popups and reduced-motion behavior. Keep the current basemap as an explicit rollback
   path until the self-hosted source passes production smoke tests.
8. **Cut over and prove it.** Test known locations and routes, range requests, cache hits,
   mobile use, keyboard access, failure behavior and `/version.json`. Watch errors and R2
   request volume for 24 hours before removing the temporary fallback.
9. **Refresh monthly and on demand.** Import a new versioned snapshot, validate PMTiles
   header and size, render known locations, switch one configuration pointer, retain the
   prior version for rollback, then delete older versions according to retention policy.

Commercial boundary: self-hosting OSM-derived tiles is compatible with a commercial app
when attribution and relevant data licenses are followed. It does **not** provide
geocoding, routing, satellite imagery, traffic or Strava data rights. Keep those as
separate replaceable services and review provider terms before the product charges users.

**Phase 4 is done only when** Erica approves a rendered palette, the production map and
route overlays work for both accounts, third-party basemap calls are absent, attribution
is visible, cost/usage monitoring exists, refresh and rollback are documented and tested,
and the old dependency can be disabled without blanking the app.

#### Historical map research (keep for evidence; do not execute over the plan above)

The point is **not to be limited by somebody else's charges, and not to be switchable-off
by somebody else**. MapTiler proved the second half by suspending the account and taking
every map in the app with it.

**Worth knowing: Snapchat does not do this.** Snap Map runs on **Mapbox** (partnership
since 2017 — Mapbox Outdoors vector data plus Mapbox Satellite, OpenStreetMap
underneath). The look Erica likes IS Mapbox+OSM; Snap simply pays Mapbox at enterprise
scale. Self-hosting is the opposite trade, and it is available to us because Protomaps
publishes the same OpenStreetMap planet as a single file.

**Decided 2026-08-11: the WHOLE PLANET, full detail.**

|          |                                                                                               |
| -------- | --------------------------------------------------------------------------------------------- |
| File     | `build.protomaps.com/<date>.pmtiles` — daily OSM planet build, zoom 0–15                  |
| Size     | **137.3 GB** (2026-08-10 build), verified by content-length                             |
| Verified | HTTP 206 range requests,`PMTiles` spec v3, `accept-ranges: bytes`, served from Cloudflare |

**Cost, in R2 — flat, and the whole reason for doing it:**

| Line                                                           | Amount                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| Storage 137.3 GB × $0.015/GB-month, minus the 10 GB free tier | **≈ $1.91 / month**                                      |
| Class A (writes): ~1,400 multipart parts, one-time             | free (1M/month included)                                        |
| Class B (reads): 1 per tile served; two people browsing        | free (10M/month included)                                       |
| **Egress**                                               | **$0 — R2 never charges for it**                         |
| **Total**                                                | **≈ $2 / month, flat, no matter how much we look at it** |

Against that, Mapbox through MapLibre bills **per tile request**, which is precisely the
shape of the blowout that cost us MapTiler.

**Getting 137 GB in without touching Erica's Mac.** The planet file is served *from
Cloudflare*, and R2 is *in* Cloudflare, so the copy never leaves their network: a Worker
reads ranges from the source and writes them to R2 as a multipart upload (~1,400 × 100 MB
parts), driven until it completes. No 137 GB download, no 137 GB upload, no overnight
saturation of her connection.

**Steps**

1. ✅ **R2 access** — done 2026-08-11: Erica ran `npx wrangler login` and added
   `CLOUDFLARE_API_TOKEN_MASTER` to `.env.local`, which is verified against both R2 and
   Pages. (`CLOUDFLARE_ACCESS_TOKEN` in that file is NOT a valid API token, and the old
   `CLOUDFLARE_API_TOKEN` name is gone — the deploy docs and skill now say so.)
2. ✅ Bucket `aon-basemap` created, copier Worker deployed
   (`workers/basemap`, `adventureorno-basemap.adventureorno26.workers.dev`), **copy
   running** (started 2026-08-11 13:02 UTC). Measured on the real thing:
   - one 100 MB part takes ~37 s from the source (~2.7 MB/s), so sequential would be
     ~13.5 hours;
   - **8 parts in parallel is the ceiling** — 16 trips Cloudflare's outbound connection
     limit ("Response closed due to connection limit") — and gives ~10 MB/s, so the
     137.3 GB lands in **about 3.7 hours**, once;
   - it is resumable: the Worker keeps its state in the bucket, a failed batch records
     nothing and is simply retried, so `scripts/copy-planet.sh` can be stopped and
     restarted at any point.
3. A tiles Worker serving `/basemap/{z}/{x}/{y}` out of the pmtiles, with edge caching so
   repeat views cost nothing, plus the same budget meter.
4. Self-host the **glyphs** (fonts) and any sprite in the same bucket, or the map still
   calls a third party for its lettering.
5. **The style, authored in the app's own colours** — this is the other half of the point,
   and it is what fixes Erica's "I don't like the colour": the Mapbox basemap is neutral
   grey and does not match the cards. Built against the real tokens:
   `--bg #060a14`, `--bg-2 #0a1122`, `--panel #0e1728`, `--panel-2 #131f36`,
   `--border #1f2d4d`, `--text #eaf1ff`, `--muted #93a6cc`, `--accent #3b82f6`.
6. Cut MapLibre over; Mapbox drops to **failover only**; the meter stays.
7. Verify live, per the rule.

**Still third-party afterwards, and worth naming:** search/geocoding (Mapbox Search Box)
and weather (Open-Meteo). Self-hosting search is a separate decision — Nominatim/Photon
are the options.

### Phase 4b — The map's appearance  *(DONE 2026-08-15)*

#### Where the basemap actually is

Found 2026-08-15, and it was not what the plan assumed:

- The planet IS in R2 — `aon-basemap/planet.pmtiles`, **137.3 GB**, zoom 0–15.
- The Worker serves tiles, glyphs and a style, verified: a z6 tile over Virginia returns
  38,148 bytes of `application/vnd.mapbox-vector-tile`, a glyph range 76,044 bytes, and
  MapLibre renders Loudoun County with **zero errors**.
- **The zone had zero worker routes registered**, so every `/basemap/*` URL fell through
  to Pages and answered **200 with the app's HTML**. A 200 from the wrong server is the
  worst failure available here — nothing looks broken. Check the content-type.
- The deployed Worker was the **copy-only build from 11 August**; the serving code (#73)
  had never been deployed.
- **AND THE ROUTE WAS NEVER PUBLISHABLE.** `routes = [...]` sat at the END of
  `wrangler.toml`, below `[vars]` — and in TOML a bare key after a table header belongs to
  that table. Wrangler read it as an environment VARIABLE named `routes` and published
  nothing, printing it back as `env.routes ([{"pattern":...)`. That is the whole
  explanation for the zero routes, and it survived because the symptom was a 200.

#### The styles

**Dark is decided: INK** — the card's own palette, so opening a card over the map is one
surface rather than two:

|        |                                                |
| ------ | ---------------------------------------------- |
| ground | `#0e1728` (`--panel`)                      |
| land   | `#131f36` (`--panel-2`)                    |
| water  | `#16324f`                                    |
| roads  | `#22314f` → `#33507f` → `#3f6fae`      |
| labels | `#eaf1ff` (`--text`) on a `#080e1c` halo |

**Light is decided: DAYLIGHT 2** — Google's idiom one notch richer. Ground `#f8f9fa`,
water `#8ccbf9`, parks `#b4dfb4` at 0.85, labels `#3c4043`, white roads over cased
`#dfe4e9` / `#cbd3db` / `#a6b3c0`.

It took five rounds, and each failed for a nameable reason worth keeping:

1. *Pastels* — white roads on a near-white ground with **no casing**, so the road network
   vanished. Roads on a light map need a darker casing under them; this is not optional.
2. *Saturated pastels* — better, still four greys with different tints.
3. *Different treatments* (sepia atlas, green-hero, monochrome-with-one-accent) — rejected
   outright. They changed the treatment and threw away the **contrast**, which is the part
   that was working.
4. *One structure, four rich colour families* — Azure / Emerald / Indigo / Ember. Closer,
   still not it.
5. *A real reference* — Google and Apple. That is what settled it, and it showed what
   every previous round had wrong: **neither of them uses a white ground or saturated
   water.** Google's ground is a cool off-white, its water a sky blue that RECEDES, its
   labels dark grey rather than black. I had been pushing saturation up while the
   references go the other way. Erica picked step 2 of a four-step ladder from there.

**The rules that came out of it:** roads on a light map need a CASING or the network
vanishes; the contrast is fixed and only colour is in question; and when a look is being
argued about, go and measure a real one instead of generating another guess.

#### The lettering (2026-08-15)

Our glyph server publishes **Noto Sans Regular, Medium and Italic**. Bold is NOT published
upstream — it answers 502, and asking for it puts unlabelled tiles on the map with nothing
to say why, so a test forbids it.

|                    | was                               | now                                             |
| ------------------ | --------------------------------- | ----------------------------------------------- |
| Town names         | Regular, +0.02 tracking, 10–17px | **Medium, −0.012 tracking, 11–19px**    |
| Water              | Regular, wide tracking            | **Italic** — the cartographic convention |
| Places of interest | 11px                              | 10.5px                                          |
| Halos              | 1.4–1.6px                        | **1–1.1px**                              |

It lives in the shared layer builder, not in a palette, so every theme has it and no future
one can miss it.

#### Done, in this order

1. ✅ **The light palette** — Daylight 2.
2. ✅ **Both themes from the Worker** — `/basemap/style.json?theme=dark|light`. An unknown
   theme is DARK, not an error: an unreadable map is a worse answer to a typo.
3. ✅ **Settings → Map appearance** — Dark / Light / Match my device, per browser (#88).
4. ✅ **The route** `adventureorno.com/basemap/*` is registered. **Wrangler cannot manage
   it**: `CLOUDFLARE_API_TOKEN_MASTER` is account-scoped and zone routes need
   `CLOUDFLARE_ZONE_ACCESS`, so it was created through the API and wrangler still errors
   on that one step. Do not read that error as a broken deploy.
5. ✅ **`basemap.ts` points at it** (#88), and `basemapOptions` became a FUNCTION —
   as a frozen object it handed every map whichever theme was current at module load.
6. ✅ **The switch is reversible**: `VITE_SELF_HOSTED_BASEMAP='false'` returns the app to
   Mapbox raster with no code change. Phase 4 requires the old dependency to be
   disableable without blanking the app; the reverse has to hold too, or it is a cliff.

**Phase 4 is MERGED, not Live-verified** (corrected 2026-08-16). Steps 1–6 above are all
true of `origin/main` and of the Worker, and the Worker half is genuinely live: a z6 tile
over Virginia returns 38,148 bytes of `application/vnd.mapbox-vector-tile`, a glyph range
76,044 bytes, both styles serve (12 layers dark, 15 light — the 3 extra are road casings),
an unknown theme falls back to dark, and `/basemap/health` reports the 137.3 GB planet.

**But the app that consumes it never deployed.** Erica, 2026-08-16: *"the map style has
not changed when I looked at it."* She was right. The deployed bundle at `546ff11` still
contains `api.mapbox.com/styles/v1/mapbox/dark-v11` and the frozen `basemapOptions`
object, because #86, #87 and #88 merged AFTER the last successful deploy and CI was
blocked on billing from 2026-08-15 17:47 UTC.

Phase 4's own definition of done requires "the production map and route overlays work for
both accounts" and "third-party basemap calls are absent". Production makes a Mapbox call
for every tile. **It is done when the deploy lands and she says the map looks different.**

The lesson is the one this file keeps relearning in new clothes: *deployed* is a separate
fact from *merged*, and only one of them is visible from a browser.

> ### ✅ PHASE 4 IS LIVE-VERIFIED — 2026-08-16, 21:05 UTC
>
> The deploy landed (`a57a928`) and she said it: ***"the map looks different."***
> The paragraphs above are kept exactly as they were written a few hours earlier, because
> the gap between them and this line IS the record — every one of those checks was green
> while the thing itself was not true.
>
> The deployed bundle now points at `/basemap/style.json?theme=`; the frozen
> `basemapOptions` object and `api.mapbox.com/styles/v1/mapbox/dark-v11` are gone from it.
> **One third-party map call remains and it is not the basemap:**
> `api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1.json` — the elevation model, which §6a-ii
> replaces with Copernicus GLO-30. Anyone grepping the bundle for "are we off Mapbox yet"
> should get that answer, not a clean grep and a wrong conclusion.

#### The style is OURS, not `protomaps-themes-base`

The Worker served that package first, and it is good — generated from the same schema the
planet build uses, so it cannot drift from the data. It was replaced because Erica chose a
look from renders of a HAND-BUILT layer set, and 68 of somebody else's layers wearing our
colours would not have been the thing she approved. **The preview and the product have to
be the same map.** That is also how the first routed response was caught serving 68 layers
at `#34373d`: both themes returned exactly 60,172 bytes, and 12 and 15 layers cannot be
the same size.

**No icons, ever.** The style strips every `icon-*` property and keeps `text-field`; a
first attempt at that filter also dropped `places_locality` and would have removed every
city label, so the guard tests for both.

### Phase 4d — Geocoding we own  *(PLANNED 2026-08-15, nothing built)*

Erica, 2026-08-15: **"I want to use Overture and Photon."** Decided. What follows is how,
and one honest caveat about the order.

#### There are two different jobs, and only one of them is urgent

|                   | What it is                           | Where it happens today                       |
| ----------------- | ------------------------------------ | -------------------------------------------- |
| **Reverse** | a coordinate → a name and address   | the nightly geocoder, and naming a new place |
| **Forward** | typing "Blackwater Falls" → a place | the search box on the new-place card         |

Reverse is the one that runs UNATTENDED and burns quota; forward is human-paced and cheap.
That difference decides the order below.

#### THE CAVEAT: Photon does both, so Overture is not on its critical path

Photon answers reverse AND forward, worldwide, from one index. Once it is running, the
geocoding problem is solved and Overture adds nothing to it.

Overture is still worth having — its **addresses** theme covers places OSM is thin on, and
its **places** theme has better POI categories than the basemap's `pois` layer — but that
is ENRICHMENT, not geocoding. Building both at once would mean running a server and an
import pipeline to answer the same question twice. Photon first; Overture when there is a
gap Photon actually leaves.

#### Photon — the shape of it

- **Java 21+**, and it can run its index embedded: no separate OpenSearch to operate.
- **~60 GB** compressed planet index to download (`db` mode), **~95 GB** on disk, growing
  roughly **10% a year**. (An earlier note in this file guessed 80 GB / 200 GB from
  memory; these are the measured figures.)
- Download and verification take **hours**, not minutes. Plan the first run accordingly.
- Refreshing means fetching a new index; the old one keeps serving until the swap.

**This is the first always-on server in an otherwise entirely serverless stack.** Pages,
Workers, R2 and Supabase are all managed — nobody patches them, nobody watches their disk.
A Photon box changes that, and the honest cost is not the ~€40–60/month for 16 GB RAM and
300 GB of NVMe. It is that something now needs patching, monitoring and an index refresh,
and that when it falls over at 2am the map still works but naming a place does not.

#### Where it sits

    adventureorno.com/geocode/*   ->   Worker   ->   Photon on a VPS (not public)
                                          |
                                          +-------->  Mapbox, while Photon is young

The same shape as `/basemap/*`, for the same three reasons: same-origin so the service
worker can cache it, **no new CSP entry to be silently blocked** — which is exactly how
the Mapbox search died unnoticed — and an origin that can be swapped without touching the
app. Reverse lookups for a rounded coordinate repeat constantly, so the Cache API in front
absorbs most of the traffic.

**Mapbox stays as failover until Photon has proven itself**, exactly as MapTiler is
failover for Mapbox today. That preserves the property this whole phase exists for: not
switchable-off by somebody else.

#### Overture, when its turn comes

- Ships as **GeoParquet** (`geoparquet` at github.com/opengeospatial is the format spec).
- **CDLA-Permissive v2** where possible, with per-source attribution — CC BY 4.0, Apache
  2.0, OGL — listed by theme. **The attribution obligations are per source and must be
  read before the product charges anyone.**
- 474M+ address points globally, which is far too much for the Supabase instance. Import
  is therefore **by region**, driven by where places actually are, and the nearest-address
  query is a PostGIS `<->` lookup against a GiST index.

#### The order

1. **Photon on a box**, reachable only from the Worker.
2. **The `/geocode/*` Worker**, with Mapbox failover behind it and its own spend meter —
   `spendApiCall` already exists and must keep counting, because a meter that stops
   counting when the provider changes is the false confidence it was written to remove.
3. **Point `lib/maptiler.ts` and `supabase/functions/_shared/geocode.ts` at it.** Both, or
   the server keeps paying Mapbox while the client does not.
4. **Watch it for a fortnight**, then drop Mapbox from the reverse path.
5. **Overture addresses into PostGIS**, by region, only where Photon proves thin.
6. Retire `VITE_MAPBOX_TOKEN` from the client entirely.

**Nothing here is built.** No server exists, no bytes copied, no dependency added.

### Phase 4c — Standards and open data  *(PLANNED 2026-08-15, nothing built)*

Erica asked to "get the API from OGC.org" and use its assets to make the map state of the
art. **OGC does not have assets or an API to consume.** The Open Geospatial Consortium is
a standards body: it publishes specifications — OGC API – Tiles, Features, Maps, Styles,
plus the older WMS/WMTS and GeoPackage — and nothing else. There is no data or imagery at
ogc.org to fetch. Recording that plainly so nobody spends a day looking for the download.

The intent behind the ask is right, though, and splits into two halves.

#### a. The standards worth conforming to (interoperability, not pixels)

| Standard                           | What it buys                                                                                                                                                                                    | Effort                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **OGC API – Tiles**         | A discoverable tileset document, so QGIS and OpenLayers can consume our basemap directly instead of via our own`tiles.json` shape. OpenLayers supports it out of the box (`OGCVectorTile`). | Small — mostly an extra JSON document beside the tiles the Worker already serves |
| **OGC API – Features**      | Serving PLACES and VISITS as standard GeoJSON collections, so her own data opens in QGIS and any OGC client.                                                                                    | Medium; an export/interop nicety, not user-facing                                 |
| **OGC API – Maps / Styles** | Serving the dark/light styles as discoverable style documents.                                                                                                                                  | Small, and only worth it after the styles settle                                  |

None of this changes what the map LOOKS like. It changes who else can read it, which
matters for a commercial product and for getting data back out (§6b's instinct).

**github.com/opengeospatial IS worth using — for three things, none of them data.**
Checked 2026-08-15; the org publishes specifications, schemas and test suites:

1. **`ets-ogcapi-tiles10` and friends** — Java conformance test suites. If the basemap
   Worker claims OGC API – Tiles, there is an EXECUTABLE test that proves it rather than
   a comment saying so. That is the same bargain as every other guard in this repository.
2. **`geoparquet`** — the specification Overture actually ships its data in. Reading
   Overture addresses means reading GeoParquet, so this is the format spec for §4c(c),
   not an abstraction.
3. **`ogcapi-features` / `ogcapi-styles` / `ogcapi-tiles`** — the schemas to conform to,
   in the repository that defines them.

What is NOT there: map data, imagery, tiles, addresses, elevation. The pinned repos are
`geoparquet`, `ogcapi-features`, `geopackage`, `sensorthings`, `geoapi`, `ogc-geosparql`
— every one a standard, not a dataset.

#### b. The open data that would actually make the map state of the art

These are the assets the ask was really after, and none of them are OGC's:

- **Overture Maps Foundation** (Linux Foundation; AWS, Meta, Microsoft, TomTom). Open
  base data with an **addresses** theme — 474M+ address points — plus places/POIs,
  buildings and transportation. Mostly CDLA-Permissive v2, with per-source attribution
  (CC BY 4.0, Apache 2.0, OGL) listed by theme. **This is the direct answer to "click a
  place and get its address"**, which the Protomaps basemap cannot do: its buildings
  carry `addr_housenumber` and nothing joins it to a street.
- **Copernicus DEM GLO-30** (AWS Open Data, Cloud-Optimised GeoTIFF, free, no egress
  cost) for **hillshade and contours**. For an app whose subject is trails and walking,
  terrain under the map is the single biggest visual upgrade available. US-only
  alternative at higher resolution: USGS 3DEP.
- **Sentinel-2 via STAC** on AWS Open Data for a satellite layer, if ever wanted.
- **MapLibre Tile (MLT)**, announced 2026-01, claims up to 6× compression over MVT.
  WATCH, do not adopt: the planet ships as PMTiles+MVT and the format is young.

#### c. How this changes the geocoding decision

Overture addresses make a third option real, alongside Nominatim and Photon:

> **Import Overture's address points for the regions we care about into the PostGIS we
> already run, and answer "what is this address" with a nearest-neighbour query.**

That is not a geocoder — there is no fuzzy text search, no ranking, no worldwide
coverage — but it answers the reverse question exactly, from our own database, with no
server to operate and no third party to be switched off by. Forward search (typing an
address into the new-place card) still needs Mapbox or a real geocoder.

**Sequence, if this is taken up:** Copernicus hillshade first (biggest visible change,
no new dependency), then Overture addresses into PostGIS (closes the click-for-address
gap), then OGC API – Tiles conformance (cheap, and makes the basemap quotable as a
standard service). Photon stays the answer only if forward search must also be
self-hosted.

**Nothing here is built.** No dependency has been added and no bytes copied.

### Erica's screen rules, 2026-08-15  *(all four MERGED in #94 — not yet Deployed)*

**Status, corrected 2026-08-16.** All four were fixed in #94 and are in `origin/main`:
`PlacesList` no longer renders `<StatsBar>` (which takes the gear with it), and
`Timeline.tsx` gained 154 lines for the year level. **They are not on the live site** —
#94 merged after the last successful deploy, so on adventureorno.com all four are still
wrong. That is the deploy freeze, not unfinished work.

The table below records the state WHEN SHE ASKED, and is kept because the diagnosis in
the last row is the reusable part.

| Rule                                                   | State when asked                                                                                                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Timeline drills down: YEAR → months → days** | ❌ grouped by MONTH only. There is no year level at all                                                                                                                                   |
| **Add opens the blank card we designed**         | ❌`/add` opens `AddPage`, a hub with the review queue. `PrimaryNav`'s own comment already says "ADD opens a FILLABLE CARD — not a chooser", so the code and the decision disagreed |
| **No settings icon on Places**                   | ❌ appears                                                                                                                                                                                |
| **No stats bar on Places**                       | ❌ appears (`PlacesList.tsx`)                                                                                                                                                           |

**The last two are ONE bug.** The gear lives inside `StatsBar` (`.gear-btn`), so anything
rendering the stats bar gets the gear with it. `PlacesList` renders `<StatsBar>`; removing
it takes both away. Worth knowing before someone "fixes" the gear separately and wonders
why it is still there.

### THE STRAVA RULE CANNOT BE DONE WITH RLS  *(found 2026-08-15)*

Josh sees his own Strava data, Erica sees hers, neither sees the other's. Today
`activities_select` is `using (public.is_member())` — every member sees every activity —
so the rule is currently violated for all 445 of them (180 `strava`, 265 `file`).

**But changing that policy is not enough.** **32 SECURITY DEFINER functions read
`public.activities`, and SECURITY DEFINER bypasses RLS entirely:**

    activities_of_type, activity_lines, card_view, climbing_stats, inbox, mileage_by_person,
    place_days, race_stats, races_list, rebuild_place_visits, visit_detail, wander_stats,
    wrapped_year_miles … and 19 more

Every count, every card, every statistic goes through one of those. A policy on the table
would look correct in psql and change nothing in the app.

**So the exclusion has to live where the reading happens**: one helper
(`public.can_see_activity`), applied in the RLS policy AND in every reader that aggregates
activities. `original_source` must exist first — `activities.source` records HOW WE GOT IT
('strava', 'file'), not where it came from, and a file imported via intervals.icu that
began life on Strava is exactly the case the rule is about.

### Phase 6 — What we own  *(APPROVED 2026-08-15; nothing built EXCEPT §6b, which is live)*

Phase 4 made the MAP ours. This makes the things around it ours: geocoding, routing,
elevation, terrain, points of interest, and recording an activity. Approved by Erica
2026-08-15 after an investigation of what is actually deployed.

**Corrections this phase makes to earlier notes in this file:**

- **PLANET, not a regional extract.** A US-or-Europe Photon index was floated on cost
  grounds and is wrong for this app: her own places already include Roma, Lungotevere
  Vaticano and Madrid, and the bucket list is international. A geocoder that fails on the
  next trip is not a geocoder. The disk difference is a few pounds a month.
- **NO third-party terrain tiles.** Free AWS terrain was floated; we bake our own
  (§6c). The point of Phase 4 was to stop being switchable-off by somebody else.
- **hotpot / heatmaps are OUT for now** — a fourth service for a feature nobody has asked
  for yet.

#### What is actually deployed (verified 2026-08-15, not from these notes)

|                          |                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `aon-basemap`          | `planet.pmtiles` **137.3 GB**, plus glyph ranges for Noto Sans Regular/Medium/Italic                                                                                                           |
| Workers                  | `adventureorno-basemap` (tiles + glyphs + both styles), `adventureorno-photo-gateway`                                                                                                              |
| Zone routes              | **exactly one** — `adventureorno.com/basemap/*`. The photo gateway is still on `workers.dev`                                                                                                |
| Data                     | 151 places · 487 visits ·**445 activities** · 17,017 location pings · 178 photos · **0 trail_routes**                                                                                 |
| Activities already carry | `summary_polyline`, `elevation_gain`, `elevation_profile`, `moving_time`                                                                                                                       |
| Still third-party        | Mapbox → MapTiler geocoding;**public Nominatim called FROM THE BROWSER** (`lib/data.ts`, 2 endpoints); **public Overpass** mirrors in `suggest`; Foursquare in `geocode-new-places` |

#### 6a. NO SERVERS. Files in our bucket, read by Workers.  *(REWRITTEN 2026-08-15)*

**This section used to specify three always-on servers — Photon, Valhalla and Open Topo
Data — on a €45–70/month box.** Erica: *"I don't think I need the box and I want to keep
this free."* She was right, and the reasoning that produced the servers was subtly wrong.

The goal in this file has never been *own everything*. It is **not switchable-off by
somebody else, and not limited by their charges**. I optimised for the first phrasing and
it pointed at servers. The second is satisfied by files in R2 — which is how the basemap
already works, and the pattern was sitting in front of me.

**THE TRICK, stated once: a lookup at a coordinate is a TILE READ.** Reverse geocoding and
elevation both ask "what is at this point?", and that is answered by fetching one tile and
looking inside it. No process, no graph, no always-on anything — the same shape as
`/basemap/tiles/{z}/{x}/{y}`.

| Need                       | Was                     | Now                                                                                       |
| -------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| Reverse geocode            | Photon on a box         | **Overture → PMTiles in R2**, Worker reads the tile                                |
| Elevation / hillshade / 3D | Open Topo Data on a box | **Copernicus GLO-30 → terrain-RGB PMTiles in R2**                                  |
| Typeahead search           | Photon on a box         | **Mapbox free tier** — ~100k geocodes/month, two people use a rounding error of it |
| Routing / map-matching     | Valhalla on a box       | **PAUSED 2026-08-15** (see 6a-iii)                                                  |

**Cost: R2 storage at ~$0.015/GB/month on top of the 137 GB already there.** Dollars, not
a new class of spend, and R2 egress is free.

##### 6a-i. Overture → PMTiles, GLOBAL

**All regions, not a subset.** A Postgres import forced a choice of regions because 474M
address points do not belong in Supabase; PMTiles removes the choice. Bake Overture's
addresses and places into tiles in `aon-basemap`, and `/geocode/reverse?lat=&lng=` becomes
a Worker fetching one tile and returning the nearest point in it.

Mapbox stays as the fallback for anything the tiles cannot answer, exactly as MapTiler
backs Mapbox today, and the existing `spendApiCall` meter keeps counting across the change
— a meter that stops counting when the provider changes is the false confidence it was
written to remove.

##### 6a-ii. Copernicus GLO-30 → terrain-RGB PMTiles

ONE artifact, THREE features: elevation profiles corrected server-side at save time,
hillshade under the map, and camera-along-path 3D flyovers rendered by our own style. Free
Cloud-Optimised GeoTIFFs from AWS Open Data, baked once, served by the same Worker.

##### 6a-iii. Routing — PAUSED, and why it is the honest exception

Erica, 2026-08-15: *"lets pause on the routing for now."*

**Valhalla can do everything wanted here** — snap-to-trail, map-matching a GPS trace,
turn-by-turn. It is the one thing on this list with no tile trick available, because
routing is a SEARCH ACROSS A GRAPH, not a lookup at a coordinate. It needs a process
holding that graph.

So routing is a box, or somebody else's box. When it resumes, the free option is
**FOSSGIS's public Valhalla** (no key, fair use) — the same shape of dependency as Mapbox,
watched by the same meter, and replaceable later. **Nothing depends on routing today**, so
pausing costs nothing.

#### 6b. Watchtower  *(BUILT 2026-08-15 — migration 0194, worker deployed)*

Five probes on a 15-minute cron, writing to `service_health`: app, style, tiles.json, a
real tile and a glyph range. It checks the CONTENT TYPE, not the status code — the whole
reason it exists is that `/basemap/*` answered 200 with the app's HTML for four days.
`service_status()` also marks a service STALE after 30 minutes, because a probe that has
stopped running leaves a green row that reads exactly like a healthy one.

Its probe list already carries commented entries for anything added later; wiring one up
is deleting a comment.

#### 6c. What "the planet" means, because I blurred it

FOUR different global datasets, from four projects, and the map being global gives you
none of the others:

| Dataset                     | For                                     | State                                                |
| --------------------------- | --------------------------------------- | ---------------------------------------------------- |
| Protomaps planet            | the map you look at                     | ✅**137.3 GB in R2, serving**                  |
| Overture places + addresses | click a place, get its name and address | ❌ nothing yet (6a-i)                                |
| Copernicus GLO-30           | elevation, hillshade, 3D                | ❌ nothing yet (6a-ii)                               |
| Photon index                | typeahead                               | ❌**not being built** — Mapbox covers it free |

#### 6d. Recording, properly — and it is JUST ANOTHER INGEST SOURCE

What exists today is not recording: `lib/tracking.ts` drips throttled `watchPosition`
pings into `location_pings`. That is passive presence. Every one of the 445 activities came
from Strava or a file.

The recorder must produce the SAME normalized activity a file import produces
(`source='recorded'`) and go in through the same pipeline, so map display, joint-outing
detection, stats and sharing need zero recorder-specific code.

Non-negotiables, in order of how much they hurt when missed:

1. **A crash-safe on-device journal.** Every accepted point is written to local storage the
   moment it arrives, never held only in memory; an unfinished journal offers to resume.
   A phone dying at mile 9 must not lose miles 1–8. Users forgive jank, never a lost hike.
2. **Filter before storing** — drop accuracy worse than ~30–50 m, drop implausible
   teleports, light smoothing. Distance from filtered points only.
3. **GPS elevation is garbage.** Correct it server-side against our own DEM (§6c/6a) at
   save time, which is what Strava does.
4. **Auto-pause** with `moving_time` and `elapsed_time` kept separately.
5. **Offline finish**: queue the upload and sync later. Trails have no signal.
6. Foreground-service / user-initiated background location only — **never ask for
   "Always" location** for a start-button recorder.

#### 6e. Overture Places → PostGIS, replacing Foursquare

**Moving off Foursquare is not a trade, it is a repair.** `geocode-new-places` calls
`places-api.foursquare.com`, and that key is DEAD (the 2026-08-07 credential audit), so
`foursquarePoi()` returns null today and that naming path is silently doing nothing.
Overture Places *includes the Foursquare OS Places donation* — the same underlying data,
permissively licensed, self-hosted, no key to expire, no rate limit.

Import by region with DuckDB spatial from the GeoParquet releases into a `pois` table
(PostGIS point, name, current category taxonomy, confidence, GERS id) with trigram/FTS
indexes. Nearest-POI naming becomes one `ST_DWithin` query. **Attribution is per SOURCE,
not one licence** — read the per-theme table before charging anyone. Build against the
CURRENT taxonomy; the legacy `categories` property is deprecated.

**The existing rule still governs all of it: "no suggestion means leave it alone."** Never
write a placeholder name.

#### 6f. THE STRAVA CONSTRAINT — it shapes the data model, not just the UI

Strava's API terms permit showing an athlete's data **only to that athlete**. No feeds, no
comparison, no social display, and the API now expects a paid subscription with a
self-serve cap of 10 athletes.

Therefore, before anything social is built:

- **Every activity records its `original_source`.** Not "how we got it" — where it came
  from originally, through however many hubs.
- **Strava-origin data is excluded from every surface visible to another person, and that
  exclusion lives in RLS and views — NOT in the UI.** A privacy rule enforced in the
  frontend is a privacy rule that leaks the first time a new screen forgets it.
- Strava becomes **per-user and private**: each person connects their own account, and
  nothing Strava-derived crosses between accounts.
- Anything that currently depends on Strava must have a non-Strava path before it can be
  part of a commercial product. Today that is 445 activities and the whole
  `strava-webhook` / `strava-backfill` ingest.

### Phase 7 — Fitness ingest we own  *(APPROVED 2026-08-15; nothing built)*

**Anything that depends on Strava must have a non-Strava path before this is commercial.**
Today that is all 445 activities.

#### The legal shape, which decides the architecture

- **Strava**: an athlete's data may be shown **only to that athlete**. No feeds, no
  comparison, no social display. The API now expects a paid subscription, self-serve cap
  ~10 athletes. So Strava is **per user and private**, and `original_source` is what every
  visibility rule is written against (0193).
- **Fitbit**: the legacy API dies ~Sept 2026 and its successor needs a $500–$4,500 CASA
  assessment. Not worth it.
- **Aggregators** (Terra, Rook, Spike, Thryve, Vital): $300–500+/month. No.

Therefore: **phone health stores + free direct APIs + ingest rails we own.**

#### 7a. Free direct connectors, in priority order

| #  | Provider                 | Why it is where it is                                                                                                                                                                                                                                    |
| -- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | **intervals.icu**  | The hub. Free API, OAuth, webhooks, original file download; it already pulls Garmin, Polar, Suunto, COROS, Wahoo, Zwift, Strava, Dropbox.**One button ingests a user's whole ecosystem.** Must filter Strava-origin rows before any shared surface |
| 2  | Polar AccessLink         | Free, self-serve, webhooks, GPX/TCX/FIT                                                                                                                                                                                                                  |
| 3  | Suunto                   | Free key, self-serve, new-workout webhook, FIT                                                                                                                                                                                                           |
| 4  | Wahoo                    | Free, request-based approval, webhooks, FIT URLs                                                                                                                                                                                                         |
| 5  | COROS                    | Free, form approval — apply once the LLC exists                                                                                                                                                                                                         |
| 6  | Garmin Connect Developer | Free, business-entity application; pushes original FIT. Highest-value hub: Peloton↔Garmin, Zwift→Garmin, TrainerRoad→Garmin, Rouvy→Garmin all terminate here                                                                                         |
| 7  | RideWithGPS              | Free API; also where Hammerhead Karoo auto-uploads land                                                                                                                                                                                                  |
| 8  | Whoop, Oura              | Free APIs + webhooks. No GPS — ingest as route-less activities/recovery                                                                                                                                                                                 |
| 9  | Withings                 | Free to 5,000 users; body/sleep/steps, no routes                                                                                                                                                                                                         |
| 10 | Concept2                 | Free OAuth + webhooks; rowing/skierg/bikeerg per-stroke                                                                                                                                                                                                  |
| 11 | Smashrun                 | Free OAuth, polyline GPS, running only                                                                                                                                                                                                                   |
| 12 | Hevy                     | Official API (user needs Hevy Pro); strength. Also parse Strong CSV export                                                                                                                                                                               |
| 13 | Runalyze / FitTrackee    | Free/self-hosted, niche, zero cost                                                                                                                                                                                                                       |

**No free public API — covered indirectly by 7b, do not chase**: Zepp/Amazfit, Xiaomi,
Samsung, Runkeeper, adidas, Nike, Peloton, Zwift, TrainerRoad, iFit, Echelon, Hydrow,
Tonal, Technogym.

#### 7b. Ingest rails we own, in build order

1. **Health-store relay** *(needs the native app — DEFERRED until the LLC)*. iOS
   HealthKit `HKObserverQuery` + background delivery + `HKWorkoutRoute`; Android Health
   Connect `ExerciseSessionRecord` + `ExerciseRoute`, with `READ_HEALTH_DATA_HISTORY`
   (without it only 30 days) and `READ_HEALTH_DATA_IN_BACKGROUND`. **This is the master
   key** — it covers Peloton, Nike Run Club, Runkeeper, Samsung, the Fitbit app, Zepp,
   iFit, Hydrow, Tonal and more with zero per-vendor work.
2. **Share-sheet / file-handler registration** *(days of work; native + PWA where
   possible)*. Register as a handler for `.gpx`/`.tcx`/`.fit` — iOS custom UTIs +
   `CFBundleDocumentTypes`, Android `ACTION_SEND`/`ACTION_VIEW`. Then "Export → our app"
   appears inside Komoot, COROS, Wahoo, OpenTracks, Files, Mail and AirDrop.
3. **Sync-hub chaining** — ship "Connect intervals.icu" and "Connect Garmin" as the two
   buttons and document the free chains that terminate there.
4. **Email-in ingestion** *(1–2 days, ENTIRELY on infrastructure we already run — the best
   effort-to-coverage item on this list)*. Cloudflare Email Routing + Email Workers (free,
   25 MiB inbound): `u-<token>@import.<domain>` via catch-all → Worker → R2 → queue →
   the existing FIT/GPX/TCX parser. Verify sender; dedupe the way `import_file_activity`
   already does.
5. **Cloud-drive watch** — Dropbox (App-folder scope) and Google Drive (`changes.watch`,
   `drive.file` scope to avoid heavy OAuth verification).
6. **A generic authenticated `POST /ingest`** — `ingest-overland` already proves the
   pattern; Overland, OwnTracks and GPSLogger all speak simple JSON/GPX POSTs.
7. **Garmin Connect IQ data field** *(later, a differentiator)* — a tiny CIQ field can
   `makeWebRequest` to us without waiting on the Developer Program.

**Back pocket only**: a browser extension fetching the user's own files from vendor sites
in their session — user-initiated, single activity, never server-side with stored
credentials. **Skip entirely**: desktop watcher apps, FHIR/openfitness.

#### 7c. The in-app recorder *(native — DEFERRED until the LLC)*

Its rules are already written in §6d and do not change: it is **just another ingest
source**, producing the same normalized activity a file import produces
(`source='recorded'`), so nothing downstream needs recorder-specific code.

Additions from 2026-08-15: iOS needs only "While Using" for a user-started recorder with
`allowsBackgroundLocationUpdates` — **do not ask for "Always"**, it hurts App Review and
trust. Android needs a foreground service with a persistent notification, not
`ACCESS_BACKGROUND_LOCATION`. `expo-location` + `expo-task-manager` for v1;
`react-native-background-geolocation` only if drift demands it. Write the finished workout
back to HealthKit / Health Connect. A 1 Hz recording costs ~5–10%/hour, comparable to
Strava. OSS to read, not import: OpenTracks, FitoTrack, OutRun.

### Phase 7a — THE IMPORT SYSTEM: one outing, many sources  *(APPROVED 2026-08-17)*

Erica, 2026-08-17: *"we need to build that system and then backfill his Strava information…
create a plan to build an import workflow that also keeps a ledger of who adds what from
what source — we also must be able to de-dupe activities uploaded from different methods
that record the same run… the activity should only be counted once."*

**This phase exists because the current importer is wrong in three separate ways, and the
audit that found them is the table below.** It is written before any code so the shape is agreed
first, and it replaces `import_file_activity` rather than patching it.

**CHECKED AGAINST PRODUCTION, NOT THE REPO** (Erica asked, 2026-08-17, and it changed two
claims in this plan). Every function below was read from `pg_proc` on the live database,
and the leak was measured by setting `request.jwt.claims` to Josh's id in a read-only
transaction and calling the real readers.

#### What is broken today, measured

| | |
| --- | --- |
| **Co-attribution was an INSTRUCTION, implemented as a date** ⚠️ *corrected — see §7a-6* | `0039` did a blanket `UPDATE`: *"Post-Dec-21-2025 activities Erica recorded were joint → also Josh's."* 46 activities carry Josh's name, **all** dated ≥ 2025-12-21, and **19 of them are dated after his last import** — nothing of his could possibly have matched them. **This was Erica's explicit request, exception included** (§7a-6), and an owner's assertion is the best evidence there is — the fault is that it was written as a hardcoded date inside a migration, where it could not be seen, amended, revoked, or told apart from a guess |
| **That defeats the Strava rule** | `visible_activities` treats an `activity_profiles` row as "this is yours too". **Measured live, acting as Josh: he sees 46 of Erica's 180 Strava activities.** Asking the real reader — `mileage_by_person(josh)` — returns **124 activities and 992.5 miles, of which 46 activities and 356.1 miles are Erica's Strava runs.** His own stats screen is showing him her mileage |
| **The importer silently destroys the second recording** | `import_file_activity` finds a match and `return v_id` **without inserting**. The file Josh uploaded is not stored, not linked, not recorded anywhere. It is simply gone |
| **`original_source` is a transport, not an origin** | `0193` backfilled it as `coalesce(original_source, source)`, so all 265 file rows say `'file'`. §6f requires *"where it came from originally, through however many hubs"*. A Garmin FIT, an AllTrails GPX and an Apple Health export are all `'file'` today |
| **No provenance at all** | `source_id` is NULL on every one of the 265 file rows. `ingest_runs` logs only the OSM suggester. Nothing records who imported what, from which file, when |

#### The one idea the whole design rests on

**An activity is an OUTING. A source is EVIDENCE of that outing.** They are different things
and the schema has been conflating them.

That single separation answers all three of Erica's requirements at once:

- *"the activity should only be counted once"* — counting reads `activities`; a run
  recorded by Strava, AllTrails and Apple Health is **one** row with **three** evidence
  rows, so it cannot be counted three times by construction rather than by a dedup job
  that has to keep winning.
- *"a ledger of who adds what from what source"* — the evidence row IS the ledger entry.
- **And the joint-outing bug disappears**, because the two cases stop looking alike:

      SAME PERSON, two apps, one run     → ONE activity, TWO sources
      TWO PEOPLE,  one run together      → TWO activities, one per person, linked

  The current importer collapses the second case into the first. That is the actual root
  of the 46, and no amount of better matching fixes it while one outing can only have one
  owner.

#### 7a-0. The Codex review, and what CHECKING it changed *(2026-08-17)*

Erica had a second model review the plan and told me to *"challenge codex assertions against
the live site, github, supabase, and cloudflare. Do not make assumptions."* Every verdict
below was measured, and the checking changed the design in five places — including two
where **Codex was right about the problem and both of us were wrong about the fix**.

| # | Codex's claim | Verdict, measured |
| - | ------------- | ----------------- |
| 1 | *Critical: visibility must not hang off the mutable `strava_accounts` table* | **Right about the risk, and the fix is simpler than either proposal.** `strava_accounts.profile_id` is `ON DELETE SET NULL`, so it is genuinely mutable. But `owner_profile` is **already an immutable snapshot**: `set_activity_owner` resolves it at INSERT and stores it, all 180 Strava rows match their athlete's profile, none are null, and **all three functions that touch it — `set_activity_owner`, `import_file_activity`, `match_photo` — set it only on INSERT.** So no new `source_profile_id` column, and no join at read time. Use `owner_profile`, and add a guard making it formally immutable |
| 2 | *High: "activity" means two things; readers counting rows can double-count* | **Right, and worse than stated.** 33 functions read activities; only **9** group by `shared_group_id`; **10 aggregate with `count()`/`sum()` without it** — `card_view`, `race_stats`, `place_days`, `recompute_place_stats`, `races_list`, `data_health`, `shared_outings`, `place_days`, `rule_offer`, `learn_rule`. There are **27 activities in 16 groups**, so 11 rows are double-countable today |
| 3 | *High: the ledger only models human file actions* | **Right.** `imports.profile_id = auth.uid()` cannot represent a webhook, a scheduled backfill or a migration. And **`ingest_runs` already exists** — 41 rows, `source='suggester'` only, and **no database function references it**, so it is an edge-function-only log. Extending it beats adding a competing ledger |
| 4 | *High: Tier 1 ids prove source-record identity, not outing identity* | **Half right, and the live data settles it.** Fetched from Strava with Erica's own token: her watch activities carry `external_id = garmin_ping_610945955935` and `device_name = "Garmin fēnix 6S"`; her phone ones carry `external_id = <UUID>-activity`, `device_name = "Strava App"`. So `external_id` **does** name the origin provider — but `garmin_ping_…` is a Garmin *ping* id, **not** the FIT `file_id`, so it cannot be joined to a FIT file. Scoped uniqueness it is |
| 5 | *High: Tier 2 auto-attach conflicts with the machine-proposal rule* | **Right, and it contradicted this file's own §2 and `0195`.** Conceded without reservation |
| 6 | *High: raw-file retention needs a security policy* | **Right, and it is net-new.** R2 holds exactly three buckets — `adventureorno-photos`, `aon-backups`, `aon-basemap`. There is nowhere to put raw activity files today |
| 7 | *Medium: label the 44 historical claims honestly* | **Right.** "44 carry the fingerprint" says how they were written, not that each outing was shared |
| 8 | *Medium: backfill must record explicit `unknown`* | **Right**, and it matters most for the 265 file rows: `source_id` is NULL on every one, so their upstream provider is genuinely unknown and must not be guessed as Garmin |
| 9 | *Medium: done-definition should test more than `mileage_by_person`* | **Right.** The RLS policy on `activities` uses the SAME tag predicate as the view, so route geometry, cards and detail readers need their own assertions |
| 10 | *Doc: the plan cites a §7f that does not exist* | **Right.** I referenced a section I never wrote; the audit it meant is the table above. Reference corrected |
| 11 | *Josh's OAuth: check athlete capacity, not just the callback* | **Fair, unresolved.** `strava-auth` is deployed (v15, `verify_jwt=false`) and his state expired unused. Capacity is not measurable through the API, so both hypotheses stay open until the retry is instrumented |

**One claim I want to record as NOT a problem**, because it looks alarming: `authenticated`
holds INSERT/UPDATE/DELETE grants on `public.activities`. It cannot use them — RLS is
enabled and the only policy is `activities_select` (SELECT), so every write command is
denied for want of a permissive policy. The grants are noise, not a hole.

#### 7a-1. FIRST: close the leak *(revised after the review)*

Three changes. None of them touch Erica's historical data.

1. **Strava visibility follows `owner_profile`.** Not a tag, and not a join through
   `strava_accounts` — that table is mutable (`ON DELETE SET NULL`) and would hand
   historical access to a live credential row. `owner_profile` is already the immutable
   snapshot of whose account the data came from. Add a trigger that refuses to change it
   after insert, so it stays that way by construction.
2. **Fix the RLS policy AND the view**, which currently share the same tag predicate.
   Either one left behind is the whole leak.
3. **Remove the blanket rule's future tense** in `import_file_activity` and
   `rebuild_place_visits` (see below). The 44 historical co-attributions stay, and are
   relabelled honestly: `status='accepted_legacy'`,
   `evidence='owner_asserted_date_backfill'`, `created_by='migration'`. That records how
   they were written without claiming each outing was independently proven shared.

**Definition of done — broader than the first draft, per review point 9.** Acting as Josh:
`mileage_by_person(josh)` returns 0 activities owned by Erica with
`original_source='strava'` (today 46 / 356.1 mi); `card_view`, `visit_detail`,
`activity_lines` and `place_days` return no route geometry for them; a direct
`select from activities` under RLS returns none; and a test asserts each, so a tag can
never again unlock Strava's copy.

#### 7a-2. ONE canonical outing id, before any counting is trusted

Review point 2 is the one that changes the model. An `activities` row is not an outing —
it is **one person's record of an outing** — and 10 readers already aggregate as though it
were.

The end state is an explicit `outings` table with `outing_participants`. That is a large
migration, so it is not step one. **Step one is to stop the ambiguity spreading:**

- define `outing_id := coalesce(shared_group_id, id)` **once**, in one authoritative view,
- move every aggregating reader onto it,
- and add a test — the same shape as `the_readers_stay_enforced.test.sql`, which already
  works — that **fails when a function aggregates `activities` without going through it**.

That converts a modelling problem into a guarded invariant, which is the pattern that has
actually held in this repository.

#### 7a-3. The provenance spine *(rebuilt on the review's shape)*

Four identities, never collapsed: **data owner**, **import initiator**, **connection or
device**, **participants**. The first is `owner_profile` and already exists; the rest are new.

```text
source_connections   provider identity + owner profile. NO credentials — strava_accounts
                     keeps those, and this table is safe to read
ingest_runs          EXTEND THE EXISTING TABLE (41 rows, suggester-only, no DB function
                     reads it) rather than adding a rival: + method, actor_kind
                     ('user','device','webhook','scheduled','service','migration'),
                     initiated_by, source_connection_id, source_owner_profile,
                     app_version, idempotency_key, status
import_artifacts     one row per file: sha256, bytes, media type, private R2 key,
                     retention state. Referenced by items — never duplicated per activity
ingest_items         one row per incoming record and its disposition:
                     inserted | updated | duplicate | skipped | failed, with the reason
activity_sources     typed link from an ingest item to the activity it evidences,
                     carrying provider, origin, external_key, device_name, confidence
```

**`actor_kind` is what makes it honest**: a webhook has no `auth.uid()`, and a backfill
must not be recorded as Erica approving anything.

**Retention policy, because the bytes are sensitive** (review point 6, and there is no
bucket for them today): a NEW private R2 bucket, service-role access only, size and type
limits, SHA-256 idempotency, defined retention, deletion on account deletion or provider
deauthorisation, and orphan cleanup for the case where R2 succeeds and the transaction
does not.

#### 7a-4. De-duplication *(retiered after the review)*

**Tier 1 — scoped idempotency, not universal identity.** The unique key is
`(provider, source_connection_id, entity_kind, external_key)` — *not* a global unique on
`external_key`. A matching key proves **the same source record**, which is exactly what
stops a re-import creating a second row.

The live evidence for why that is the right scope:

    garmin_ping_610945955935     device_name "Garmin fēnix 6S"   ← a Garmin PING id…
    <UUID>-activity              device_name "Strava App"        ← …not a FIT file_id

`external_id` reliably names the **origin provider** — which is how `origin` gets populated
honestly instead of guessed, and `device_name` should be captured alongside it. It does not
give a join key to the Garmin FIT file. **Cross-provider collapse is therefore never
automatic on an id alone.**

**Tier 2 — proposal, until it has earned promotion.** The thresholds are a hypothesis, not
a rule, and §2 plus `0195` already forbid a machine writing a grouping decision. So Tier 2
writes into `suggestions`, its comparison recorded in `match_decisions`
(algorithm + version, compared ids, measured deltas, proposed outcome, accepted/rejected by
whom, previous state, and a detach record). **Measure precision against the existing corpus
first**; automatic attachment is a later decision with evidence behind it, not a launch
feature.

**Tier 3 — weaker still: propose, and say why.**

Three rules that do not move: never silently drop a file; de-duplicate **within one
person** only; every merge reversible.

#### 7a-5. Then Josh

Both hypotheses stay live until instrumented: the callback/state path **and** Strava
athlete capacity. Instrument the retry so a second failure produces a reason rather than
another expired row. Then his data arrives through the new importer, owned by him, and
genuine joint outings come from two recordings — not from a date.

#### 7a-6. TAGGING IS THE PRODUCT — and a correction to how this file described it

Erica, 2026-08-17: *"Josh and I hiked, ran, biked, and took trips and visits, etc together.
The whole point of this app is to be able to tag and share those memories. When I
originally uploaded my Strava I told you to add him on all activities since December 21,
2025 except Richmond Yuengling marathon."*

**That changes what the 44 rows are, and §7a-0 described them wrongly.** This file has been
calling the co-attribution "a date, not evidence" and filing it under the same heading as
`solo_profile IS NULL` rendering as *"both of us were there"*. It is not that.

**The owner said so.** An owner's assertion about who was with her is not the absence of
information — it is the best evidence this system will ever get, better than a GPS
coincidence and better than any matcher. What went wrong was never the claim. It was that
the claim was **implemented as a hardcoded date inside a migration**, where it could not be
seen, amended, revoked, or asked about, and where nobody could tell it apart from a guess.

**Checked, and her instruction WAS carried out** — including the exception:

| | |
| --- | --- |
| The excepted race | **Yuengling Shamrock Marathon**, 2026-03-22, 26.4 mi, `is_race=true` (it is the Shamrock, in Virginia Beach — not Richmond; recorded here because the plan should name the right activity) |
| `activity_profiles` — the record | **Erica only.** The exception was honoured |
| `also_profiles` — the legacy array | **still says Josh.** A stale mirror of a corrected fact |

That divergence is this repository's oldest recurring bug in a new place: one fact stored
twice, and the copy left behind (§"Derived vs source"). `activity_profiles` is the record
(0189/0192); `also_profiles` must be retired, not repaired.

**How much of the tagging has a second recording behind it:**

    46  Josh tagged on Erica's activities
     8  ...where Josh has his OWN recording that day   ← evidence
     7  ...of those linked by shared_group_id
    38  owner-asserted only                            ← and that is FINE

38 is not a failure. Josh had no Strava, and his file imports are sparse and stop on
2026-05-18. For most of those outings her word is the only record that exists, and the
model must treat **owner assertion as a first-class evidence type** rather than a
second-class one.

#### 7a-7. What the model has to support, taken from what she actually did

Her instruction is the specification, almost word for word:

> add him on **all activities since December 21, 2025** — *a rule, over a range*
> **except** the Yuengling marathon — *with exceptions*
> and he should be able to **see and share those memories** — *with the other person's acceptance*

So the tagging model needs four things a migration cannot give it:

```text
outing_participants
  outing_id, profile_id
  claim_status   proposed | accepted | declined | retracted
  evidence       owner_asserted | own_recording | matched | inferred
  asserted_by    who said it            ← Erica, for all 44
  decided_by     who accepted it        ← Josh, and §A requires it
  rule_id        the bulk action it came from, if any

tagging_rules            A BULK CLAIM, STORED AS DATA RATHER THAN AS A MIGRATION
  id, created_by, created_at, note
  subject_profile        who is being tagged
  from_date, to_date, activity_types, places
  status                 active | revoked
tagging_rule_exceptions
  rule_id, outing_id, reason      ← "except the Yuengling marathon", stored, not remembered
```

**Why this is the fix and not bookkeeping.** Every property that made the December
instruction go wrong disappears:

- it is **visible** — she can see the rule and everything it claimed;
- the **exception lives with the rule**, so nothing depends on whoever ran the migration
  remembering it;
- it is **revocable** — retracting the rule retracts the claims it made, except the ones
  Josh individually accepted, which are his now;
- and it is **distinguishable** from a guess, so a reader never again has to infer intent
  from a date constant.

**Acceptance is the part §A already required and nothing has ever implemented.** Josh has
never been asked about any of the 46. In a two-person household that can be one screen and
one button — *"Erica tagged you on 46 outings since 21 Dec. Accept all / review"* — but it
has to be recorded, because at commercial scale the tag is a claim about somebody else.

#### 7a-8. Why both of you must reload, in one sentence

**0200 stopped Josh seeing 46 Strava-sourced activities he is legitimately tagged on** —
correct under Strava's terms, and directly at odds with the point of the product. The way
out is not to weaken the rule; it is Erica's own instruction: *"have both of us reload our
activity information with a process that works."* When an outing is evidenced by files each
person owns, the shared memory is theirs to share, and Strava is reduced to one convenient
importer among several rather than the thing the household's history depends on.

**The canonical test case is already in the data — 2026-03-07:**

    Purcellville to Arlington - Full WOD   08:10:36  45.12mi  strava  owner Erica
    Purcellville Running                   08:10:42  44.68mi  file    owner Josh
    Purcellville Trailhead - W&OD          08:21:57  44.93mi  file    owner Erica

One run. Three records. It contains **both** problems at once: a cross-source duplicate
(Erica's Strava copy and Erica's file copy of her own run) and a genuine joint outing
(Josh's own recording). All three already share a `shared_group_id`, which is why
`mileage_by_person` reports it once — and why the **ten readers that do not group** would
report 135 miles for a 45-mile run.

Any import rebuild is finished when this day comes out as: **one outing, two participants,
Erica's activity carrying two sources, Josh's carrying one.**

#### What this phase does NOT do

It does not add new providers. `intervals.icu`, Garmin Connect, Polar and the rest stay in
Phase 7's list. **This is the rail they all arrive on**, and building it first is what stops
the next importer repeating `import_file_activity`'s mistakes at ten times the volume.

### Phase 8 — Events, social and the privacy floor  *(APPROVED 2026-08-15; nothing built)*

**User-created events are the product; third-party feeds are garnish.** Every external
feed is revocable — never architect around one.

#### 8a. Events

- **User-created, three audiences**: private invite / friends-circle / open invite
  (discoverable pins on the map). Tokenized invite links with **no-account RSVP**,
  guest-list visibility controls, a maybe list, host update blasts, and date polls.
  Patterns to mine: Gathio, Rallly, Mobilizon/Gancio. *An open-invite event pinned at a
  trailhead, visible to anyone looking — no incumbent ships that.*
- **Free, on-brand feeds**: NPS `/events` (free key, 1,000/hr), Recreation.gov RIDB, city
  Socrata/CKAN per metro, OpenAgenda where covered.
- **Races**: RunSignup — free, geo-searchable; complete their free API-caller registration
  **before 1 Jan 2027**.
- **iCal/.ics ingest is the universal adapter** — "add a calendar by URL", recurring fetch
  + rrule expansion. Where there is no feed, read embedded schema.org/Event JSON-LD
    (facts only; respect robots.txt; nothing behind a login).
- **Weather**: NWS `api.weather.gov` (free, no key, US). Open-Meteo's free tier is
  NON-COMMERCIAL — its paid tier is required once we charge.
- **Do not build**: Facebook Graph events, Meetup, Eventbrite discovery, Yelp, Bandsintown,
  PredictHQ, parkrun (link out), Ticketmaster (owner decision).

#### 8b. Social

Friend graph + per-item privacy on Postgres RLS: canonical-ordered `friendships`, security
definer helpers (`is_friend`, `is_blocked_either_way`), a visibility enum on every
shareable noun, fan-out-on-read feed with Realtime. Comments (one level, soft delete) and
constrained reactions inherit the post's RLS. Notifications: table + Expo push + Resend.

#### 8c. The privacy floor — NOT optional, and NOT in the UI

- **Default private.** Per-item audience chosen at post time.
- **Privacy zones**: random-offset centre, trackpoints trimmed **at the data layer before
  any shareable polyline exists**, hide first/last 200 m by default.
- Joint-outing merges are **mutual opt-in and default off**.
- No aggregate heatmaps over private data.
- **Strava-origin data is excluded from every surface another person can see, in RLS and
  views — never in the UI** (§6f, 0193).

#### 8d. The moderation floor — mandatory before App Store submission (Guideline 1.2)

OpenAI `omni-moderation-latest` (free, text+images) on posts; a report button, a `reports`
table, timely response and a published contact; bidirectional blocking enforced in RLS;
ToS agreement at signup; Cloudflare CSAM scanning on the image zone; NSFWJS on-device
pre-upload. **Do not use Perspective API — it sunsets 31 Dec 2026.**

#### 8e. Mobile shell *(DEFERRED until the LLC)*

Expo + dev client, monorepo with `packages/core` sharing the Supabase and business logic.
`@kingstinct/react-native-healthkit`, `react-native-health-connect`. The native map
consumes **our own** `/basemap/style.json`. **Google Play personal-account rule: 12 testers
× 14 consecutive days of closed testing before production — start that clock early.**
EAS free tier is 30 builds/month.

### Phase 5 — Complete web features, then the native apps  *(QUEUED; not cancelled)*

First finish the web features recorded in this file on top of the stable private core:
the one-page edit flow, collaborative planning, Together approvals, remaining importers,
and approved card/map work. Then build native Apple and Android clients (**name undecided**)
against versioned APIs rather than forking the business rules into three implementations.

Commercial readiness includes tenant isolation, per-tenant quotas, account deletion and
export, billing/entitlements, privacy/terms/consent, abuse controls, observability, support,
app-store release automation and tested data migration from AdventureOrNo. These are real
deliverables, not reasons to rewrite the private app today.

Two provider constraints are already established and not negotiable by wishing:

- **Google Photos can no longer answer "photos from that day."** The library scopes were
  removed in March 2025; the Picker returns no GPS and cannot search by date or location.
  Date-based photo suggestion needs the phone, not Google.
- **Strava forbids showing Josh's data to Erica** in the same application. Josh has given
  personal approval, which settles it between them; it does not change Strava's terms for
  a commercial product. The route through it is bulk export as user-owned records — 265
  of 445 activities already arrived that way.

### Open, awaiting Erica's decision (found 2026-08-11)

**A. TOGETHER, DEFINED (Erica, 2026-08-11).** Together is **a tag on a person, approved by
that person**. It is not something the app works out and applies.

- You tag someone on a place, trail, activity, photo — **anything a user can edit**.
- **They are asked to verify it before it is added.** Until they accept, it is not Together.
- If two people in the same shared group were at the same place at the same time, that produces a
  **suggestion** — *"add this ___?"* — never an automatic label.
- Everyone's own imported data is **"just me"** by default.

This supersedes the earlier "automatically labelled Together" wording, and it agrees with
§2's rule: the machine proposes, the person decides. It also settles the open question
below, which was written before this instruction.

**A(i). The old problem it fixes: "Together" was claiming things you did apart.** Same disease as 4b: absence of
information rendered as a positive claim. `visits.solo_profile IS NULL` means *nobody
said*, and the UI reads it as *both of us were there*.

- **100 visits** are NULL → shown as Together. Only **5** were set by a person.
- **56 activities** are NULL → shown as Together. **46 of them already carry an
  `athlete_id`**, so we KNOW whose outing it was and simply never used it.
- Genuinely-together evidence does exist: **16 shared outings** (27 activities linked by
  `shared_group_id`, where both athletes recorded the same outing).
  ⚠️ **CONFLICT:** §10 (the data model, below) states `null = Both`. Fixing this changes that rule to
  `null = unknown`, with Together becoming something the data has to EARN.

**B. Attaching the 156 unpinned photos.** Bucketed against the visits that already exist:

| Bucket                                                                           | Count         | Safe?                                              |
| -------------------------------------------------------------------------------- | ------------- | -------------------------------------------------- |
| Exactly one visit at that place on that day                                      | **122** | yes — same place, same day, no ambiguity          |
| Fabricated`12:00:00` timestamp                                                 | **32**  | NO — the date is not real, so it must be proposed |
| No date at all                                                                   | 2             | no                                                 |
| Ambiguous (several candidate visits)                                             | 0             | —                                                 |
| Nothing is ambiguous, which is why this is worth doing: 122 can be attached with |               |                                                    |
| certainty, and 0157 now makes that attachment permanent.                         |               |                                                    |

### PLAN: keeping the map current once we own it

*(Erica, 2026-08-11: "Create a plan to keep the map updated if things are changed.")*

Owning the basemap means owning its freshness. OpenStreetMap changes daily; the copy in R2
is a snapshot of one build. Without a refresh plan, our map silently ages while the world
moves — a new trail she walks might not exist on it.

**How it works:** Protomaps publishes a dated planet build every day
(`build.protomaps.com/YYYYMMDD.pmtiles`). A refresh is the same copy job pointed at a newer
date, into a NEW key, with a swap at the end.

1. **Never overwrite the live file.** Copy to `planet-YYYYMMDD.pmtiles`, verify it, then
   point the tile Worker at the new key and delete the old one. A half-copied basemap must
   never be able to become the live basemap.
2. **Cadence: quarterly, plus on demand.** Daily is pointless for a travel map and costs a
   137 GB copy each time. Erica asks for a refresh when somewhere she has been is wrong.
3. **Cost of a refresh:** the copy itself is free (inside Cloudflare); storage doubles for
   the hour or so both files exist — pennies. Class A writes ~1,400, well inside the free
   tier.
4. **What triggers one:** a quarterly reminder, or her saying a place is missing/wrong.
5. **Verification before the swap** (never skip): file size within ~5% of the source's
   content-length, PMTiles v3 header reads, and a handful of known tiles render — the
   Appalachian Trail, Leesburg, San Diego, Barbados.
6. **Rollback is instant** because the old file is still there until the new one is proven.

**Corrections to OSM itself** (a missing trail) are a different thing: those go upstream to
OpenStreetMap and arrive in a later build. Nothing we can patch locally without forking the
data, which we will not do.

### PLAN: a user's change can never be auto-deleted

*(Erica, 2026-08-11: "Create a plan to make sure that user changes are never auto-deleted."
Said three times now — this is the one that keeps coming back.)*

Migration `0157` fixed this for VISITS. The rule has to hold for everything she can edit.

**The principle:** a machine may write only where a person has not decided. The moment a
person decides, that field is theirs, permanently, and automation routes around it.

**Why it kept breaking:** protection depended on each writer REMEMBERING to set a flag, and
three of them did not. Nothing structural stopped a new writer from forgetting. So the fix
is never "set the flag in one more place" — it is "make it impossible to forget".

**The mechanism that works** (proven in 0157): a database trigger marks the row decided
whenever a SIGNED-IN PERSON changes it. `auth.uid()` is non-null only for a real user's
request; cron jobs and edge functions run as service_role with no uid. The discriminator is
free and cannot be forgotten, because no writer has to do anything.

**Still to extend, each needing the same treatment:**

| What she edits                             | Protected? | Notes                                                           |
| ------------------------------------------ | ---------- | --------------------------------------------------------------- |
| Visit dates, note, attribution, trip flag  | ✅ 0157    | trigger + rebuild refuses to delete                             |
| A photo pinned to a visit                  | ✅ 0157    | pin marks the visit decided                                     |
| **Place NAME**                       | ❌         | `name_locked` exists but the naming rules still write; verify |
| **Place dates** (first/last visit)   | ❌         | derived from evidence                                           |
| **Trail / segment membership**       | ❌         | `part_of` is rewritten by merges and rules                    |
| **Race names and assignment**        | ❌         | `assign_activity_to_race` rebuilds                            |
| **Activity name, type, attribution** | ❌         | learned naming rules rewrite these                              |
| **Categories and tags**              | ❌         | `sync_place_category` trigger                                 |
| **Cover photo, rating, review**      | ❌         | probably safe; verify                                           |

**And the Save button she asked for:** the trigger makes every save permanent
automatically, so the button is not strictly required to make it TRUE. It is required to
make it VISIBLE — she has been told twice that her work is safe and twice it was not. A
card that says *"Saved — automation will not change this"* with the date is the honest
version of the promise, and a way to hand a field back to automation if she ever wants it.

### THE COMMERCIAL PRODUCT — what the research settled (2026-08-11, two rounds: research then refutation)

*(Renamed 2026-08-16. This section was headed "FLOK"; the name is NOT decided — see the
top of this file — and a working title left in a heading is how it becomes the name by
accident.)*

**1. STRAVA CANNOT BE PART OF A PAID SHARED GROUP.** The risk recorded as UNVERIFIED is now
VERIFIED against the live policy (https://www.strava.com/legal/api_policy, effective
1 June 2026) and survived an adversarial re-check. Four clauses each independently kill it:

| Clause | What it says                                                         | What it kills                   |
| ------ | -------------------------------------------------------------------- | ------------------------------- |
| §5.7  | may not "aggregate, cache, or store geographic location information" | the whole map                   |
| §6.2  | may not retain Strava data "longer than seven (7) days"              | every history we hold           |
| §2.3  | data "may be displayed or disclosed … only to that user"            | showing Josh's outing to Erica  |
| §5.8  | "**may not charge end users, in any manner**"                  | charging for the product at all |

Also: §5.10 forbids it *even with the user's consent*; §5.4 forbids aggregation/analytics;
§5.5 forbids persistent indexes; §5.3 forbids AI/ML. Access is 1 athlete by default, 10
self-serve, more only at Strava's discretion. Aggregators (Terra, Spike, Rook) were shut
out on 1 June 2026, so there is no back door.

**The escape hatch is the one already in use:** a user's own Strava EXPORT is not "data
accessible via the API", and 265 of 445 activities arrived that way. It conflicts with
Erica's "no importing files, that is a last resort" — and that tension IS the decision.

**2. The provider reality for a paid product**, after the refutation corrected the first
pass:

| Provider                                | Verdict                                                                                                                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google Health API** (ex-Fitbit) | **The one clean win.** TCX with real GPS trackpoints. Needs OAuth verification + CASA review past 100 users; exercise pages cap at 25 items, so a decade of backfill is real engineering. Legacy Fitbit API dies Sept 2026 |
| **Garmin**                        | **OPEN — apply today.** ~2 business days. The first research pass said the programme was paused; that was WRONG. Business use only, and "commercial use requires a license fee payment" for some metrics                  |
| **Polar**                         | **CUT IT.** Forward-only from the moment of consent — a new user gets an empty map until their next workout. Not "90 days of history"                                                                                     |
| **Wahoo**                         | Narrow — returns only workouts recorded through Wahoo's own systems                                                                                                                                                             |
| **Suunto / Coros**                | Approval-gated / unverifiable. Small populations                                                                                                                                                                                 |
| **Google Timeline**               | No public API. Not now, not ever                                                                                                                                                                                                 |
| **Apple Health**                  | No web API. Native app or nothing                                                                                                                                                                                                |

**3. "Within 10 feet" would break the feature.** 3.05 m is below the noise floor of consumer
GPS. Measured against real accuracy distributions it discards **~80% of genuinely-together
moments in the open, ~91% under tree cover, ~99% in a city** — worst exactly where Erica
hikes. Two more floors sit under it: polyline precision-5 quantises to ~1.1 m, and
`summary_polyline` is decimated for display, deviating tens of metres.

**The fix is to stop deciding on distance and decide on DURATION of closeness:**

| Parameter    | Erica asked | Use                                                  | Why                                                                                    |
| ------------ | ----------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Distance     | 3 m         | **60 m**                                       | recovers ~100% open-sky and canopy. Strava's own tiles are 80 m                        |
| Start window | 10 min      | **±30 min**                                   | a fine filter, a terrible decision — 12 min apart then two hours together IS together |
| Overlap      | —          | **≥10 min AND ≥25% of the shorter activity** | below that it is a flyby, not a shared outing                                          |
| Coverage     | —          | **≥60% propose, ≥80% auto**                  | a stranger would have to hold pace within 0.10 km/h for 90 minutes to fake 80%         |
| Samples      | —          | **≥40 aligned**                               | one lucky point pair is not evidence                                                   |

Strava's shipped social grouping uses 80 m tiles and a **50%** threshold; 80% is stricter
than production. And the repo has the counterexample already: the 2026-03-07
Purcellville→Arlington run, which migration `0079`'s 800 m START-proximity rule never
caught, because the two records of the same run start in different places.

**4. One STATE.md line needs amending:** "Google Photos can no longer answer photos from
that day" is half wrong. You cannot SEARCH by date, but `createTime` comes back on every
picked item. Still no GPS.

### PLAN A TRIP TOGETHER — Erica's direction, 2026-08-11 *(new, not started)*

> "I also want to create a feature that allows users to collaborate to plan a trip"

⚠️ **THIS IS THE FIRST THING IN THE APP THAT IS ABOUT THE FUTURE.** Every noun in §2
records something that ALREADY HAPPENED: a place is somewhere you have been, a visit is a
date you were there, an activity is a route you covered. A plan is none of those, and the
one way this feature can wreck the locked system is by leaking into it — a planned trip
appearing in Places, or bumping the Trips count, or drawing a marker on the map as though
you had been there.

**THE RULE, and it is not negotiable: a plan counts for NOTHING until it happens.**
Plans live in their own tables. They are never read by `rebuild_place_visits`, never
counted by the stats bar, never drawn as a visited marker. §2's sentence "a place counts
once in Places" means once you have BEEN there.

**How it turns real.** A plan does not become a visit by the date passing — that would
invent history for a trip you cancelled. When the end date is past, the plan asks once:
*"Did you go?"* Yes creates the visit (one visit, one set of dates — §2) and the plan is
kept, attached to it, as what you meant to do. No, or no answer, and it stays a plan.
This is the only door between the two halves, and a human walks through it.

**Who can edit it.** Planning is the reason the social graph exists — it is the same
tagging-and-approval model, only pointed forward:

- The planner invites people from their shared group. An invite is **accepted, declined, or
  maybe** — nobody is added to your trip without saying yes, exactly as with Together.
- Everyone accepted can add ideas, dates and notes. Only the planner can set the trip's
  final dates, and only the planner can answer "Did you go?" — one hand on the record.
- An idea is a **place you have not been** — so it must NOT create a `places` row on the
  spot. It holds a name, a coordinate and whatever the geocoder returned. If the trip
  happens, the ideas you actually did become real places at that moment, through the same
  path as any other new place.

**Voting, deliberately small.** The heart and the flame — the same two marks, the same
component, ALREADY BUILT for photos. No new vocabulary, no star ratings on things nobody
has seen. Rating is for places you have been (§2's card), and an idea is not one yet.

**The card.** A plan is shown with the LOCKED card structure — cover, name, the sections
in the same order, the blue rule and white uppercase headings. Nothing about the card
template changes; only what fills the sections. **Erica sees a preview and approves it
before any of this is built**, per her standing rule.

**Shape of the data** (written when built, not before):
`trip_plans` (owner, name, cover, target dates, status) · `trip_plan_members` (profile,
role planner/guest, invite status) · `trip_plan_ideas` (name, coords, who added it,
optional link to a real `places` row once it exists) · reactions reuse the existing
photo-reaction machinery pointed at an idea.

**Order of work:** the data model and the invite/accept flow first (they touch nothing
that exists), the card preview second, the "Did you go?" conversion last — because that
is the only part that can write history, and it should be built when everything around it
is settled.

### ⚠️ ONE OUTING, RECORDED TWICE — needs Erica's decision (found 2026-08-11)

Rolling a trail's sections into its Visits list (so the Appalachian Trail shows all 62
records rather than the 32 on the trail row) exposed a real duplication in the data:

- **27 days on the Appalachian Trail exist as TWO visits** — one on the trail, one on the
  section walked that day. Dec 25 2026 is both "Appalachian Trail" and "Maryland Heights".
- **78 such container/member same-day pairs exist app-wide.**

**The card now draws ONE row per day** — the section's, because it says everything the
trail's row said plus which section it was. So the AT reads **35 outings**, not 62 with
twins. Nothing is deleted: both records still exist and both still open. This is a
display decision, reversible in one line.

**The question for Erica:** should the trail-level visit for a day a section already
covers be REMOVED from the data, or kept as a second record?

- Keeping it means the Visits statistic counts that outing twice.
- Removing it is a mass delete of 78 rows, which is not something to do without you —
  and some of them are marked `manual` (a human set them), which the permanence rule in
  `0157` says an automation must never undo.

Nothing will be deleted until you say so.

### C — broken now, quietly (status 2026-08-11)

|    | What                                                                                                                                                                        | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 | The photo-gateway deploy block piped EMPTY strings over two working Worker secrets (`$SUPABASE_SERVICE_ROLE_KEY` / `$SUPABASE_ANON_KEY` do not exist in `.env.local`) | ✅ fixed in §12c — right names, and it now REFUSES to write a blank                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| C2 | `CLOUDFLARE_API_TOKEN` renamed to `…_MASTER`, but wrangler reads the un-suffixed name                                                                                  | ✅ fixed in §12b — mapped across, and`wrangler login` noted as the alternative                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| C4 | The tile meter counted only tiles. Mapbox**Search Box and Directions** are plain fetches billed per request and were invisible to it                                  | ✅**VERIFIED LIVE** on deploy `f38cc846`: typing in search moved `aon_api_budget` from nothing to 1. Four call sites metered (suggest, retrieve, forward, directions) with their own 2,000/day budget; refusing a search degrades honestly, unlike refusing a tile                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| C3 | Server-side geocoding dead since the MapTiler suspension — verified 403 on geocoding, not just tiles                                                                       | ✅**fixed, client and server.** `MAPBOX_TOKEN` is now a Supabase secret (it was absent — the app moved to Mapbox on 08-10, the functions did not). One shared `supabase/functions/_shared/geocode.ts` does Mapbox → MapTiler → nothing, and **zero `api.maptiler.com` calls remain** outside that fallback. `geocode-new-places`, `suggest`, `detect-trips`, `strava-webhook` and `strava-backfill` redeployed; all three callable ones verified BOOTING with the new module (a bad import 500s before the auth guard, and they return their own 401 instead). Client `reverseGeocode` prefers Mapbox too. **Not yet seen end-to-end**: naming a real new place needs an owner session (Erica's) or the next Strava ingest |
| C5 | The device ingest token travels as`?token=` and is therefore in Supabase's request logs in plaintext                                                                      | ❌ not started. Needs header support + a change to her iPhone Shortcut                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| C6 | `the ` is set nowhere, so `ai-suggest` silently answers "not configured"                                                                                                | ❌ not started — needs a key, or the UI should say it is off rather than look unbuilt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Erica's directions, 2026-08-11 — to build

1. ✅ **VERIFIED LIVE** (`7797d885`) — **the redundant "+ Add" button at the top of the
   map is gone.** Asked for before and missed. The nav already has Add; §3 says one door
   per action. The hidden file input that sat beside it stays: it is what the photo-drop
   flow uses.
   Also live in the same deploy: **Import & sort photos** and **Import an activity file**
   now live in Settings → Manage data, and both are gone from the Add page ("Move Import
   and Sort Photos into Settings. Move import activities to settings."). Add is down to
   one action plus the review queue — the shape it needs for the approved card, where Add
   opens a fillable card.
2. ✅ **VERIFIED LIVE** — **Settings is the gear wheel, not a nav pill.** One continuous
   page (`.settings-tabs` count 0), nav exactly `[Map, Places, Add, Timeline]`.
   **Settings becomes the gear wheel, not a nav pill.** Account, Connections, Privacy,
   Data and Advanced all extracted onto ONE nicely styled page that opens from the gear
   (bottom-left). **No section labels** — not "Account", not "People" — it should read as
   one seamless page, not five tabs stacked.
   ⚠️ **CONFLICT, resolved with her:** §3 and the nav say FIVE tabs including Settings.
   This makes it four (Map / Places / Add / Timeline) with Settings behind the gear.
3. ⚠️ **BUILT, NOT YET SEEN LIVE** (`0913f05d`) — **Join Requests is now part of the
   People section**, rendered above the member list under the one People heading instead
   of as its own labelled section. Not verifiable from the test account: that whole block
   renders only for `role === 'owner'`, so **Erica has to confirm it**.
4. ✅ **VERIFIED LIVE** (`6354cfb2`) — **photos appear on the VISIT card.** Confirmed on a
   San Diego visit: 12 photos, 24 marks, under "Photos (12)".
   The mechanism was never missing — a photo belongs to a visit when its local day falls
   inside it, OR when it is pinned. What was missing was the pinning: **35 of 177 photos
   were pinned to nothing**. 33 of them had a date AND a place AND fell inside exactly
   ONE existing visit (checked for ambiguity first: zero photos matched two visits), so
   they were pinned. **175 of 177 now.** The last two have no date at all — the "Add
   date" pill on the thumbnail is how they get one, and no automation should guess it.
   *Reversible:* the id → visit_id list is saved; `set_photo_visit(id, null)` puts any
   photo back on its own date.
   Also fixed here: the visit card's photo strip was a SECOND, hand-rolled copy of the
   place card's carousel — which is exactly why the heart and flame landed on one and not
   the other. Both now render one `<ThumbMarks>` component, so the marks cannot change on
   one card and miss the other.
5. ✅ **VERIFIED LIVE** (`0913f05d`) — **the place card has ONE carousel** with the date,
   and **the heart and flame are on it**. Confirmed on San Diego: 22 photos, 1 carousel,
   44 marks, and a react round-trip that wrote and cleared again. The marks used to exist
   only inside the full-screen lightbox, which is why they read as "where did it go".
   A mark nobody has used is invisible until hover and always visible on a phone (no
   hover there); once someone reacts it stays up, because the count is the point.
   Migration **0158** adds `photo_reactions_for_many(uuid[])` — the single-photo RPC would
   have fired ~40 requests on opening San Diego. One round trip for the strip; reacting
   re-reads only the photo you touched. **Applied to production**, verified by the network
   log showing exactly one `photo_reactions_for_many` call.

### Smaller things the 2026-08-10/11 work turned up

- The people markers collide with a place cluster when someone is standing on one.
- **Josh's last-seen is 30 hours old** because a web app gets no background location on
  iOS. Giving him the same iOS Shortcut ingest Erica has would make "where we are" real.
- **MapLibre 6 is blocked** (§8) until a GeoJSON layer is proven to draw on it.

## 6. Why work kept getting erased — and what now prevents it

Five mechanisms, all evidenced:

| Mechanism                                                            | Fix                           |
| -------------------------------------------------------------------- | ----------------------------- |
| Six competing "what to do next" documents (~380 KB across ~40 files) | This file, and only this file |
| Removals not recorded as reversible                                  | The register in §7           |
| Hand-deploys bypassing CI                                            | Phase 1                       |
| Model rules leaking across layers (`holds_children` → invisible)  | Phase 2, plus a test          |
| Config vanishing silently (`VITE_GOOGLE_CLIENT_ID`)                | Phase 1 build assertion       |

---

### The repository is PRIVATE again (corrected 2026-08-16 — it says PUBLIC below, and that is wrong)

**As of 2026-08-16 the repository is PRIVATE.** `gh repo view` reports
`"visibility":"PRIVATE"`, and fetching the old snapshot anonymously from
`raw.githubusercontent.com` returns **404**, as does the repository page.

This correction matters more than a stale fact usually would, for two reasons:

1. **It explains the outage.** The passage below records that the repo was made public
   *for free Actions minutes*. A private repo meters those minutes against the free tier
   and then bills them — and on 2026-08-15 at 17:47 UTC every workflow began failing in
   5–8 seconds with *"recent account payments have failed or your spending limit needs to
   be increased."* CI is the only deploy authority, so **production froze at `546ff11`
   for 16 commits** and the nightly Backup stopped too. Resolved 2026-08-16 by upgrading
   to GitHub Pro. **GitHub Pro does not retroactively re-run anything** — the blocked
   runs stay failed and the work has to be re-triggered.
2. **The instruction below — "do not fix this" — would send the next session the wrong
   way**, because the thing it says not to fix is no longer the state.

The good news: the data listed below is **no longer publicly readable**.

The original passage is kept because the exposure history is still true, and because
anything pushed while it WAS public should be assumed to have been seen.

#### The original entry, 2026-08-11 — accurate then, not now

`github.com/adventureorno26/adventureorno.com` was public. Erica made it public for free
Actions minutes, was shown exactly what that exposes, and chose to leave it public.

What is in the history, verified by fetching it anonymously from raw.githubusercontent.com:

| File (added in commit`3d9f1bd`, untracked later in `90ee6fb`) | What                                               |
| ----------------------------------------------------------------- | -------------------------------------------------- |
| `supabase/snapshots/2026-07-22/location_pings_slim.json`        | **16,952 location pings**                    |
| `…/activities.json`                                            | 256 activities with coordinates and route geometry |
| `…/places.json`                                                | 129 places**with street addresses**          |
| `…/photos.json`                                                | 148 photos with lat/lng                            |
| `…/visits.json`                                                | 416 visits                                         |

Untracking a file does NOT remove it from history — that is why this survived the
2026-07 privacy cleanup. `supabase/snapshots/` is gitignored today, so nothing NEW is
being added.

**Credentials are clean.** The only secret ever committed is the old `service_role` JWT
in migrations `0057`/`0071`, and it is confirmed dead — the API answers
*"Legacy API keys are disabled."* It was already rotated; **never ask her to rotate it
again.**

**What this means going forward:** the rule does not relax now that the repository is
private again. No data dumps, no `.env` anything, no tokens, no photo coordinates in
fixtures or test data — ever. Visibility is one setting away from changing back, the
history is permanent, and a commit made under the assumption of privacy is exactly what
becomes a leak the day it flips.

### HOW PRODUCTION DEPLOYS NOW (changed 2026-08-11, at Erica's instruction)

> "disable cloudflare's auto production deployment from git pushes"
> "deploy production only after gh checks succeed"

**A push to `main` no longer publishes anything.** Cloudflare Pages'
`production_deployments_enabled` is now **false** on project `adventureorno-com`, set
through the API. Preview builds are untouched — a branch still builds so it can be
looked at.

**Production is deployed by GitHub Actions, and only after every check passes.** The
chain was already built and is now the only path:

    build · security · secret-scan · osv-scan · semgrep · zizmor ·
    db-types-drift · edge-config-drift · e2e · db-tests · deploy-preview
        ↓  (all must succeed)
    release-gate      (also requires the repo variable PRODUCTION_DEPLOY_ENABLED=true)
        ↓
    deploy-production → wrangler pages deploy --project-name adventureorno-com

**The project name was wrong in the workflow and is corrected.** It said
`--project-name adventureorno`, with a comment claiming `adventureorno-com` was "an
unused orphan with no custom domain". That is exactly backwards: `adventureorno-com`
holds the domain and the GitHub connection, and the project it named no longer exists.
Both deploy steps and the preview-URL parser now say `adventureorno-com`.

**Consequence to remember:** nothing reaches adventureorno.com until CI is green. If CI
is broken, the site does not update — that is the point, but it means a red CI is now a
blocked release, not just a red badge.

**Also disabled 2026-08-11:** the global Claude hooks that auto-committed and
auto-pushed on every session start/stop (`~/.claude/hooks/auto-push.sh`,
`auto-pull.sh`), and `permissions.defaultMode: bypassPermissions`. Her settings backup
is at `~/.claude/settings.json.bak-2026-08-11`. The auto-push hook is what resurrected
`README.md` after it was deleted (§8).

### HOW CLAUDE WORKS ON THIS REPO (her rules, 2026-08-11)

> "Make Claude work only on named branches."
> "Allow commits only after tests pass; never commit automatically on session exit."

1. **Named branches only.** `fix/…`, `chore/…`, `feat/…`. Never commit on `main`.
   `.githooks/pre-commit` refuses, and GitHub refuses the push regardless:
   *"Changes must be made through a pull request. 10 of 10 required status checks
   are expected."*
2. **A commit has to earn it.** When app code is staged the hook runs `tsc` and the
   unit tests — including `lockedCard.test.ts` — and refuses on failure. Docs and
   SQL changes do not have to boot vitest. Enable per clone with
   `git config core.hooksPath .githooks`.
3. **Nothing commits itself — except GitDoc, which does (found 2026-08-14).** The
   global Claude hooks that committed and pushed on every session start and stop are
   gone (backup: `~/.claude/settings.json.bak-2026-08-11`). That Stop hook is what
   resurrected `README.md` 90 minutes after it was deleted (§8). **But this line was
   still not true.** Commits kept appearing under Erica's name with a timestamp for a
   message — `Aug 14, 2026, 10:53 PM` — three times in one evening. They are not git
   hooks (`.githooks/` holds only `pre-commit`) and not a cron job. They are the
   **GitDoc** VS Code extension, configured in her *user* settings
   (`~/Library/Application Support/Code/User/settings.json`):

   ```jsonc
   "gitdoc.enabled": true,
   "gitdoc.autoCommitDelay": 30000,   // commit 30s after a file stops changing
   "gitdoc.autoPush": "onCommit",
   "gitdoc.pullOnPush": true,
   ```

   **Why it matters, concretely.** It commits work *while it is being written*: one
   evening's export fix was split across two timestamp commits mid-edit, and a
   component change landed on the branch of an unrelated PR because that is what
   happened to be checked out. It attributes machine-written work to **Erica**. With
   `autoPush: onCommit` it will also push whatever it commits the moment a branch has
   an upstream. It respects `pre-commit` (`noVerify: false`), so it cannot commit
   failing code — but it decides *when* and *what*, which is exactly what rule 3 says
   nothing should.

   **TURNED OFF 2026-08-16**, by setting `"gitdoc.enabled": false` in
   `~/Library/Application Support/Code/User/settings.json` (backup alongside it:
   `settings.json.bak-2026-08-16-gitdoc`). Nothing commits itself in this repository any
   more, and rule 3 is finally true as written.

   **Invoking *GitDoc: Disable* was not enough, and that is worth knowing.** It was run,
   and GitDoc carried on committing — `e42b78e` and `f06808d` landed after it. The
   command did not persist to the settings file; only editing `gitdoc.enabled` did.
   **Verify it by watching for a new timestamp commit while editing a file, not by
   watching an idle window** — an idle repo looks identical to a disabled extension, and
   that false negative was briefly recorded here as success.

   **What it cost, so the trade is on the record.** It made 21 commits, all attributed
   to Erica, all with a timestamp for a message. It never LOST anything — audited
   2026-08-16 across all 13 branches holding those commits, every file they touched is
   present in `origin/main` (`absent: 0`). The damage was legibility: it committed
   mid-edit, split single changes across two timestamp commits, and put changes on
   whichever branch happened to be checked out. That is what made "is our work safe?"
   a question that took an hour to answer instead of a minute.

   **Beware of two false alarms it causes**, because both will recur while reading old
   history: squash-merging destroys BOTH commit ancestry and patch-id, so
   `git merge-base --is-ancestor` and `git cherry` each report merged work as missing.
   Neither is evidence. Compare file CONTENT against `origin/main` instead.

   To turn it back on: `gitdoc.enabled: true`. It is a per-machine editor setting, not
   a repo setting, so nothing in this repository can prevent it. A commit here with a
   timestamp for a message was written by the editor, not by a person or by Claude.
4. **`bypassPermissions` is off** in her Claude settings.

### THE ONLY ROUTE TO THE LIVE SITE (2026-08-11)

    named branch → pull request → 10 required checks → merge to main
        → release-gate → production environment approval (Erica)
        → wrangler pages deploy --project-name adventureorno-com

- **Direct pushes to `main` are rejected**, admins included (`enforce_admins: true`),
  verified by attempting one.
- **Cloudflare no longer builds production from git** —
  `production_deployments_enabled: false`. Previews still build.
- **The `production` environment requires Erica's approval** and accepts deployments
  only from protected branches.
- **Merged branches delete themselves.**
- Linear history required; force-pushes and branch deletion on `main` are refused.

### THE PINNED TOOLCHAIN (2026-08-11)

| Thing    | Pinned to                | Where                                                                                                           |
| -------- | ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Node     | **22**             | `.nvmrc`, `engines` (`>=22 <23`), CI `setup-node`, Cloudflare `NODE_VERSION` (production AND preview) |
| Wrangler | **4.113.0, exact** | `app`, `workers/photo-gateway`, `workers/basemap`                                                         |

The Mac was on **Node 26** while CI ran 22 — the two only agreed by luck. Wrangler was
worse: `app` had `^4.113.0`, `photo-gateway` had `^3.80.0`, and `workers/basemap` never
declared it at all despite its deploy script calling it, so it silently used whichever
version happened to be hoisted (3.114.17). Three versions, one repo.

`adventureorno.code-workspace` is the VS Code entry point — format-on-save, ESLint
pointed at `app/`, the repo's own TypeScript, test tasks, and a terminal that opens in
the REPO rather than the OneDrive parent.

### THE DATABASE CHAIN IS CLEAN NOW (2026-08-11)

**162 migrations apply to a fresh database with ZERO errors, on Postgres 17, and all
31 SQL suites pass.** Four things were wrong; all four are fixed.

**1. Postgres was 15 locally and in CI, 17.6 in production.** Every SQL test proved
something about a different engine than the one serving the app. `config.toml` is now
`major_version = 17`, done the way the old comment demanded: the ~3.5 GB image was
pulled first, then the full chain and every test were run against a fresh 17 container
before the change was committed. If CI's database job ever times out pulling that
image, **cache the image — do not go back to 15.**

**2. One migration error was "tolerated" and no longer is.** `0044` backfills
`places.city` from `places.address`, a column no migration created until `0098` — it
existed in production only because it drifted in outside the migrations. The backfill
is now guarded on the column existing, so it is a no-op on a fresh database (which has
no rows to backfill) and byte-identical anywhere the column exists.
`scripts/db-bootstrap.sh` no longer has a special case: **any** error fails it now.
*Do not add another. A tolerated error is a migration that does not work on a fresh
database, which means the chain cannot rebuild anything — including a restore.*

**3. `0001` could not apply to a genuinely fresh database.** Its `SECURITY DEFINER`
helpers are defined before `public.profiles` exists and read it, and Postgres validates
a function body at creation time. It only ever worked because `db-bootstrap.sh` sets
`check_function_bodies=off` for its session — so the chain was appliable through **one
script and no other path**. `0001` now sets that itself, `set local`, for its own
transaction. The header says never edit 0001 after merge; this is the one case the rule
cannot cover, because the failure happens *while applying 0001* and no later migration
is ever reached.

**4. EIGHT migrations were applied to production but absent from its ledger.** They
were executed through the Management API's query endpoint, which runs SQL and records
nothing. The schema was right and `supabase_migrations.schema_migrations` was lying —
which matters exactly when you cannot afford it: a restore rebuilds from the ledger, so
an unrecorded migration is silently missing from the restored database, and
`supabase db push` re-runs anything unrecorded. Each of the eight was **verified present
in production** before being recorded (recording an unapplied migration makes it skip
forever, which is worse than the gap).

`npm run check:ledger` (`scripts/check-migration-ledger.mjs`) now compares the repo
against production's ledger so this is caught before a merge instead of weeks later. It
warns rather than fails, because a branch that legitimately adds a migration is "ahead"
until it deploys; `STRICT=1` makes it fail.

**Checked while there:** `anon` reaches **zero** ordinary tables and can execute **zero**
SECURITY DEFINER functions in production. (An earlier draft of this note claimed
otherwise — that check wrongly counted PostGIS's own `geometry_columns`,
`geography_columns` and `spatial_ref_sys`, which `0154` deliberately excludes.)

## 6b. BACKUP AND RECOVERY (built 2026-08-12)

### The state it replaced

**There was no backup of this database anywhere.** Supabase's backup list was empty
and PITR was off, verified through the Management API. A bad migration, a dropped
table or a lost account would have taken **149 places, 489 visits** and every note,
rating, date and photo-to-visit link with it. The scripts that existed
(`export-data.sh`, `restore-data.sh`) were never scheduled, never encrypted, never
retained and never tested.

### What runs now

`.github/workflows/backup.yml` — **separate from `ci.yml` on purpose**, so a backup
never stops because a code check went red, and a red backup is not lost among other
failing jobs.

| Job                | When                 | What                                                                                                                |
| ------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `database`       | nightly 07:17 UTC    | every table → JSONL + manifest (row counts + sha256),**age-encrypted before upload**, then R2 with retention |
| `objects`        | nightly              | mirrors`adventureorno-photos` → `aon-backups/objects/` (incremental)                                           |
| `freshness`      | nightly,`always()` | **fails if no recent artifact exists**                                                                        |
| `verify restore` | on demand            | restores the newest backup into a disposable Postgres 17 and checks every row count                                 |

**Retention (grandfather-father-son):** 14 daily · 8 weekly (Sundays) · 12 monthly
(the 1st). ~3 MB a night, inside R2's free tier. A single rolling copy is not a
backup — it overwrites itself with the corrupted version the night after something
breaks.

### The token CI needs is NOT the deploy token

`secrets.CLOUDFLARE_API_TOKEN` deploys Pages and has **no R2 permission** — the first
real backup run failed all three jobs with `403 … Authentication error`, after the dump
and encryption had already succeeded. The backup jobs use
`secrets.CLOUDFLARE_API_TOKEN_MASTER`, which is the same value as
`CLOUDFLARE_API_TOKEN_MASTER` in `.env.local`.

⚠️ **That is a broad account token.** A least-privilege token scoped to R2 read on
`adventureorno-photos` and read/write on `aon-backups` would be better, and is worth
doing when there is a reason to touch it — it just cannot be minted from the API, so it
is a dashboard job.

### Encryption

`age`. R2 only ever receives ciphertext, so a leaked R2 token exposes nothing.

- **Public key** (encrypts; safe anywhere): `age1zsd4ptmy57sl2ad9utgafylsw5yl5y87luuhn9h5afywz28sdaps20aw52` — repo variable `AGE_RECIPIENT`.
- **Private key** (decrypts): `~/.aon-backup/backup-key.txt`, mode 600, **never printed and never committed**; also GitHub secret `AGE_SECRET_KEY` so the verify job can restore.
- ⚠️ **If that private key is lost, every backup is unreadable.** Keep a copy somewhere that is not this Mac — a password manager is fine.

### Photos are backed up separately, because the dump is only a manifest

`photos` and `videos` rows carry **R2 object keys, not bytes**. Restoring the database
alone gives rows pointing at nothing — and every map marker is a photo, so that is not
a restore. `scripts/backup-r2.mjs` mirrors the objects; **362 objects, 289 MB** at first
run. The object mirror is *not* encrypted: opaque blobs under UUID keys, already
private in R2, and re-encrypting nightly would force a full re-upload on every key
rotation. The database backup — the names, notes, coordinates and dates that make the
photos mean anything — **is** encrypted.

### Proven, not assumed

Run end-to-end on 2026-08-12: pulled from R2 → decrypted → schema rebuilt from the
migration chain into a fresh Postgres 17 → every row loaded → **all 38 tables matched
the manifest exactly, 18,833 rows, zero errors.**

It failed twice first, which is the entire argument for testing restores:

1. Hand-built INSERTs died 18,024 times on `uuid[]` vs `jsonb`. Fixed with
   `jsonb_populate_record`, letting Postgres cast into its own row type.
2. Then `permission denied to COPY from a file` (Supabase's `postgres` is not a
   superuser → use `\copy`) and `cannot insert a non-DEFAULT value into column "geom"`
   (generated columns must be excluded; they recompute from lat/lng).

A backup nobody has restored is a rumour. This one has been restored.

### Recovery objectives

|                                   |                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RPO** (data you can lose) | **≤ 24 h** — nightly. An outage at 07:00 loses that day's edits.                                                                                           |
| **RTO** (time to be back)   | **≈ 30–45 min** — ~2 min to fetch and decrypt, ~4 min to rebuild the schema, ~2 min to load, the rest for Supabase project setup and re-pointing the app. |
| **Objects RPO**             | ≤ 24 h, incremental                                                                                                                                               |

### How to actually recover

1. `AGE_KEY_FILE=~/.aon-backup/backup-key.txt npm run backup:verify` — proves the
   artifact and the key still work, on a disposable database, before touching anything.
2. New Supabase project → `supabase link` → apply the migration chain
   (`scripts/db-bootstrap.sh`). The dump carries `_migrations.jsonl` so the schema can
   be rebuilt to **exactly** the chain the data came from.
3. Load the rows the way `verify-restore.sh` does (`\copy` + `jsonb_populate_record`,
   generated columns excluded).
4. Copy `aon-backups/objects/` back into the photos bucket.
5. **Credentials are NOT in the backup, deliberately** — `ingest_tokens`,
   `strava_accounts`, `google_tokens` and `oauth_states` are excluded, because
   restoring them restores someone's ability to act as her. Recreate by: signing in
   with Google again, reconnecting Strava in Settings, and minting a new device ingest
   token for the iPhone Shortcut. Everything else comes back from the dump.
6. Point the app at the new project (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
   and the Worker secrets in §12c).

### Raw dumps still never go in git

`supabase/snapshots/` is gitignored and `.backup-work/` was added to `.gitignore` with
this work. The repo is **public** (§ above) — anything committed is world-readable the
moment it is pushed.

## 7. Removed on purpose — the register

Anything deliberately removed goes here, with the commit, so it is never mistaken for
lost work and can be restored in minutes.

| What                                                                                                     | When       | Why                                                                                                                                                                                                             | Restore from                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Address/place editing in the photo sorter (`PlaceQuickEdit`)                                           | 2026-07-26 | She asked for "JUST THE VISIT INFORMATION" — place-level fields were confusing inside a visit-sorting flow                                                                                                     | commit`5bb5b6e`; the component still exists, unused. **She now wants it back (Phase 3).**                                                                         |
| The`trips` and `trip_stops` tables                                                                   | 2026-08-08 | A trip is a visit you marked, not a separate object                                                                                                                                                             | commit`aa6e553`                                                                                                                                                         |
| The 5-step Add wizard                                                                                    | 2026-08-08 | Replaced by one add sheet                                                                                                                                                                                       | commit`fd3004d`                                                                                                                                                         |
| Service-worker registration                                                                              | earlier    | A cached shell served stale code                                                                                                                                                                                | restored 2026-08-10 with HTML network-first                                                                                                                               |
| `apply_naming_rule(uuid)` (geofence-only)                                                              | 2026-08-10 | It could rename 76 activities on start-point alone                                                                                                                                                              | migration`0152`                                                                                                                                                         |
| "downtown Leesburg, VA" as an Appalachian Trail section                                                  | 2026-08-10 | Not on the AT.**The place itself was kept** — it holds 3 photos and 2 visits                                                                                                                             | migration`0155` (the earlier membership-row delete did not take: `part_of` is the record and its trigger rebuilds membership)                                         |
| The**`detect-trips` nightly auto-detection** (deployment deleted)                                      | 2026-08-12 | Erica: "disable the nightly auto-detect feature". Its cron was already unscheduled; the deployment was what remained. It also contradicts §2 — it creates places tagged`trip`, and a trip is never labelled | source kept at`supabase/functions/detect-trips/`; `supabase functions deploy detect-trips` restores it, and the config entry is commented in `supabase/config.toml` |
| The**Sections list** on a trail card, its walked-sections map, and the per-section date disclosure | 2026-08-11 | The approved preview replaced it: the segment name rides on the visit, so a trail card reads like every other card                                                                                              | commit`438677e0`; the deleted JSX is also saved verbatim in the session scratchpad                                                                                      |
| The generic**"Places"** section on a card (uncategorised members)                                        | 2026-08-11 | It IS the PLACES HERE section she asked to be rid of. The locked card has category sections and nothing else                                                                                                    | commit`a8e60124` + follow-up. **Three places app-wide are affected — Fort Rosencrans (San Diego) and two others. They need a category, not a bucket.**           |

---

## 7c. 2026-08-15 — what changed, and what was found while changing it

Fourteen pull requests (#69–#83). The parts worth remembering are not the features.

### Applied to production

| what                                                                      | evidence                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **0190** `place_visit_totals()` + backfill                        | Appalachian Trail`visit_count` 39 → 31, W&OD 46 → 44                                    |
| **Washington, DC** `first_visit` `0202-06-19` → `2017-03-29` | its own earliest visit; earliest photo 2017-03-30 00:03 UTC is the same evening locally     |
| **Two visits dated 2026-12-25 deleted**                             | Appalachian Trail and Maryland Heights, via`delete_visit`; both returned `evidence: []` |

The two Christmas visits claimed `source='evidence'` and **nothing in the database carried
that date** — no photo, no ping, no activity. Undo snapshots were captured from
`delete_visit` before they went.

### A COUNT THAT DECIDES SOMETHING MUST BE COUNTED

`places.visit_count` is a mirror, and **nothing refreshes it when a VISIT changes**:
`create_visit`, `delete_visit`, `restore_visit`, `merge_visits` and `update_visit_dates`
all leave it behind. `recompute_place_stats` counts correctly but only runs on the PHOTO
and ACTIVITY paths. So merging two visits into one — the thing 0185 was built for — takes
the real count down and leaves the column where it was.

That was not cosmetic: **Duplicates picks which place SURVIVES A MERGE by that number**,
and a merge is not undone by pressing it again. 0190 adds the reader; #82 moved Duplicates
and Smart Albums onto it. No trigger was added on purpose — a maintained mirror is what §8
is removing.

### The preconditions for removing `part_of` and `is_trip` were misread

Both were described as unblocked because their frontend PRs had deployed. They are not.

- **`part_of`** — four functions still WRITE it (`add_place_to_visit`, `add_to_container`,
  `remove_from_container`, `merge_places_auto`) and `places_sync_membership` copies it into
  `place_membership`. It is still the record, exactly as §8 says. #71 moved readers only.
- **`is_trip`** — `visits_sync_trip_flags` keeps it identical to `trip_marked`, but that
  trigger ALSO stamps `updated_at` and the decision fields, so it must be rewritten rather
  than dropped. `set_visit_is_trip`, `apply_inbox_field` and `rebuild_place_visits` all
  still use the column.

Each is a 0188-sized migration. #83 does the safe half of the second one: the card and
`VISIT_COLS` stop reading `is_trip`, readers first, which is the order that made
`solo_profile` boring to remove.

### THE MAP WAS NOT SERVING, AND IT LOOKED LIKE IT WAS

Every `/basemap/*` URL returned **200 with the app's HTML**, because:

1. the zone had **zero worker routes registered** — the route in `wrangler.toml` had never
   been published, so Pages answered the path with its SPA fallback; and
2. the deployed worker was still the **copy-only version from 11 August**. The tile, glyph
   and style code (#73) had never been deployed at all.

A 200 from the wrong server is the worst possible failure here: nothing looks broken.
**Check the content-type, not the status.**

The worker is now deployed WITHOUT its route, so nothing user-facing changed, and verified
at its `workers.dev` address: `tiles.json` reports zoom 0–15, a z6 tile over Virginia
returns 38,148 bytes of `application/vnd.mapbox-vector-tile`, a glyph range 76,044 bytes,
and MapLibre renders Loudoun County with **zero errors**. Preview sent 2026-08-15.

~~Still to do, and both are Erica's call: register `adventureorno.com/basemap/*`, then
point `basemap.ts` at `/basemap/style.json`.~~ **Both were done later the same day** —
the route through the API (wrangler cannot manage it, see Phase 4b step 4) and
`basemap.ts` in #88. Superseded; Phase 4b is authoritative. What was NOT done is
deploying the bundle that contains #88, which is why the map still looked unchanged on
2026-08-16.

### Two mistakes of the same shape, worth naming

- Resolving a conflict, `package-lock.json` was taken from main and "verified" by checking
  that it still resolved **pmtiles** — the dependency in mind at the time. It was missing
  `protomaps-themes-base` and `vitest`, and `npm ci` failed on CI. **Run the check that
  fails, not the check you were thinking about.**
- An empty `import.meta.glob` result was read as a hole in the banned-words guard. The glob
  was fine; the lookup used `lib/data.ts` where the key is `./data.ts`. A change was made to
  a guard on that false premise and then reverted.

Both look identical from the outside: a narrow check that passes reads exactly like a broad
one that passes.

### Also

- **`CLOUDFLARE_API_TOKEN` does not exist in `.env.local`** — it is `CLOUDFLARE_API_TOKEN_MASTER`
  (account-scoped) and `CLOUDFLARE_ZONE_ACCESS` (zone-scoped). Do not verify an account token
  with `/user/tokens/verify`; it returns 401 for account tokens even when they are valid. Use
  a real account endpoint.
- **The deploy already refuses to ship ahead of the schema** (`check:ledger`, `STRICT=1`), so
  an unapplied migration blocks the whole pipeline, not just its own change. #81 adds
  `supabase db push --include-all` in front of it — it needs a `SUPABASE_DB_PASSWORD` secret
  and does nothing until that exists.
- **`scripts/check-data-integrity.mjs`** (#79) reads production's DATA, not its shape:
  impossible dates, visits in the future, visits derived from evidence that is not there, and
  count drift. A warning, not a failure, because a live database can go dirty with nobody
  touching the code.
- **87 visits have no evidence, and 84 of those are fine** — a trail's evidence lives on its
  sections. Only non-containers count. That distinction is the difference between a real
  finding and a scary number.

## 7d. 2026-08-16 — the day nothing was broken and nothing was live

Erica: *"the map style has not changed when I looked at it."* She was right, and every
finding below came out of asking why one true-looking tick was false.

### THE DEPLOY HAD BEEN FROZEN FOR A DAY, AND EVERY TICK STILL READ GREEN

Production sat at `546ff11`, **16 commits behind `main`**, since 2026-08-15 16:21 UTC.
Not a bug: **GitHub Actions was blocked on billing** from 17:47 UTC that day — every run
failed in 5–8 seconds with *"recent account payments have failed or your spending limit
needs to be increased."* CI is the only deploy authority, so merging kept working and
shipping silently stopped. 36 PRs merged on 08-15 and 21 on 08-14; none of the last 16
reached the browser.

**The tell was available and nobody looked at it:** `/version.json` reports the deployed
SHA. Comparing it to `origin/main` is one command and would have caught this in a day.

Fixed by upgrading to GitHub Pro. **Pro does not retroactively re-run anything.**

### `supabase db push --include-all` WOULD HAVE RE-RUN 42 MIGRATIONS

Added in #81, never once executed (it needs a database password that was never set), and
auditing it before arming it is the only reason this was found.

**The ledger is keyed two ways**: 152 rows use this repo's `0NNN` prefix, 75 use a
14-digit timestamp. `check:ledger` matches on NAME and reports 2 gaps.
`supabase db push` matches on VERSION KEY and sees **42** — everything from 0153 to 0194,
all long since applied.

`--include-all` would have re-run all 42 against live data. It would have died partway:
`0191` ends with an unguarded `alter table public.visits drop column is_trip` and that
column is already gone. But 0153–0190 run first, each in its own transaction, and several
backfill — `0190` recomputes place counts, `0188` rewrites `visit_profiles` and
`activity_profiles`. **A backfill re-deriving what a person has since fixed by hand is
this repository's most repeated failure.**

Erica, 2026-08-16: *"I want to delete the risk rather than manage it."* The step is gone.
`scripts/apply-migration.mjs` replaces it: one named file, applied and RECORDED in the
same transaction, so the ledger cannot drift again. No database password exists.

**Two tools disagreeing about the same question is worse than either being wrong**, and
the safe-looking one was the one that was never going to run.

### THE STRAVA RULE IS STILL NOT ENFORCED — 0193 BUILT THE LOCK AND FITTED IT NOWHERE

`0193` added `can_see_activity()`, the `visible_activities` view and a correct
`activities_select` policy. Of the **32 SECURITY DEFINER functions that read
`public.activities`, exactly one uses the guard — `can_see_activity` itself.**

`mileage_by_person` is `SECURITY DEFINER`, calls `assert_member()`, then selects straight
`from public.activities` with no filter. Any signed-in member can ask for the other's
mileage. Same for `card_view`, `wrapped_year_miles`, `race_stats`, `climbing_stats`,
`wander_stats`, `place_days`, `visit_detail`, `activities_of_type`, `activity_lines`,
`shared_outings` — every count, card and statistic in the app.

**This file predicted it exactly**, in "THE STRAVA RULE CANNOT BE DONE WITH RLS":
*"A policy on the table would look correct in psql and change nothing in the app."*
The warning was written, and then the migration walked into it anyway. **Writing a trap
down does not disarm it.** Phase 7's legal precondition is NOT met. Still to do.

### A NIGHTLY JOB HAD BEEN FAILING FOR EIGHT NIGHTS, IN SILENCE

`dedupe-joint-outings` succeeded every night to 2026-08-08 and failed every night from
2026-08-09 with `not authorized`. The break is exactly when the "a machine may only
propose" guard work landed: `group_duplicate_activities` opens with
`is_editor_or_owner()`, and pg_cron has no `auth.uid()`.

**It is the discriminator from 0157 working correctly and catching the wrong job.** The
rule is good; applying an editor check to a function a machine is *supposed* to call is
not. Nobody noticed because a failed cron row looks like nothing at all.

Fixed in `0195`, and the job now PROPOSES into the suggestions ledger rather than writing
`shared_group_id` itself — which is what §2 required of it all along. Erica, 2026-08-16:
*"propose, not apply."*

**Nothing checks that scheduled jobs succeeded.** The watchtower probes URLs; `cron.job_run_details` has nobody reading it. Worth a probe. — **BUILT 2026-08-16 as `0197` + the watchtower's cron sweep; see Step 3 under NOW.**

### THE BACKUP WAS STALE, AND THE RESTORE WAS PART RUMOUR

Freshness had drifted to **42h against a 36h limit**, because the Backup workflow is a
GitHub Action and was blocked by the same billing failure. The gate and the thing it
guards fail together — worth knowing when designing any other gate.

Running the restore verification (`-f verify=true`, which nothing does automatically
except the weekly run) then found a real bug: **`service_health` restored 0 of 415 rows.**
`id` is `bigint generated always as identity`, and the loader excluded GENERATED columns
by testing `is_generated`, which describes `GENERATED ALWAYS AS (expr) STORED` — an
IDENTITY column reads `is_generated='NEVER'`. It sailed through and the insert died.

It was the first identity column in 194 migrations, so it had never been exercised. Fixed
generally via `is_identity` + `OVERRIDING SYSTEM VALUE`, not special-cased. **No table
holding real data was affected** — 35 of 36 restored with matching counts.

*"A backup nobody has restored is a rumour"* — and the weekly restore is the only thing
that could have caught this. Do not let it become monthly.

### THE TRAIL CARD DISAGREED WITH ITSELF

A trail's visit list came from an effect keyed on `place.id`; its mileage came from one
keyed on `allPlaces`. The section list is derived from `allPlaces`, which starts empty and
arrives async. So the miles recomputed across the sections and **the visit list beside
them did not** — the same card, two different answers about which sections it covers.

This is a regression of the exact complaint 0136 was written for: *"the card showed the 32
logged on the trail row and hid the 30 logged on its six sections."* A `react-hooks/exhaustive-deps`
warning had been pointing at it the whole time. **The one lint warning in the codebase was
a real bug**, which is the argument for not carrying warnings.

Both effects now key on the section list itself — correct, consistent, and it stops
refetching every trail whenever any unrelated place is edited.

---

## 7e. 2026-08-16/17 — the plan that ran, and what measuring badly cost

Everything below happened under the 08-16 plan, which is finished. It is here rather than
at the top of the file because a completed plan left in the NOW section is how this
document became a history of itself the first time.

**What closed:** production caught up to `main` (three times), Phase 4 went
**Live-verified** on Erica's own words, the restore was proved after the identity-column
fix, the Strava rule reached the readers and got a guard, the cron jobs got a watcher, the
deploy freeze got a detector, and two stabilization-gate items were closed by asking the
screen instead of the database.

**What it cost to find out** is the more useful record, and it is all here: the stale red
tick, the a11y violations shipped on a brand-new card, the guard aimed at a dialog that no
longer existed, the test that was wrong for a day without going red, the cleanup that
deleted other tests' fixtures, and the confident retraction that measured a login page.

---

### The 08-16 plan, as it ran

Measured against production, not against this file. Every claim below was checked live
before it was written down; where the check disagreed with §7d, the check wins and the
correction is stated.

**Where production actually is, 20:55 UTC 2026-08-16:**

| Fact                        | Measured                                                                          |
| --------------------------- | --------------------------------------------------------------------------------- |
| `/version.json`           | `920e52f` (#99)                                                                 |
| `origin/main`             | `a57a928` (#100) — **one commit ahead**                                  |
| Why                         | CI's`Deploy production` job FAILED on the migration-ledger gate                 |
| Migration ledger            | **all 196 recorded** — `check:ledger` passes now                         |
| `0196` genuinely applied? | **yes** — `visible_activities` exists and `mileage_by_person` reads it |

**CORRECTION to §7d.** It says the billing freeze is the reason nothing is live. That was
true this morning and is not the reason now. #99 deployed at 20:42. The *current* freeze is
one commit deep and has a different cause: the deploy gate refused `a57a928` at 20:46
because `0196` was not yet in the ledger, `0196` was applied by hand shortly after, and
**nobody re-ran the job**. The gate worked exactly as designed. It is a stale red tick, not
a broken pipeline.

#### Step 0 — Re-run the deploy. ✅ **Deployed 2026-08-16 21:05 UTC**

Re-ran `Deploy production` on `a57a928`; it passed in 40s with nothing changed but the
ledger condition being true. `/version.json` now reports `a57a928` — **production and
`origin/main` are the same commit for the first time since 2026-08-15 16:21 UTC.**

**The self-hosted map is Live-verified as SERVING** (Erica's own look is still what makes
Phase 4 done, per Step 1):

| Check                      | Result                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| Deployed`basemap` chunk  | points at`/basemap/style.json?theme=` — the frozen Mapbox style object is GONE from the bundle |
| `style.json?theme=dark`  | `application/json`, **12 layers**                                                         |
| `style.json?theme=light` | **15 layers** (the 3 extra are road casings)                                                |
| A z6 tile over Virginia    | `application/vnd.mapbox-vector-tile`, **38,148 bytes**                                    |
| `/basemap/health`        | `ok:true`, planet 137,281,886,877 bytes                                                         |

Content-type was checked on every one, because §4b's worst failure was a 200 of the app's
own HTML from the wrong server.

**ONE THIRD-PARTY MAP CALL SURVIVES, and it is not the basemap.** The deployed chunk still
requests `api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1.json` — **terrain**, not tiles.
Phase 4's "third-party basemap calls are absent" is now true of the basemap and false of
the elevation model. That is not a regression and not a surprise: replacing it is exactly
§6a-ii (Copernicus GLO-30 → terrain-RGB PMTiles). Recorded so the next person measuring
"are we off Mapbox yet" gets the honest answer instead of a clean grep and a wrong
conclusion.

#### Step 1 — ✅ **PHASE 4 IS LIVE-VERIFIED, 2026-08-16**

Erica, after the deploy: ***"the map looks different."*** That is the sentence Phase 4's
definition of done was waiting for, and **Live-verified** is the highest status in the
table at the top of this file. The basemap is ours, rendered from our own PMTiles in our
own colours. The terrain DEM above is the one third-party map call left, and it is
§6a-ii's job, not Phase 4's.

She said one more thing in the same breath: ***"It should just say Add not Add 1 on the
pill."***

**Fixed.** The count is off the pill. It rode there because retiring the Inbox tab left the
number homeless — but a destination is a place you are going, and a queue length is not
part of its name; it also made the pill's width jump as the number changed. **Nothing is
lost**: `/add` still heads its queue **"To review · N"**, which is the screen that can
actually do something about it. It also drops a `fetchInboxCounts()` that ran on EVERY
navigation to render one digit.

**And it uncovered a test that had been wrong for a day without going red.**
`app/e2e/app.spec.ts` asserted the Add tab links to `/add` and lands on the Add page. #94
changed that on 08-15 — the tab is `to: '/?add=1'` and opens the blank card over the map.
The assertions were stale from that moment, and nothing caught it because **this file only
runs in the nightly `Full browser matrix`, and the nightly was failing in 7 seconds on
GitHub billing.** The suite itself is sound: it sets `REQUIRE_AUTH_E2E=true`, so it cannot
silently skip its own authenticated tests. It simply never got to run. Tonight's would
have caught it.

Two lessons, both already in this file wearing other clothes: **a test that only runs
nightly is only as good as the nightly**, and the pill assertion is now exact — `/^Add$/`,
not `/^Add( \d+)?$/` — because a prefix match would let the count creep back without
failing anything.

#### WHAT RUNNING THE NIGHTLY SUITE FOUND — 2026-08-16, and it was not the pill

Rather than assume the pill change was safe, the `Full browser matrix` was dispatched by
hand — the first time it has completed since the billing freeze. **211 passed, 24 failed.**
The 24 are 6 tests across 4 browsers, and **not one of them was caused by the pill.** They
were all already broken, waiting for a suite that could run.

**Two REAL critical accessibility violations, on the card Erica asked for.** On `/?add=1`:

    critical label       — Form elements must have labels — input[type="date"]
    critical select-name — Select element must have an accessible name — select

§4 of this file says *"zero WCAG A/AA violations across the authed routes, nothing
allowlisted."* That has been **false since #94**, on the newest and most prominent screen
in the app. The cause is a pattern worth recognising: rows are written
`<div class="npd-row"><span>Visit date</span><input/></div>` — the words are on the screen,
next to the control, attached to nothing. The **Name** row three fields above was already
`<label className="npd-row">` and was always fine, so the correct shape was in the same
file the whole time. Fixed by making the rows `<label>`; the CSS is class-based, so it is
byte-identical on screen. The tag picker cannot be a wrapping label — its row holds chips
*and* a select — so it takes an explicit `aria-label`.

The trail select had the same defect and axe never saw it: the run had no trails, so the
row did not render. **One condition away from being invisible** is not the same as fixed.

**The guard that should have caught it was aimed at the wrong element.** The a11y test for
this screen opens `getByRole('dialog', { name: 'Add' })` — but #94 replaced the chooser
with the card, whose accessible name is **"New place"**. The locator failed before axe ever
ran, so the test reported a locator error rather than two violations. *A guard pointed at
something that no longer exists says nothing about what replaced it.*

**`AddSheet` is GONE.** Nothing imported it, and `lockedCard.test.ts` already asserted
MapView does not render it — #94 removed the chooser and left the component behind. Three
e2e tests were still describing its "What are you adding?" screen and its three choices;
they now describe the card. **Erica, 2026-08-16, asked: delete it.** So the component and
its 866 characters of orphaned CSS (`.add-sheet`, `.add-choices`, `.add-note` — used by
nothing else) are removed together. Dead CSS outlives dead components because nobody
greps stylesheets.

The through-line for all six: **a test that only runs nightly is only as good as the
nightly.** #94 merged on 08-15, the nightly died on billing that afternoon, and every one
of these has been sitting in `main` — and since 21:05 today, in production — unseen.

**Proved, not assumed** — the matrix was re-run on the fix branch:

| Run                                | Result                                    |
| ---------------------------------- | ----------------------------------------- |
| `main`, 21:23                    | 211 passed,**24 failed**, 1 skipped |
| `fix/the-card-has-labels`, 21:47 | **235 passed, 0 failed**, 1 skipped |

211 + 24 = 235, so every failure is accounted for and none was traded for a new one.

#### Step 1 (cont.) — the rest of what landed, still to look at

These are all **Merged, not Deployed** today, and Step 0 makes them all visible at once:

| From        | What she should see                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| #86 #87 #88 | The map is OURS — Ink (dark) / Daylight 2 (light), Settings → Map appearance,**no Mapbox call in the network panel** |
| #94         | Timeline drills YEAR → months → days;`/add` opens the blank card; no gear and no stats bar on Places                     |
| #96         | Mileage is her own; "just me" is the default                                                                                 |
| #97         | The watchtower checks WHAT came back, not just that something did                                                            |
| #100        | Each person's Strava-origin activities are their own, in every count and card                                                |

Phase 4 becomes **Live-verified** on her sentence, not on a screenshot of a Worker.

#### Step 2 — Close the six open boxes in the stabilization gate

1. ✅ **The restore is proved — 2026-08-16 21:11 UTC.** The identity-column fix landed in
   #99 at 20:38, **after** the 18:08 verify run that failed with *"cannot insert a
   non-DEFAULT value into column id"*, so it had never once been watched working. Ran it:

   |               | 18:08 (before)                             | 21:11 (after)                                      |
   | ------------- | ------------------------------------------ | -------------------------------------------------- |
   | Tables loaded | 35,**errors: 1**                     | 35,**errors: 0**                             |
   | Row counts    | `ROWS LOST`, `service_health` 0 of 415 | **all 45 tables match exactly, 21,143 rows** |

   The gate in the stabilization list at the top of this file can now be ticked without the
   "only partly proven" caveat it has carried since this morning.
2. Erica: sign in → open a place card → edit and save a visit → reload → it is still there.
3. Josh: every editor action, with no unexplained permission or save failure.
4. Manual smoke on the deployed SHA: map, place card, visit page, Add/import, photos,
   stats, logout.
5. Confirm both hard gates on a real run — ledger (already proven; it is what blocked
   `a57a928`) and backup freshness.
6. ✅ GitHub CLI is healthy — `adventureorno26` is the active account.

#### Step 3 — Close the three traps 08-16 opened and did not finish

- ✅ **`cron.job_run_details` has a reader — `0197` + the watchtower.** It had none:
  verified as zero references anywhere in the repository. `dedupe-joint-outings` failed
  eight consecutive nights in silence, and the reason nobody noticed is that **a failed
  cron row breaks no page, 500s no request and produces no complaint — it looks like
  nothing at all.** The watchtower was probing five URLs every fifteen minutes throughout
  and had no idea the database was running anything.

  `cron_health()` answers for the jobs and the existing Worker records the answers into
  `service_health`, so both halves show on one screen. It is the same lesson as 0194 one
  layer down: *0194 — a 200 from the wrong server looks like success, so ask what came
  back; 0197 — a scheduled job looks like a working job, so ask whether its last run
  succeeded.*

  **Staleness is measured, not parsed.** A job can fail by not running at all, and pg_cron
  has no `next_run`; parsing five-field cron expressions in SQL to compute one is a bug
  generator. The job's OWN history sets the expectation — the median gap between its
  recent runs, doubled — so a daily job tolerates ~48h and a quarter-hourly one ~30m with
  nothing needing to know which is which. Proved against production read-only before it
  was written down: it returns `ok=false … not authorized` for `dedupe-joint-outings` and
  `ok=true` for the other two, and with the tolerance forced to one second all three
  correctly read *"overdue for a job that normally runs every 24h"*.

  **A job whose last run SUCCEEDED can still be broken** — that is the case the ok flag
  exists for, and the one a status-only check would call healthy.

  ⚠️ **`0197` IS NOT APPLIED YET.** Applying it was declined by this session's permission
  gate, so it is merged-but-unapplied and **the production deploy gate will refuse the
  next deploy until it is applied** — correctly, and exactly as it refused `a57a928`
  earlier today. Apply with `npm run db:apply 0197_the_jobs_are_watched`, then deploy the
  Worker with `cd workers/watchtower && npx wrangler deploy`. The Worker is harmless until
  then: an unreachable `cron_health()` records one honest `cron` failure row rather than
  blaming a job.
- **A test that keeps the Strava rule enforced.** 17 functions still read
  `public.activities` directly. Checked one by one, that is *correct* — they are writers
  and machine jobs, which #100 deliberately kept on the table because the view filters on
  `auth.uid()` and pg_cron has none. `shared_outings` reads raw and is still right: it
  returns only the caller's own miles plus an honest `restricted_rows` count. But nothing
  stops the **next** display reader from selecting straight from the table. Add the test
  that fails when one does — the lock is fitted now, and this is what keeps it fitted.
- **A deploy-freeze detector.** §7d already named the tell and it went unused twice in two
  days: compare `/version.json` to `origin/main`. One command. It should be a check, not a
  thing somebody remembers.

#### Step 4 — Then the queued lanes, in the order locked on 08-14

Nothing here starts until Steps 0–3 are true for the same commit.

| Lane                                     | State         | Note                                                                                                                                                                                          |
| ---------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 remainder                        | nearly closed | Steps 2–3 above ARE the remainder                                                                                                                                                            |
| Phase 3 — the one page                  | not started   | `/attention`, `/photos/sort`, `/duplicates`, `/health`, `/trash` and Settings → Data fold into `/add`, then are REMOVED. Restore `PlaceQuickEdit`; make transient UI transient |
| Phase 4d — geocoding we own             | nothing built | Overture → PMTiles; Mapbox stays the fallback                                                                                                                                                |
| Phase 6 — what we own                   | nothing built | The tile trick: reverse geocode and elevation are tile reads. Routing stays PAUSED                                                                                                            |
| Phase 7 — fitness ingest                | nothing built | intervals.icu first; email-in is the best effort-to-coverage item                                                                                                                             |
| Phase 8 — events, social, privacy floor | nothing built | Much of it is gated on the LLC and the native shell                                                                                                                                           |

**Two things are waiting on Erica and block nothing else** (§"Open, awaiting Erica's
decision"): whether to attach the **122 photos** that match exactly one visit on one day
at one place — unambiguous, and 0157 now makes the attachment permanent — and the 32 with
fabricated `12:00:00` timestamps, which must be proposed rather than written.

---

## 8. Facts that must not be relearned

- **Overpass** rate-limits 2 slots per IP and edge functions share Supabase egress:
  rotate mirrors, hard-abort at 25s, keep batches ≤8.
- **Overpass returns nothing for Red Rock / Lake of the Red Rocks** — 97 activities. No
  suggestion must mean leave it alone.
- **`admin.rpc(...).catch()` is a TypeError** — an rpc() is a thenable, not a Promise.
- **A date-only string parses as UTC midnight** and renders as the previous day west of
  Greenwich. Parse `YYYY-MM-DD` with local components. (`fmtRunDate` now does this itself.)
- **~~`places.part_of` is the record of membership~~ — REVERSED 2026-08-15 by migration
  0192. `place_membership` is the record; `part_of` is the mirror.** For most of this
  project's life the opposite was true, and writing a membership row on its own undid
  itself the next time anyone touched that place — which is why the old wording said
  "write `part_of`". 0192 dropped `places_sync_membership` and added
  `membership_sync_part_of` going the other way, and moved every writer:
  `add_to_container`, `remove_from_container`, `add_place_to_visit`, `merge_places_auto`
  and **`create_experience`** — that last one is the card's "Part of a trail?", which
  would otherwise have been accepted and silently dropped. **Write the ROW.** The array is
  kept correct only until `create_experience`, `rebuild_place_visits` and the exports stop
  reading it, and then it goes.
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
- **A deleted file can be RESURRECTED by OneDrive plus the auto-save commit.** `README.md`
  was deleted on 2026-08-11 and reappeared 90 minutes later in
  `auto: save from Claude Code (2026-08-11 08:58)` — OneDrive restored the file from its
  own history and the periodic auto-commit added it back. After deleting anything, check
  it is still gone an hour later.
- **Never** reintroduce the home exclusion zone. **Never** force-push. The service_role
  key is already rotated — do not ask her to rotate it again.

---

## 9. Where things live

**Here.** Everything is in this file, from 2026-08-11: the model, the business rules, the
operations runbooks, the security baseline and the decision history are all sections below.

`CLAUDE.md` still exists ONLY because Claude Code loads it automatically at the start of
every session — it is a four-line pointer to this file, not a second document. Nothing
else is a `.md`.

**History of deleted docs:** git. `git log --diff-filter=D --name-only` finds them.

Both of those lived outside the repo and are now deleted too.

---

# PART TWO — REFERENCE

Everything below was a separate markdown file until 2026-08-11. Erica: *"it is now the
SINGLE source of truth and any future changes and instructions should be added there,
never create a new MD."* The plan is Part One, above; this is the reference material it
relies on.

## 10. The data model

*(was §10 (the data model, below))*

**Authoritative as of 2026-08-08 (migrations 0136–0137). If any other document, comment, or
plan contradicts this file, this file wins and the other one is wrong.**

Read this before touching places, visits, trips, stats, or containment.

#### Why this file exists

The same schema work was redone at least five times. The cause was not carelessness —
it was that **three different models were each "authoritative" in some document**, so
every session picked one and undid the last:

| Document                                      | Claimed a trip is…                               |
| --------------------------------------------- | ------------------------------------------------- |
| ADR 0001 (deleted 2026-08-11, in git history) | a first-class`trips` row, **not** a place |
| `NewClaude.md` (deleted 2026-08-11)         | a**place** that is a non-counting rollup    |
| What Erica actually wants                     | a**visit she marked**                       |

Worse, two mechanisms silently *regenerated* the retired model, so data fixes could
not hold:

1. `sync_place_category` had `when NEW.categories @> array['trip'] then 'trip'` as its
   second branch. Migration 0127 cleared that category; every later UPDATE re-derived
   it. Cape Cod ended up back at `category='trip'` → `counts_as_place=false`, holding
   10 photos and a real visit while counting as **nothing**.
2. `visits.is_trip` was a GENERATED column, `end_date > start_date` (migration 0047),
   so the database promoted **any** multi-day visit to a trip by arithmetic. 50 of 485
   visits were flagged trips that Erica never marked. Brewster's 2-day stay was one.

Both concepts are now removed, not merely cleaned up. There is nothing to regenerate.

#### The model — two nouns

##### PLACE — counts **once**, ever

A row in `places`. Every real thing is one: a city, a region, a restaurant, a beach, a
trail, a destination like Cape Cod. Returning to a place does **not** add another
place; it adds a visit.

```
counts_as_place = NOT is_trail
```

A **trail** is the only thing that does not count, because it is a rollup of segments
that already counted — counting it too would double-count. A destination **always**
counts. There is **no `trip` place category**; do not add one back.

A city is both a place you visited *and* a box holding other places. It is not one or
the other. San Diego counts, and so do the taco shop, the beach, and the ride.

##### VISIT — counts **every** time

A row in `visits`: dates, attribution, and evidence. Two stays in San Diego are two
visits at one place.

- `is_trip` — **a person marked this visit as a trip.** Nothing automatic ever sets
  it. Not duration, not a stop count, not an importer. `set_visit_is_trip()` is the
  only way, and it requires owner/editor.
- `status` — `taken` (it happened) or `planned` (a future-dated trip).
- `manual` — protects the row from `rebuild_place_visits`, which deletes derived
  visits. Any marked trip is `manual = true` for exactly this reason.
- `solo_profile` — attribution. `null` = **Both**; otherwise that person. Attribution
  lives on the visit only, never on the place. `places.solo_profile` was the last
  place-level remnant and was **dropped in 0136**; read a place's attribution from
  `place_attribution()`, which derives it from the visits.

**Photos and activities are evidence hanging off a visit.** They are not sibling rows
and never their own visits. Brewster is one 2-day visit that contains a ride and a
run — not three visits.

#### Containment

A place attaches to a container two ways:

- **spatially** — coordinates inside a `boundary` polygon (cities, regions)
- **by explicit link** — `place_membership`, for trails and destinations

`place_membership` is canonical. `places.part_of` is a compatibility mirror only.
Write relationships through the canonical mutation API from §0.3; never add a new direct
writer to `part_of`.

#### The statistics

Every stat uses the same view rule, so they can never disagree:

Use `accepted_visits` joined to `visit_profiles`. An absent participant row means unknown,
not "Both"; shared attribution requires explicit participant rows. The older
`solo_profile IS NULL` rule is retired compatibility history.

| Stat   | Definition                                                                   |
| ------ | ---------------------------------------------------------------------------- |
| Places | distinct places with a qualifying visit, where`counts_as_place`            |
| Visits | count of visit rows (the map badge = number of visits, never days)           |
| Trips  | count of accepted top-level visits where canonical`counts_as_trip` is true |
| Miles  | sum of`activities.distance`, attributed the same way                       |

#### Naming (migrations 0129–0131)

There is **no automatic naming.** The nightly geocoder and the dupe-merger were
unscheduled in 0130 — they were the thing overwriting names within the hour.

- `name_locked` — a person named it; automation must never rewrite it
- `named_by` — who chose the name
- `name_scope` — the space it was named in: a profile id = that person's own space and
  only they may rename; `null` = the shared Both space and either may

A real name is claimed on **any** write by a trigger (0131), so the several client
creation paths cannot drift out of sync one at a time.

#### Rules for changing this

1. Never reintroduce a `trip` place category or a derived `is_trip`.
2. A one-shot data fix that a trigger can undo is not a fix. Remove the mechanism.
3. Every rule here is enforced by a DB test in `supabase/tests/`. If you change a
   rule, change its test in the same migration — and give the test a negative control
   that fails when the rule is removed.
4. Update **this** file, not a new plan document.

#### Retired — do not restore

- The `trips` / `trip_stops` tables (a trip is a visit). **Dropped in 0137**, along
  with the `trip` place category, the /trips + /trip/:id + suggested-review pages,
  and every `*_trip_stops_*` function. `rebuild_place_visits` takes its fusing
  window from `visits.is_trip` now; `create_experience` raises on a trip link.
- `places.solo_profile` (dropped in 0136).
- `places.category = 'trip'`, and `holds_children` including `'trip'`.
- `visits.is_trip` as a generated column.
- Auto-detected / `suggested` trips that reappeared as new suggestions daily.
- The nightly geocode and dupe-merge schedules.

## 11. Business rules and agent instructions

*(was the substance of `CLAUDE.md`)*

Private travel-map web app for Erica (owner) and her partner (editor). World map of visited
places, auto-built from photo EXIF, passive GPS, and Strava. Invite-only. Domain:
adventureorno.com on Cloudflare Pages. Repo: github.com/adventureorno26/adventureorno.com
(GitHub account: adventureorno26).

#### The verification rule (non-negotiable)

**Every change is verified in the UI, on production, after it deploys.** Not "the build
is green", not "the migration applied", not "the row is in the table" — opened in a
browser, on the real site, doing the thing it claims to do.

This exists because it was broken repeatedly:

- A membership row was deleted and the card still showed the section, because the UI
  reads a denormalised `part_of` column and the delete never touched it.
- 28 visits were reported as empty because a query counted activities on the container
  instead of the sections.
- A config value went missing and the Google Photos button silently disappeared —
  nothing failed, nothing logged.

So: **done means seen on the screen.** If it has not been opened in the app after
reaching production, it is not done, and it must not be reported as done. When the
database and the screen disagree, the screen is right.

#### Stack (do not substitute without asking)

- Frontend: React 18 + Vite + TypeScript. MapLibre GL JS v5 for all maps. Deployed to Cloudflare Pages.
- Current basemap: Mapbox raster fallback rendered by MapLibre GL JS v5. Target basemap:
  self-hosted Protomaps PMTiles in Cloudflare R2 through the read-only tile Worker in
  Phase 4. Geocoding currently uses Mapbox with a MapTiler fallback; it is a separate
  replaceable service, not part of the self-hosted basemap.
- Backend: Supabase — Postgres 15 with PostGIS, Auth, Edge Functions (Deno), pg_cron.
- Photo storage: Cloudflare R2, accessed only through the `photo-gateway` Worker (upload + signed reads).
- Workers: Wrangler-managed, in `/workers`. Edge Functions in `/supabase/functions`.
- Package manager: npm. Lint: eslint + prettier. Tests: Vitest, SQL regression tests on a disposable Supabase stack, Worker tests, and Playwright across desktop Chrome/WebKit plus iPhone/Android projects.

#### Repository layout

```
/app                 React SPA
/workers/photo-gateway   R2 upload, thumbnailing, signed URL reads
/supabase/migrations     SQL migrations (numbered, never edited after merge)
/supabase/functions      ingest-overland, strava-webhook, strava-backfill, invite
/docs                STATE.md — this file, and nothing else (2026-08-11)
```

#### Non-negotiable business rules

1. **No home exclusion zone.** There is NO location-based ingest filter. Photos, location pings,
   and Strava activities are stored regardless of where they were taken — including at home. (The
   old 15-mile "home zone" around Leesburg was removed in migration `0102`; do not reintroduce it
   anywhere — code, `settings`, docs, or UI.) Local outings ARE logged and counted.
2. **Strava ingest.** Every Strava activity with a start point is ingested and placed, regardless
   of type or location. (Hikes/Walks/Runs are no longer a special case — nothing is excluded.)
3. **Mileage counter.** The stats bar shows total miles (sum of `activities.distance`, meters →
   miles, 1 decimal) across all stored Strava activities, plus a per-type breakdown on hover/tap.
4. **Photo processing.** Server-side resize so the longest edge ≤ 2400 px (originals are NOT
   retained), plus a 400 px thumbnail. Serve via signed URLs only — no public R2 access. Strip
   GPS EXIF from the stored file; coordinates live only in the DB.
5. **No screenshots.** The upload Worker rejects: any image without GPS EXIF, any PNG, and any
   image whose EXIF lacks a camera make/model. (The iOS Shortcut also filters `Is Screenshot = false` and `Has GPS = true` — the Worker is the backstop, not the only gate.)
6. **Deletion blocks the automated re-import, but a manual re-upload can bring a photo back.**
   Owner can delete any photo; an editor can delete photos they uploaded. Deletion removes the R2
   objects and DB row AND inserts the photo's SHA-256 hash into `deleted_hashes`. The nightly
   Shortcut ingest still rejects any upload whose hash is in `deleted_hashes` (so deletions aren't
   auto-resurrected). A **deliberate manual upload** (override) may re-add a deleted photo — doing
   so clears the hash from `deleted_hashes`. (Changed from the original "permanent + sticky" rule
   at the owner's request.)
7. **Auto-upload is Erica-only.** Exactly one device ingest token exists (Erica's). The partner
   has role `editor`: full manual upload / entry editing rights in the UI, but no ingest token is
   ever issued to him, and there is no UI to create additional device tokens without owner role.
8. **Privacy.** No public routes. Every page requires an authenticated session; every table has
   RLS requiring a `profiles` row. Signups disabled in Supabase Auth — access only via the invite
   flow. Never log photo coordinates or tokens.

#### Schema quick reference

**The data model is defined in §10 (the data model, below) — read that first.**
A place counts once; a visit counts every time; a trip is a visit you marked. There is
no `trips` table and no `trip` place category.

(Table list below; authoritative version = migrations)
`places`, `entries`, `photos`, `location_pings`, `activities`, `trips`, `profiles`, `invites`,
`deleted_hashes`, `settings`, `ingest_tokens` — as defined in `0001_init.sql`. Geometry columns
are `geography(Point,4326)`. Cluster job uses `ST_ClusterDBSCAN` over unassigned photos + pings,
merge radius 10 km, assigning to nearest existing place within 10 km before creating new ones.

#### Environment (this project's live services)

- Supabase project URL: `https://aanfyhsjbtnqzphuoiem.supabase.co`
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the `sb_publishable_...` key) are
  client-safe and live in `.env.local` / Pages env vars. The **service_role key is never
  committed, printed, or logged** — Supabase/Wrangler secrets and `.env.local` only.
- `VITE_MAPBOX_TOKEN` and `VITE_MAPTILER_KEY` are client-side fallback credentials and
  must be origin-restricted in their provider dashboards. Neither is the target basemap.
- Actual key values: see `.env.local` (gitignored) — MANUAL-SETUP.md records the
  provider/dashboard source, never the value.

#### Git & GitHub workflow

- Remote: `adventureorno26/adventureorno.com`, authenticated via the local `gh` CLI session
  (account adventureorno26). Verify with `gh auth status` at session start; if unauthenticated,
  stop and ask Erica to run `gh auth login`.
- Work on a focused branch; open a PR with a summary and exact verification counts.
  Never merge or promote a production deployment while required CI is red. This
  private repository cannot use GitHub's paid branch protection on the current
  plan, so enforce the gate through the deployment workflow and human review.
- Never force-push. The only exception is the separately approved history-scrub
  procedure, which must stop for Erica's exact approval before any rewrite.

#### Conventions

- Every phase ends with: migrations applied and recorded, `npm run lint && npm run test`
  clean, deployed preview verified, PR opened, and the decision/proof recorded in this
  file. Do not recreate `/docs/decisions.md`.
- Secrets only via Wrangler secrets / Supabase secrets / `.env.local` (gitignored). Never commit
  keys. `.env.example` lists every var with a comment.
- Small commits with imperative messages.
- When a task requires a human step (dashboard clicks, App Store installs, OAuth approval), stop
  and print the exact steps rather than faking it — MANUAL-SETUP.md tracks these.

#### There is one plan, and this is not it

[`docs/STATE.md`](docs/STATE.md) is the ONLY planning document: what the app is, the one
model, what is left to build, and the rules that stop work being erased. This file holds
agent instructions and business rules — nothing about what to do next.

The July 25 backlog ledger and the Commercial/Spaces proposal that used to live here were
removed on 2026-08-11, along with `README.md`, `docs/archive/`, `docs/adr/`, `NewClaude.md`
and `CLAUDE-CODE-INSTRUCTIONS-2-70.md`. Between them they made ~380 KB of competing
"what to do next", which is the mechanical reason the same work kept being re-requested:
every session picked a different one. They are all in git history if a decision needs
recovering — `git log --diff-filter=D --name-only` will find them.

**If you are about to write a plan into a new markdown file: don't. Put it in STATE.md.**

## 12. Operations

### 12a. Manual setup

*(was §12a (below))*

The project is already live. This file records owner-only provider/device
operations; it is not an initial build checklist. Never paste real credential
values into this file. this file has the order of work.

#### 1. Domain (5 min)

`adventureorno.com` is registered and attached to the live Pages project. Manage
DNS/custom domains only through the verified account and use
§12b (below) for deployment controls.

#### 2. Repo & Claude Code ↔ GitHub connection (10 min)

Repo: **adventureorno26/adventureorno.com** (private). To configure a new local
operator workstation:

- `git clone https://github.com/adventureorno26/adventureorno.com.git` and work from that root.
- `gh auth login` → GitHub.com → HTTPS → "Login with a web browser" while signed into the
  **adventureorno26** account in that browser. Confirm with `gh auth status`. This is what lets
  Claude Code push branches and open PRs as you.
- Optional but recommended: inside a Claude Code session run `/install-github-app` and install
  the Claude GitHub App on this repo — you can then tag `@claude` on issues/PR comments and it
  works asynchronously from GitHub.

#### 3. Supabase — project already exists (5 min of settings)

Copy the project URL and current publishable key from the Supabase dashboard into
`.env.local` and the corresponding Cloudflare `VITE_*` variables. Then audit:

- Authentication → Sign In/Up: **disable "Allow new users to sign up"** (invite-only depends on
  this).
- Project Settings → API keys: copy the **service_role/secret key** into `.env.local` ONLY when
  Phase 1 asks. Never paste it into chats, commits, or client code.
- Database: Phase 1's migrations will enable PostGIS; no manual action.

#### 4. MapTiler — key exists, restrict it (3 min)

Copy the current key into `VITE_MAPTILER_KEY`. In cloud.maptiler.com → API keys → this key →
**Allowed HTTP origins**: add `adventureorno.com`, `www.adventureorno.com`, `localhost:5173`.
Unrestricted keys can be scraped from your bundle and drain the free tier.

#### 5. Cloudflare R2 (Phase 2)

The private `adventureorno-photos` bucket is live. Confirm it remains non-public;
use only a short-lived/scoped API token when maintenance requires one.

#### 6. Strava API app (Phase 4, 10 min)

strava.com/settings/api → Create app. Category: Data Importer. Website: https://adventureorno.com.
**Authorization Callback Domain:** `aanfyhsjbtnqzphuoiem.supabase.co` (the OAuth callback is the
`strava-auth` Edge Function). Save Client ID + Secret, then:

**a. Server secrets** (from the repo root, token in `.env.local`):

```bash
supabase secrets set STRAVA_CLIENT_ID=<id> STRAVA_CLIENT_SECRET=<secret> \
  --project-ref aanfyhsjbtnqzphuoiem
```

**b. Client id** → add `VITE_STRAVA_CLIENT_ID=<id>` to `.env.local` **and** Cloudflare Pages env,
then rebuild/redeploy the SPA (Vite bakes it at build time).

**c. Connect** — open `/settings` on the live site → **Connect Strava** → approve. You should land
back on `?strava=connected`.

**d. Create the push subscription** (one time; the verify token is in `.env.local` as
`STRAVA_VERIFY_TOKEN`):

```bash
source .env.local
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=<id> -F client_secret=<secret> \
  -F callback_url=https://aanfyhsjbtnqzphuoiem.supabase.co/functions/v1/strava-webhook \
  -F verify_token=$STRAVA_VERIFY_TOKEN
```

Strava immediately GETs the callback with a challenge; the deployed `strava-webhook` echoes it and
the subscription activates. Verify: `curl -G https://www.strava.com/api/v3/push_subscriptions \ -d client_id=<id> -d client_secret=<secret>` should list it. After that, finished activities
appear on the map within ~a minute; `/settings → Strava → Backfill` pulls history.

#### 7. iPhone setup — Erica's phone (Phase 2–3, ~20 min)

- Build the **daily photo Shortcut**. Automations: daily 9:00 PM + "when joining home Wi-Fi",
  both set to Run Immediately / no confirmation. **The written spec does not exist** — this
  line used to point at `/docs/ios-shortcut-daily.md`, which was deleted with every other
  document on 2026-08-11 and was never folded in here. What is known about the Shortcut is
  scattered: it filters `Is Screenshot = false` and `Has GPS = true` (§11), and it carries the
  device ingest token from `.env.local` as `?token=` (C5, §7 — still in plaintext in the
  request logs). **The Shortcut Erica runs today exists only on her phone.** Writing its
  steps down here is a real gap, not a formatting one.
- Install **Overland** (App Store, free). In its settings:
  - **Receiver Endpoint URL:**
    `https://aanfyhsjbtnqzphuoiem.supabase.co/functions/v1/ingest-overland?token=<ERICA_DEVICE_INGEST_TOKEN>`
    (the same device token as the photo Shortcut — value is in `.env.local` as
    `ERICA_DEVICE_INGEST_TOKEN`. Overland can't add custom headers, so the token
    rides in the query string.)
  - Significant-location or continuous mode, **batch 50**, trip mode off.
  - Tap **Send Now** once — you should see a green success and a `{"result":"ok"}`.
    There is no home-exclusion zone. Location ingestion follows the current accuracy
    and authorization rules, including at-home observations.

#### 8. Partner's iPhone (Phase 5, 5 min)

Nothing to install for ingestion (by design — his photos are manual-only). He just accepts his
invite email and optionally adds the site to his home screen (Share → Add to Home Screen).

#### 9. One-time backfill (Phase 6)

- **Strava history:** automatic once Phase 4 auth exists — the backfill function pulls the past
  year (rate-limited, may take ~15 min).
- **Photos, past year:** build the one-shot variant of the daily Shortcut — same steps, date
  range = last 365 days, run in month-sized batches you trigger manually (expect it to churn;
  keep the phone plugged in). Its spec doc is gone too, and depends on the daily one above.
- **Google Timeline (optional):** if you had Google Maps location history on your iPhone, request
  Takeout → Location History (Timeline) → drop the JSON into the importer at /settings/import.
  If you never used Google Timeline, skip — photos + Strava cover the year well.

### 12b. Deploying the app

*(was §12b (below))*

Current project: `adventureorno-com` (Git-integrated), custom domains
`adventureorno.com` and `www.adventureorno.com`. This runbook operates the live
project; do not create a replacement project.

No step here authorizes a production change. Verify the target project, commit,
environment, and backup/rollback path before acting.

#### Production-branch auto-deploy is disabled

This safety change is complete. Keep **automatic production branch deployments** disabled
for `adventureorno-com`. The only production path is the gated `deploy-production` job in
`.github/workflows/ci.yml`; do not re-enable Cloudflare Git integration as a second path.
Preview deployments may remain enabled because they do not control the custom domain.

Cloudflare documents this control in
[Branch deployment controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/).

#### Environment inventory

Production and Preview need the client-safe values below. Copy real values from
the provider dashboards or the existing Cloudflare configuration; never put them
in this document or a commit.

```text
NODE_VERSION=22
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_MAPTILER_KEY
VITE_PHOTO_GATEWAY_URL
VITE_GOOGLE_CLIENT_ID
VITE_STRAVA_CLIENT_ID
VITE_MAPBOX_TOKEN          # optional
VITE_FOURSQUARE_KEY        # optional
```

Do not add a Supabase service-role key, provider client secret, device ingest
token, or Cloudflare API token to Pages build variables. Vite exposes `VITE_*`
values to the browser.

#### Manual verified promotion (temporary)

Use only after every required Phase 1 check passes for the exact commit:

```sh
git status --short
git rev-parse HEAD
npm ci
npm run build --workspace app
npx wrangler pages deploy app/dist --project-name adventureorno-com --branch main
```

The command requires `CLOUDFLARE_ACCOUNT_ID` and a scoped
`CLOUDFLARE_API_TOKEN` in the shell. Do not echo either value. After upload, smoke
test `/login` and `/no-such-page`; confirm the deployment's commit and production
alias in Cloudflare before considering the promotion complete.

#### CI-gated promotion is implemented

`.github/workflows/ci.yml` already runs `deploy-production` only for a green push to
`main` when `PRODUCTION_DEPLOY_ENABLED=true`, rebuilds the exact SHA, deploys it to
`adventureorno-com`, and checks production `/version.json`. Keep its Cloudflare token
scoped to Pages edit for the correct account. The remaining hardening is to require a
fresh backup and `STRICT=1 npm run check:ledger` before the build is uploaded.

Cloudflare's official pattern is documented in
[Direct Upload with continuous integration](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).

#### Supabase Auth redirects

Dashboard → **Authentication** → **URL Configuration**:

- Site URL: `https://adventureorno.com`
- Redirect URLs: the apex and `www` `/login` URLs, local `/login`, and only the
  preview URLs intentionally used for authentication testing.

Do not use the production Supabase project for automated acceptance tests.

#### Rollback

Cloudflare → `adventureorno-com` → **Deployments** → select the last known-good
production deployment → **Rollback**. Then record the failed and restored
deployment IDs, commit SHAs, timestamps, and smoke-test result. Fix forward in Git;
do not hide the incident by rewriting history.

### 12c. Deploying the photo gateway

*(was §12c (below))*

The Worker and R2 bucket are live. These are maintenance and redeployment steps,
not initial setup instructions. They require explicit production authority.

#### 0. Before any production change

- Confirm the target account, Worker, R2 bucket, and current deployed version.
- Run Worker typecheck, unit tests, and Wrangler dry-run locally.
- Never print a device token or service-role key. Rotate a credential first if it
  has appeared in a log, document, commit, or chat transcript.

#### 1. Confirm the existing R2 binding

`workers/photo-gateway/wrangler.toml` is the source of truth for the bucket binding.
List the account's buckets and confirm the configured bucket exists; do not run a
create/delete command during an ordinary deployment.

```bash
### Needs an API token with R2 edit + Workers Scripts edit (create at
### dash.cloudflare.com → My Profile → API Tokens → "Edit Cloudflare Workers"
### template, and add R2 Storage: Edit). Then:
export CLOUDFLARE_ACCOUNT_ID=<account-id>
### RENAMED 2026-08-11: .env.local now carries CLOUDFLARE_API_TOKEN_MASTER (verified
### against R2 and Pages). wrangler reads the UN-SUFFIXED name, so map it across.
### `npx wrangler login` also works and covers R2 without any token at all.
export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN_MASTER"
cd workers/photo-gateway
npx wrangler r2 bucket list
```

#### 2. Set Worker secrets

> ⚠️ **This block used to be a live footgun** (found 2026-08-11). It read
> `printf '%s' "$SUPABASE_SERVICE_ROLE_KEY" | wrangler secret put …`, and NEITHER of those
> variable names exists in `.env.local` — the real ones are `SUPABASE_SECRET_KEY` and
> `VITE_SUPABASE_PUBLISHABLE_KEY`. Run verbatim, it piped EMPTY STRINGS over two working
> Worker secrets and took the photo gateway down. The version below reads the right names
> and refuses to write an empty value.

```bash
### The Worker's PostgREST + session-check keys. Names as they are in .env.local:
###   SUPABASE_SECRET_KEY            -> the Worker's SUPABASE_SERVICE_ROLE_KEY
###   VITE_SUPABASE_PUBLISHABLE_KEY  -> the Worker's SUPABASE_ANON_KEY
### An empty pipe here silently breaks photo serving, so check first and stop if blank.
set -euo pipefail
cd workers/photo-gateway

put_secret() {                       # put_secret <worker-name> <value>
  [ -n "${2:-}" ] || { echo "REFUSING: $1 is empty — nothing written." >&2; return 1; }
  printf '%s' "$2" | npx wrangler secret put "$1"
}
put_secret SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SECRET_KEY"
put_secret SUPABASE_ANON_KEY         "$VITE_SUPABASE_PUBLISHABLE_KEY"
```

#### 3. Deploy

```bash
npx wrangler deploy
### Note the printed URL, e.g. https://adventureorno-photo-gateway.<subdomain>.workers.dev
```

#### 4. Point the SPA at it

Add to `.env.local` and to **Cloudflare Pages → adventureorno-com → Settings →
Environment variables** (Production + Preview):

```
VITE_PHOTO_GATEWAY_URL=https://adventureorno-photo-gateway.<subdomain>.workers.dev
```

Then rebuild and follow §12b (below). Vite bakes
the value at build time; do not promote while required CI is red. The temporary
manual command, after verification and explicit approval, is:

```bash
cd ../../app && npm run build
cd .. && npx wrangler pages deploy app/dist --project-name adventureorno-com --branch main
```

#### 5. Verify (acceptance criteria)

- `curl -H "Authorization: Bearer $ERICA_DEVICE_INGEST_TOKEN" --data-binary @geotagged.jpg \ -H "Content-Type: image/jpeg" https://<gateway>/ingest` → `{"ok":true,"id":...}`;
  photo shows in the unassigned tray, ≤ 2400 px, no GPS in the served file's EXIF.
- POST a screenshot PNG → `{"skipped":"screenshot"}`. (There is no location filter —
  a geotagged photo taken at home is stored like any other.)
- Delete it in the UI, re-POST the same bytes → `{"skipped":"deleted"}` (rule #6).
- `/ingest` with a bad/absent token → 401. A partner session can `/upload` but
  never `/ingest`.

#### Optional: custom subdomain / route

For a stable URL you can add a route like `photos.adventureorno.com/*` in
`wrangler.toml` (`routes = [...]`) once the DNS record exists; not required — the
`*.workers.dev` URL is fine for a private app.

### 12d. Backup and restore

*(was §12d (below))*

AdventureOrNo is a private two-person memory journal + trip planner. Its data —
exact places, visit dates, notes, ratings, coordinates, and media — is
irreplaceable and private. This document is the **procedure**; it deliberately
contains **no destinations, keys, or credentials**. You supply those at run time.

> Status: procedure only. Running these commands is a manual, user-initiated
> step. No scheduled job, upload, or production mutation is created by committing
> this file. Nothing here has been executed against production.

#### What gets backed up

1. **Postgres** (Supabase project) — all canonical rows: `profiles`, `people`,
   `places`, `visits`, `entries`, `trips`/`trip_stops`, `activities`,
   `location_pings`, `photos`/`videos` **metadata**, reactions, `place_categories`,
   membership, and `settings`. The concrete tool is **`scripts/export-data.sh
   <dir>`** — a versioned, integrity-checked export (`manifest.json` with format +
   schema version, per-table row counts + SHA-256; `data/<table>.copy`). It
   **excludes** the credential tables (`ingest_tokens`, `strava_accounts`,
   `google_tokens`) and never emits bytes or signed URLs. `pg_dump` is a fallback.
