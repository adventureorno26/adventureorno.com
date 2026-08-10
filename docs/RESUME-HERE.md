# Resume here — state as of 2026-08-09, 13:00 ET

Written so a brand-new chat can pick this up cold. **Read this file, then
`docs/INGEST-REBUILD.md`.**

---

## Paste this into a new chat to start

> Read `docs/RESUME-HERE.md` and `docs/INGEST-REBUILD.md` in
> `adventureorno-claude-code`, then tell me what you're about to do before you do it.
> We are building step 1 of the ingest rebuild.

That's it. Everything below is context that file points at.

---

## 1. Where we are in one paragraph

Activity names were garbage — 328 of them said "Morning Walk" / "Lunch Run" instead
of saying where Erica actually was. **That is fixed and live: all 328 now carry real
place names, and none of her own descriptive names were touched.** While fixing it we
found the deeper problem — machines were writing guesses straight into records as
facts, and other machines were overwriting them. So the next piece of work is a
**rebuild of ingest around suggest-then-approve**, which is fully designed in
`docs/INGEST-REBUILD.md` and **not yet built**.

---

## 2. Done, applied to production, verified

| What | Evidence |
|---|---|
| 328 clock-reading activity names → real place names | `select count(*) from activities where name ~* '^(morning\|afternoon\|evening\|night\|lunch)'` returns **0** |
| Today's hike named correctly | reads **Seneca Regional Park** (Erica's own correction) |
| 25 junk place names resolved via AllTrails | counties/townships/roads → Valley of Fire, Sky Meadows, Pocahontas, Lost River, Blue Marsh, Mount Erie, Watkins Glen, Morven Park, Prince William Forest Park… |
| Migration `0147` applied | an activity is named after where it happened; a Strava re-sync can no longer restore "Morning Hike" |
| Snapshot before any of it | `supabase/snapshots/2026-08-09-activity-names-before-rename.json` (445 rows) |

Live counts to sanity-check against: **445 activities, 130 distinct names, 0
clock-reading names.**

### The undo, if she ever wants it

The snapshot holds every prior name. Restore with an
`update … from (values …)` keyed on `id`, exactly the shape used to apply the rename.

### Code changed

- `supabase/migrations/0147_an_activity_is_named_after_where_it_happened.sql`
  — `is_generic_activity_name()`, `activity_display_name()`,
  `rename_activities_for_place()`, and one changed line inside
  `import_file_activity` (diffed against the live definition first — the 0137 lesson).
- `supabase/tests/0147_named_after_where_it_happened.test.sql` — 4 blocks, all with
  negative controls. **This test caught a real bug in my own fallback chain**
  (an unplaced activity got "Morning Hike" handed back). Fixed before commit.
- `app/src/lib/importFile.ts` — `activityName()` no longer invents time-of-day names;
  an export-shaped filename now returns `''` so the server names it by place.
- `app/src/lib/importFile.test.ts` — new, 5 tests, including negative controls
  ("Morning Glory Trail" and "Sunday Morning Ramble with Josh" must survive).
- `supabase/functions/_shared/strava.ts` — `name` is no longer a Strava-owned field
  on update; new `isGenericActivityName()` and `usablePlaceName()` (rejects "-",
  storage lots, odor-abatement plants, bare road names).

### Verification status

- `npm run lint` — clean.
- `npm run test` — **69 passing** (64 existing + 5 new).
- SQL test 0147 — passes; fixtures roll back cleanly (verified 0 rows survive).
- `app/src/lib/database.types.ts` — **regenerated** with the new functions.
  ⚠️ Regenerating needs the env: `set -a && . ./.env.local && set +a && npm run gen:types`.
  Forgetting this is what broke CI runs 63–67.

### ✅ Step 0 DONE — the Strava fix is deployed (2026-08-09, 20:10 ET)

`strava-webhook` is now **v20** and `strava-backfill` **v22**, both carrying
`usablePlaceName` / `isGenericActivityName` and the "name is not a Strava-owned
field" rule. **Verified by re-syncing a real activity, not by reading the code:**

- Activity `d3f471f3` is called **"Lake of the Red Rocks"**; Strava still calls it
  **"Evening Walk"** (confirmed in the pre-rename snapshot).
