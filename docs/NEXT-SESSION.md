# Paste this into a new session

Work on adventureorno.com. Read `docs/SCHEMA.md` FIRST — it is the authoritative data
model and it beats every other document. Do not redesign the schema; it was settled on
2026-08-08 (migrations 0129–0137) and re-litigating it is the single thing that has
wasted the most time on this project.

**Deploying.** Production is Cloudflare Pages. Deploy by hand, verify the sha, and end
by telling Erica to hard-refresh (Cmd-Shift-R):

```bash
npm run build && npx wrangler pages deploy app/dist --project-name adventureorno
curl -s "https://adventureorno.com/version.json?cb=$RANDOM"   # must equal git rev-parse HEAD
```

Cache-bust that URL and allow ~1 minute — a fresh deploy does not take over instantly,
and a stale read looks exactly like a failed deploy.

**CI can deploy too, and its `deploy-production` job is NOT hardwired to skip** — the
old brief said it was, which is out of date. `vars.PRODUCTION_DEPLOY_ENABLED` is `true`
and the job gates on `release-gate`, which requires every CI job green. See item 3.

**Verify visually before shipping UI.** Login is Google-only so you cannot drive the
authenticated app. Build, then render the real markup against `app/src/index.css` in a
Playwright harness and screenshot at 390x844. That is how the lightbox, the add sheet
and the place card were checked this session. Do not skip it.

---

## Done on 2026-08-08 (do not redo)

* **Attribution leaks — fixed at the root.** `places.solo_profile` is **dropped**
  (migration 0136). It was null for 129 of 132 places and null meant "show everyone",
  which is why the Army Ten Miler appeared under "Just Josh". The three labels it held
  were carried down onto their visits with `solo_override` first, so no "just me" label
  was lost; exactly two visits changed (Purcellville 2026-03-07, Beaverdam 2025-12-27,
  both Both→Erica). `place_attribution()` derives a place's Who from its visits.
  StatsBar's drill-down uses `place_ids_for_view`, so it agrees with the headline.
  Live: Both 50 / Erica 111 / Josh 55 places; repeat-visit places 14 / 47 / 16.

* **The map visit badge — the previous TWO diagnoses were both wrong.** `visits` was
  never 0 and the layer was never misconfigured. The badge only draws on an
  **unclustered** marker, and `clusterMaxZoom: 12` kept nearly every repeat place inside
  a cluster at the zooms Erica uses. Measured with a Playwright probe over the real 116
  places: DC metro at z10 rendered **1** badge at maxZoom 12 and **4** at 9. Now 9.
  If it ever looks wrong again, measure before theorising — the probe pattern is worth
  rebuilding.