- Fired a genuine `aspect_type:'update'` webhook event for it → `{ok:true,
  outcome:'stored'}`, and the name is **still "Lake of the Red Rocks"** while
  `distance` synced to 2321.3 — so the update really ran and did not no-op.
- Dataset unchanged: 445 activities, 130 distinct names, **0** clock-reading names,
  **0** activities sitting on a place called "New place".

**A latent bug this flushed out, now fixed and deployed.** Both functions called
`admin.rpc('dedupe_shared_outings').catch(() => undefined)`. A Supabase `rpc()`
returns a *thenable*, not a Promise — it has no `.catch()`, and it reports failure in
`error` rather than by throwing. So that line threw a `TypeError` every single time:

- every `strava-webhook` call returned `ok:false` *after* the activity had already
  been ingested, and
- the **last page of every backfill returned a 500**.

The nightly `dedupe-joint-outings` cron (04:20, active) had been covering for it, so
joint-outing dedup was only ever delayed to overnight — no data was lost.

### ⚠️ Still not done

- Work is on `main` via the repo's auto-save hook, not a feature branch, and no PR
  was opened. House style wants a branch + PR.

---

## 2b. Steps 1 and 2 of the rebuild are BUILT (2026-08-09, 20:40 ET)

- **Step 1 — migration `0148`** applied: `suggestions`, `approved_fields`,
  `ingest_runs`, `may_autowrite()`, RLS, and the backfill (61 locked place names +
  12 manual visits = 73 rows; no photo or activity backfill, both deliberate).
  Test `supabase/tests/0148_a_machine_may_only_propose.test.sql`, 7 assertions,
  verified on prod in a rolled-back transaction that left nothing behind.
- **Step 2 — the `suggest` edge function** deployed. Writes ONLY to `suggestions`.
  Pure logic in `_shared/polyline.ts` + `_shared/routescore.ts`, covered by 24
  vitest tests asserting the prototype's recorded output on 13 real routes.
- **Proven live:** "Loudoun County Running" → rank 0 *Washington & Old Dominion
  Trail* (7 of 9), rank 1 the containing regional park (6 of 9), rank 2 the bridle
  trail — and the activity's name did not change. Red Rock and today's Seneca hike
  correctly produce nothing.
- **4 real pending suggestions are sitting in the table right now**, left there on
  purpose so `/inbox` (step 3) has genuine content to render.

Four departures from the written design, each because the design contradicted itself
or reality — all recorded with reasoning in `docs/decisions.md`: a ranked list rather
than a single winner; total tie-breaking; the geocoder fallback only fills a void
(so Red Rock is safe); and "already on one of the right answers = say nothing".

Overpass rate-limits 2 slots PER IP and edge functions share egress, so the suggester
rotates mirrors, hard-aborts at 25s, and stops at a 110s deadline returning a
`remaining` count. Batches are small by design: `limit` defaults to 3, max 8.

## 3. The design that is written but not built

`docs/INGEST-REBUILD.md` — 477 lines, 13 sections. The short version:

- **The rule:** a machine may only propose; a person's decision writes and is permanent.
- **Her edit in the app counts as approval** — she must never confirm the same thing twice.
- **New tables:** `suggestions`, `approved_fields`, `naming_rules`, `ingest_runs`.
- **One guard:** `may_autowrite(subject_type, subject_id, field)`.
- **31 DB functions** write these tables; ~18 are her deciding (write + lock), ~13 are
  machines guessing (must ask). The split is greppable so a test can enforce it.
- **The Inbox = the recent-activities page.** One card, one button, evidence visible
  ("7 of 9 route points"), no icons, real thumbnails, undo.
- Build order is §11. Start at step 1.

### The finding that justifies the whole thing

Route scoring — sample 9 points along the polyline, one Overpass call, score named
trails underfoot vs named parks containing them — **beats both MapTiler and
AllTrails**, and this was measured on 14 real routes, not assumed:

| Was called | Route scoring | Evidence |
|---|---|---|
| Connector | **Potomac Heritage Trail** | trail 7/9; parks Seneca 4, Fraser Preserve 2 |
| Warren County | **Dickey Ridge Trail** | trail 7/9; Shenandoah NP 9/9 |
| Shenandoah County | **Massanutten Trail** | trail 6/9 |
| Clarke County | **Appalachian Trail** | trail 9/9; inside Sky Meadows SP 8/9 |
| Bern Township | **Lake Border Trail** | trail 7/9; Blue Marsh 8/9 |

Three things that fall out of it, which the design must honour:

1. **Trail and park are both true.** Never let the machine pick silently.
2. **Overpass returns nothing for Red Rock / Lake of the Red Rocks — 97 activities.**
   No OSM data exists there. "No suggestion" means *leave it alone*, never blank it.
3. **1 call in 14 returned a 504.** Retry, fall back, fail quietly.

A working prototype of the scorer is at `/tmp/aon/osmname.py` — **`/tmp` is
ephemeral**, so port it into the repo before relying on it.

---

## 4. Open questions for Erica — do not guess these

**a) Trail or park, when both are right?** e.g. "Appalachian Trail" vs "Sky Meadows
State Park". Proposed default: the trail if the route mostly follows one, else the
park, with the other always offered second. She has not answered.

**b) Strava.** A research pass reported that Strava's API Policy effective
1 June 2026 bans retaining data beyond 7 days (§6.2), storing geographic location
(§5.7), and AI use (§5.3). **This is UNVERIFIED against the primary source** and a
research agent was asked to quote the real text. If true it blocks the commercial
build; the fix is bulk export (265 of 445 activities already came that way).
**Nothing about Strava ingest has been changed.** Verify before acting.

---

## 5. Research that was in flight

Four agents were running when this was written; **their results are not in this
document.** Three earlier ones died on a credit limit and were relaunched.

1. Free/open-source components — Transformers.js, CLIP/pgvector, pHash, OCR, FIT/GPX
   parsers, offline sync, Capacitor vs Expo vs PWA.
2. Place/photo/route data sources — Overpass/Nominatim/Overture/PAD-US, whether
   AllTrails has a real API, Google Photos Picker limits, and **verification of the
   Strava policy clauses above**.
3. Commercial mobile + integrations marketplace — store rules for location/photo
   apps, connector architecture, GDPR/CCPA.
4. Approval-queue UX — prior art, one-card vs list triage, confidence display, undo,
   batching, accessibility with no icons.

Two earlier agents **did** complete and their findings are already folded into
`INGEST-REBUILD.md`:
- **ODbL/OSM licensing** — storing OSM *names* is an insubstantial extract, so no
  share-alike and nothing to publish. But the app **must** show
  `© OpenStreetMap contributors` linked to `openstreetmap.org/copyright`, visible
  without interaction. **This is currently missing — a real compliance gap.**
- **Plans & invites** — designed: reuse `visits` with `status='planned'`, plus
  `plan_links` / `plan_rsvps`. Not built.

---

## 6. Still open from earlier, not started

- Recent-activities confirmation surface → **this is now the Inbox**, §8 of the design.
- Phone-photo suggester → §6 of the design. Honest limit: a web app cannot read the
  camera roll; it means the iOS Shortcut + Google Photos until there's a native app.
- Commercial iOS/Android + integrations marketplace → research in flight.
- **Memories redesign** ("On this day X years ago…" with a photo carousel) — Erica
  explicitly asked to **plan the look with her first**. Do not build it unprompted.
- Trip rule — she rejected "outside Virginia = a trip" as pointless. Needs rethinking.
- Google Photos picker — OAuth connects since the CSP fix, but the picker is
  **unproven end to end**; needs her to test it.
- Six road-named places she'd need to identify herself.

---

## 7. Ground rules that must not be relearned

- **NO icons.** Text controls only. Every marker is a photo.
- **Never mass-delete or overwrite without exact-scope confirmation. Snapshot first.**
- **Never reintroduce the home exclusion zone.** Never force-push.
- **Her recorded distances are the truth** — AllTrails and Strava may never overwrite them.
- **Plan first; don't remove things without asking; fix the workflow, not the symptom.**
- Batch changes and deploy once; no rapid deploys.
- Supabase Management API needs a browser-like `User-Agent` or Cloudflare returns 403.
- The service_role key is **already rotated** — never ask her to rotate it again.