* **The add flow is one sheet** (`AddSheet.tsx`): what are you adding (Photos · A place
  I've been · Somewhere to go later) → where does it belong (nothing, or a trail) → what
  is it (tags). The map's `+ Add` menu, the five-step `/add` wizard and the separate
  "make this a city / region / trail" row are gone; `/add` redirects. Photos and the
  Google Photos import moved into the sheet **before** the button changed. The City and
  Region **tags** now fetch the OSM boundary themselves.

* **Trail cards**: segments are listed once, as Sections (they were also being grouped
  into "Hiking"/"Trail"/"Places"); a container's gallery includes its members' photos
  (`fetchPhotosForPlaceTree`); Sections done/todo follows the current person view.

* **Place card**: evidence nests inside its visit. Brewster is one 2-day visit
  containing a ride and a run, not three rows.

* **Photo viewer**: no "add a caption" link — tap the picture. The reaction marks and
  the date/download row sit against the bottom edge of the photo.

* **`trips` / `trip_stops` are dropped** (migration 0137), with Erica's confirmation,
  along with the `trip` place category, /trips, /trip/:id, /trips/review/:id,
  `lib/trips.ts` and nine trip-only DB functions. `rebuild_place_visits` takes its
  fusing window from `visits.is_trip`; `create_experience` raises on a trip link.
  Snapshots: `supabase/snapshots/2026-08-08-*.json`.

---

## 1. Google Photos still has never connected

`google_tokens` has **zero rows, ever**.

**The old hypothesis is disproven — do not send Erica to the Google console for it.**
Probing Google's authorize endpoint shows `https://adventureorno.com` IS an authorized
JavaScript origin: the GIS `storagerelay://https/adventureorno.com` redirect reaches the
consent screen for the `photospicker.mediaitems.readonly` scope, app name
"Adventureorno". The only registered **redirect URI** is the Supabase auth callback, so
a redirect-based flow WOULD need a console change — the popup flow does not.

Fixed in code this session: connecting is its own tap (a click may open one pop-up and
the flow needed two), the picker window opens before any `await`, `serverToken` reports
a reason instead of swallowing every failure, and the edge function now errors when
Google returns no refresh token or the upsert fails.

**Next step is evidence, not another guess.** Ask Erica to tap Google Photos and send
the exact banner text. The likely one is `google returned no refresh token (consent was
not offline)`, which means Google already has a grant and won't re-issue a refresh
token; the fix for that is for her to remove "Adventureorno" at
myaccount.google.com/permissions once and connect again. Supabase edge-function logs
are empty for this project (`function_edge_logs` returns 0 rows), so the banner is the
only channel — don't burn time on the logs.

## 2. Smaller things

* Activity names are raw Strava strings ("cycling 2018-07-16 19:05") and read badly in
  the nested evidence list on a place card. 0130 stopped auto-naming PLACES; activities
  were never covered.
* The `detect-trips` edge function is still deployed. It creates `suggested=true`
  PLACES, which SCHEMA.md lists under "Retired — do not restore", and the UI that
  reviewed them is gone. It is NOT scheduled (cron has only rebuild-revealed-area,
  dedupe-joint-outings, purge-trash) and there are 0 suggested places right now, so
  nothing is orphaned — but if it is ever wired to a schedule it will create drafts
  nobody can see. Ask Erica before deleting it.
* `trip_notes` (0 rows) and `trip_migration_exceptions` (52 rows) were deliberately
  left alone — outside the scope Erica confirmed. They still export/restore.
* `activity_reactions` was missing from `scripts/export-data.sh`, so the backup never
  covered it since 0135. Added.
* `deleted_at` / soft-delete: `fetchPhotosForPlaceTree` mirrors the existing
  `fetchPhotosForPlace`, which does not filter `deleted_at`. Worth checking whether the
  RLS policy already does.

## 3. The release gate never lets CI deploy

`deploy-production` and the `deploy-probe` diagnostic have **skipped on every green run,
including #44 and #45**, while the gate step logged `event=push ref=refs/heads/main
flag=true`. Per the note in `ci.yml`, both skipping points at the needs/output
expression rather than the `environment: production` binding.

The step now logs the DECISION it published (`-> enabled=...`) and puts it in the step
summary, and trims whitespace off the variable. Read that line on the next green run
before changing anything: if it says `enabled=true` and the deploy still skips, the
problem is `needs['release-gate'].outputs.deploy_enabled` and not the flag.

Everything shipped so far IS in production regardless — hand deploys covered it. Verify
with `git merge-base --is-ancestor <sha> <live sha>`, not by assuming.

## Ground rules that were learned the hard way

1. **A one-shot data fix that a trigger can undo is not a fix.** Remove the mechanism,
   not the rows. `places.solo_profile` and the `trips` tables both lingered for exactly
   this reason: the rows were cleaned, the mechanism stayed, and the next session found
   two models again.
2. **Never let a test pass vacuously.** Seed the real shape, then assert, and add a
   negative control that fails when the rule is removed. See
   `supabase/tests/0136_*.test.sql` and `0137_*.test.sql`.
3. **Never mass-delete or overwrite without exact-scope confirmation from Erica**, and
   snapshot first into `supabase/snapshots/`.
4. Do not reintroduce the home exclusion zone anywhere. Never force-push.
5. Batch changes and deploy ONCE; rapid successive deploys leave half-updated bundles.
6. **Measure before diagnosing.** The visit badge was misdiagnosed twice by reading the
   code. A 40-line Playwright probe with the real data answered it in one run.
