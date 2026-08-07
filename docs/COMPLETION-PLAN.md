# AdventureOrNo completion plan

Authoritative operational status and execution order as of 2026-08-07. This replaces status claims
in old phase briefs, completion summaries, and the historical checklist in `CLAUDE.md`.

The external `CLAUDE-CODE-INSTRUCTIONS-2-70.md` contains the detailed copy/paste implementation
prompts and recommendation traceability. This file controls current status, phase order, and phase
acceptance. The Claude Code instructions control execution detail only. If the files diverge, update
both in the same documentation change; until then, this completion plan governs status and order.

## Phase 1 continuation status — 2026-08-07 (newest status)

This section supersedes older Phase 1 status statements below; the later phases and their order are
unchanged.

### Completed in the current workspace; not merged or deployed

- Corrected unreleased migration 0121's invalid `name[] = text` preflight comparison. A clean
  disposable rebuild now applies all 121 migrations. Eighteen SQL regression files pass, including
  a new 0121 test for all 14 policies, five function search paths, and the retained primary key.
  Production received equivalent direct SQL earlier, but this migration file was never merged or
  recorded remotely; the correction repairs its failing preflight without changing live behavior.
- Seeded deterministic fictional local owner/editor/viewer users behind a strict localhost guard.
  Canonical E2E now sets `REQUIRE_AUTH_E2E=true`; missing auth configuration fails instead of
  silently skipping. The four-project authenticated fixture works against disposable Supabase.
- Corrected the Settings browser assertion to select the Data section and assert the actual button
  semantics, and removed a double-navigation race from the Add route assertion. A final
  uninterrupted run passed 60/60 across desktop Chrome, desktop WebKit, iPhone, and Android with
  zero authenticated skips. These are still non-destructive flows.
- Canonical DB-types and Edge-config jobs now fail when `SUPABASE_ACCESS_TOKEN` is absent. Only an
  untrusted fork may explicitly skip.
- Added a hard production-dependency audit policy. The only temporary exception is React Router's
  RSC/server-action advisory, which is not exposed by this Vite BrowserRouter SPA; it has an owner,
  rationale, and 2026-09-30 expiry. React Router is pinned to 7.18.2.
- Added a single release gate and an opt-in Cloudflare Pages production job. It builds the exact
  gated SHA, writes build provenance, uploads with that SHA, then checks `/login`, SPA fallback,
  an asset, no wildcard HTML CORS, and the exact live SHA. It is disabled unless the repository
  variable `PRODUCTION_DEPLOY_ENABLED` is exactly `true`.

### Remaining Phase 1 blockers, in priority order

1. Re-run the complete local validation matrix from a clean install after the remaining changes.
   Current evidence includes 60/60 Playwright, byte-identical export/restore, Worker dry-run, the
   production audit policy, Zizmor, 37/37 app unit tests, and 20/20 Worker tests.
2. DONE 2026-08-07 — mutating owner/editor/viewer acceptance now exists (`app/e2e/mutating.spec.ts`),
   hard-gated to a local disposable stack: `getRoleToken` throws on any non-local host, so it can
   never write to household data. Covers create via `create_experience`, idempotent retry (same key →
   same graph, exactly one row), a second visit as a distinct visit, editor create, viewer forbidden
   from the RPC / direct INSERT / UPDATE / DELETE, viewer read + viewer-owned rating, owner
   soft-delete with Undo restoring visits too, anonymous write rejection, and sign-out isolation.
   Authorization is asserted at the API boundary, not by clicking: a UI that merely hides a button
   would pass a click test while the endpoint stayed open.
   Full suite: **132/132 across desktop Chrome, desktop WebKit, iPhone and Android, zero skips**
   (was 60 with 20 authenticated skips).
3. DONE 2026-08-07 — OSV and Semgrep are hard gates; no `|| true` remains in any scanner job.
   - `scripts/check-osv.mjs` fails on any advisory without an unexpired, owned exception in
     `security/osv-exceptions.json`, and distinguishes **production-reachable** findings (resolved
     from `npm ls --omit=dev`) from dev/build-only ones. Current state: 27 advisories, of which
     exactly **1 is production-reachable** (the already-accepted React Router RSC advisory); the
     other 26 are dev/build tooling (undici, vite, esbuild, vitest, sharp, ws, postcss, js-yaml,
     brace-expansion) and expire 2026-11-06.
   - `scripts/check-semgrep.mjs` fails on any finding without an exception, on any scan path that
     does not exist, and on any newly-unparseable file. Two real defects surfaced: the old job
     scanned a phantom `src` directory that does not exist at the repo root, and `MapView.tsx`
     only PARTIALLY parses (Semgrep's TSX grammar trips on `W&OD` in a JSX attribute), so part of
     the largest route file was never actually scanned while the job reported green. Both are now
     recorded rather than hidden. Current state: 0 error / 0 warning / 1 info.
   - Both gates were validated by negative control — each fails when its exception is removed,
     expired, or mis-scoped, and passes when restored.
4. DONE 2026-08-07 — `deploy-preview` deploys the merge candidate to a real Cloudflare Pages
   PREVIEW (any branch other than the production branch `main`, so it can never touch the live
   site) and runs `scripts/smoke-pages.mjs` against the returned URL. `release-gate` now depends on
   it; a skip is accepted only for `deploy-preview` itself (fork PRs and pushes), while a failure or
   cancellation still rejects, and a skip of any other job still rejects. Verified against five
   simulated gate outcomes. The smoke script was also strengthened — it previously checked only the
   CORS wildcard, so a dropped CSP or HSTS would have passed; it now asserts CSP, HSTS, frame
   options, nosniff, referrer policy, permissions policy, COOP, immutable asset caching and
   no-cache HTML, and it passes against live production at `7a3d98eb`.
5. Review and merge the current branch.
   CORRECTED 2026-08-07: the remote ledger *does* record both migrations —
   `supabase_migrations.schema_migrations` contains `20260807153357 / 0120` and
   `20260807153627 / 0121`. The earlier "never recorded remotely" claim was wrong. Note the
   ledger holds only 28 of the 121 migration files (recording began 2026-07-29), which is why
   `supabase db push` must never be used here: it would replay 0001–0093 against live household
   data. Direct SQL only, per `docs/deploy-0096-0101-trips.md`.
6. RESOLVED 2026-08-07 — hosted access restored:
   - All ten CI secrets are now set on the repository (`SUPABASE_ACCESS_TOKEN`,
     `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and the seven client-safe `VITE_*`
     values). Before this the repo had exactly one secret — a disabled legacy
     `SUPABASE_SERVICE_ROLE_KEY` that no workflow referenced; it was deleted.
   - The "Cloudflare account/API-token mismatch" was actually a **project-name** mismatch, and it
     was more dangerous than described. Two Pages projects exist on the account: `adventureorno`
     (serves adventureorno.com / www / adventureorno.pages.dev) and `adventureorno-com` (an orphan
     with no custom domain). `deploy-production` targeted `adventureorno-com`, so enabling
     `PRODUCTION_DEPLOY_ENABLED` would have deployed to the orphan, passed its own smoke check
     against the *old* live site, and reported success while production never changed. The job now
     targets `adventureorno`. The dead `VITE_FOURSQUARE_KEY` reference was removed.
   - Automatic production-branch deployment was never on: the Pages project has `source: null`
     (Direct Upload only), so nothing to disable.
   - `PRODUCTION_DEPLOY_ENABLED` remains unset, per the rule that earlier blockers go green first.
7. Because required branch checks are unavailable for this private repository on its current GitHub
   plan, treat the in-workflow `release-gate` as the production safety boundary. Do not claim that it
   prevents a human from merging red code; it prevents that code from using this deploy job.
8. With separate production authority, deploy one fully green SHA and verify the new smoke job,
   exact `/version.json` SHA, removal of live wildcard HTML CORS, and authenticated production flows.
   No hosted or production mutation is authorized by this document.

## Working rules

1. Start from current remote `main`; record HEAD, branch, ahead/behind, and `git status`.
2. Preserve unrelated and concurrent work. Never edit an old or applied migration.
3. Treat **confirmed live**, **merged to main**, and **completed locally** as different states.
   A commit, screenshot with mocked auth, local green check, or Cloudflare build is not live proof.
4. Use deterministic fictional data and a disposable local Supabase stack for automated acceptance.
   Never point tests, resets, imports, migrations, or repair jobs at production household data.
5. No push, merge, deployment, hosted setting change, credential rotation, backfill, schedule change,
   backup upload, production repair, or history rewrite without the authority appropriate to it.
6. A phase is complete only when its acceptance evidence and exact pass/fail/skip counts are recorded.
7. Phases 2–8 may be planned while Phase 1 is underway, but implementation and promotion must not
   bypass an unfinished earlier safety gate.

## Status snapshot

### Confirmed live

- `https://adventureorno.com` returns HTTP 200 and sends unauthenticated users to `/login`.
- The production login shell rendered correctly at 1440×1000 and 390×844 with no observed console
  errors, page errors, failed requests, blank page, or framework overlay.
- Production serves enforcing CSP, HSTS, frame protection, nosniff, referrer policy,
  Permissions-Policy, and COOP headers.
- ~~HTML also emits `Access-Control-Allow-Origin: *`~~ FIXED 2026-08-07. The `_headers` file used
  the `! Access-Control-Allow-Origin` removal form, which does **not** work on Pages — the platform
  wildcard is applied after `_headers`. Replaced with an explicit
  `Access-Control-Allow-Origin: https://adventureorno.com`; live response verified.
- Authenticated production IS now confirmed live (2026-08-07, via the dedicated `testbot` editor
  account — never Erica's, since a password change drops all her refresh tokens). Verified against
  `https://adventureorno.com`: RLS-scoped reads on places/photos/visits/activities/trips/profiles/
  entries all 200; `data_health`, `place_ids_for_view` and `race_stats` all 200; the authenticated
  map renders with clusters, stats bar and attribution toggle; a leaf place card opens
  (`.map-root.card-open`) with weather, categories and visit rows; photos load through the
  photo-gateway signed-URL path; **zero console errors** on both desktop and iPhone viewports.
  Owner-vs-viewer enforcement is covered by the mutating suite on disposable data (blocker 2), not
  by mutating production.
- FOUND AND FIXED while verifying the above — a real defect that every green build had missed:
  on iPhone the place card's primary action, **"Log a visit", was 91% covered by the floating bottom
  nav**, and `elementFromPoint` at the button's centre returned the Add tab — so tapping the primary
  action navigated to `/add`. `.panel` reserved 40px while the nav occupies 62px. The same shortfall
  hit `.place-rows`, `.places-editor`, `.photo-sorter` and the sticky `.ps-footer`. Replaced the
  scattered magic numbers with one `--pnav-clearance` token and added `app/e2e/nav-obstruction.spec.ts`.
  The regression guard asserts the *invariant* (reserved padding ≥ nav footprint) rather than
  hit-testing alone, because hit-testing passes on a sparse disposable dataset — verified by
  negative control: the guard fails on the old 40px value and passes on the fix.
- ~~The exact production deployment SHA is not confirmed.~~ RESOLVED 2026-08-07.
  GitHub CLI auth is healthy (account `adventureorno26`, active). The audit's real finding was that
  **production was stale**: the live deployment was commit `7100d98a` from 2026-08-01, while
  `origin/main` had advanced to `81c6326`. Because the Pages project is Direct-Upload only, nothing
  had promoted the newer commits. Production now serves `1d2815f3`, confirmed via
  `/version.json`, with `/`, `/login`, `/places`, SPA fallback, and hashed assets all 200.

### Implemented on `origin/main`, not fully proven live end to end

`origin/main` was observed at `7e9c6d0`. Its history contains substantial work from the original
recommendations, including:

- Fictional fixtures, current-tree secret scanning, and removal of the old home-zone behavior.
- The domain ADR, canonical Trip backend/UI, `create_experience`, non-login people, and a partial
  creation-path cutover.
- Major RLS/RPC/OAuth/webhook/HTTP/invitation/Edge-config/hosting/CI security hardening.
- Durable IndexedDB uploads, full visit Undo, NewPlaceDraft visit fixes, reconciliation dry run,
  PhotoSorter/PlacesEditor/soft-delete/trail-route correctness work.
- Coordinate-free Strava support, staged constraints, trigram search, export/restore round trip,
  generated types, import attribution, and backfill resilience.
- Selected-year Wrapped fixes, some stale-response guards, canonical Trip UI and suggested-trip
  review, primary navigation, Settings grouping, responsive/a11y fixes, public layout checks, lazy
  MapLibre, mobile metadata, disabled privacy-safe telemetry, and added Data Health signals.
- React Router 7 is on main. React 19 and Worker family upgrades remain separate and must stay out
  until Phase 1 is trustworthy.

These are implemented-code claims, not proof that the exact commit is deployed or that authenticated
production workflows pass.

### Completed only on the current local phase branch; not live

At the status snapshot, `agent/phase-1-pipeline-docs` was ahead of `origin/main` with commits
`9087164` and `e992149`:

- Node 22 and safe fictional Vite CI placeholders, fixture repairs, Router 7 catch-all verification,
  and updated delivery/backup/reconciliation documentation.
- Migration `0120_fix_draft_entry_and_oauth_permissions.sql` for the remaining editor draft-entry
  leak and service-role-only OAuth-state consumption.
- Migration `0121_advisor_hardening.sql` for selected RLS initplans, function search paths, and a
  duplicate index. It was added after the prior clean database report and must be reverified through
  the full Phase 1 database and authorization suite.

### Verified local baseline on 2026-08-07

- App lint/format passed.
- App unit tests: 37/37 passed across seven library test files.
- App TypeScript and production build passed. The build warned about approximately 1.05 MB MapLibre
  and 1.35 MB HEIC chunks before gzip.
- Photo-gateway typecheck passed; Worker tests: 20/20 passed.
- Playwright: 40 public/login/layout checks passed; **all 20 authenticated checks skipped**.
- `npm audit`: 15 advisories total (1 critical, 10 high, 4 moderate), mainly development/build
  tooling. `npm audit --omit=dev` reported two high React Router package findings tied to RSC mode;
  this SPA does not use RSC, but the exception must be documented and a safe supported version used
  when available.
- SQL/export-restore after migration 0121, Worker dry-run, hosted CI, hosted advisors, authenticated
  production, and physical-device flows were not verified in that audit.

## Phase 1 — Trustworthy delivery, authenticated acceptance, and immediate security blockers

This phase blocks every later implementation and every production promotion.

### Work

- Review local commits `9087164` and `e992149` against current remote `main`; do not assume they are
  deployed or safe merely because they are committed locally.
- Re-test migrations 0120 and 0121 through a clean disposable rebuild, every SQL authorization and
  regression test, generated-type verification, and synthetic export/restore round trip.
- Seed deterministic fictional owner, editor, and viewer identities in disposable Supabase.
- Make canonical-main CI fail clearly if authenticated prerequisites are absent. Public forks may
  skip only with an explicit summary; canonical main requires zero authenticated skips.
- Add mutating acceptance for create/edit, two visits, duplicate handling, viewer-owned reactions,
  forbidden viewer writes, delete/full Undo, import retry, upload retry, and sign-in-boundary
  isolation on desktop Chrome, desktop WebKit, iPhone, and Android.
- Make npm audit, OSV, Semgrep, Zizmor, secret scanning, database checks, build, Worker, and browser
  jobs actionable gates. Missing paths/tools and unreviewed critical/high findings must not create
  false green. Record narrowly justified exceptions with an owner and expiry.
- Add a CI-gated Cloudflare production promotion that rebuilds the exact tested SHA and depends on
  every required job. Prepare—but do not perform without authority—the Cloudflare dashboard change
  that disables automatic production-branch promotion.
- Add preview smoke checks for `/login`, an unknown route, headers, asset loading, and exact SHA.
- Reconcile production headers with version control and remove wildcard HTML CORS unless a concrete,
  tested requirement justifies it.
- Repair GitHub authentication before claiming hosted CI, PR, branch-rule, or deployment status.
- Keep React 19 and Worker upgrades out until this phase is complete.

### Required local checks

```sh
npm ci
npm run lint --workspace app
(cd app && npx tsc -b)
npm run test --workspace app
npm run typecheck --workspace @adventureorno/photo-gateway
npm run test --workspace @adventureorno/photo-gateway
npx wrangler --cwd workers/photo-gateway deploy --dry-run --outdir /tmp/adventureorno-worker-dry
bash scripts/db-test.sh
bash scripts/export-restore-roundtrip.sh
npm run e2e --workspace app
npm audit --json
npm audit --omit=dev --json
```

Also run the pinned current-tree Gitleaks command and every required scanner/config-drift command
from `.github/workflows/ci.yml`.

### Acceptance

- Clean install, lint, formatting, typecheck, build, Worker dry-run, database suite, synthetic
  export/restore, current-tree secret scan, and actionable dependency/security jobs all pass or have
  a narrow documented exception with owner and expiry.
- All authenticated and mutating acceptance tests run on fictional disposable data across all four
  Playwright projects. Canonical main reports zero authenticated skips.
- Migrations 0120 and 0121 have clean preflight/postflight evidence, regression tests, and rollback
  instructions; neither is described as live until deployment is independently confirmed.
- Preview smoke tests prove routing, headers, assets, and exact SHA.
- A deliberately red CI commit cannot reach the production custom domain.
- Hosted checks for the exact merge candidate are confirmed after GitHub authentication is repaired.
- No production or hosted mutation occurs without separate user authority.

## Phase 2 — Finish atomic canonical creation and truthful success behavior

- Route every applicable place, visit, entry, activity, child-place, import, and trip creation path
  through one transactional, idempotent service based on `create_experience`.
- Extend the contract for review, tags, website, attribution, people, Trip/Visit/Activity/Entry links,
  `entry_links`, geographic containment, and planned-stop completion.
- Remove direct compatibility inserts only after parity tests prove equivalent behavior.
- Preserve one operation key across retry and cover partial failure, two visits, non-login people,
  import attribution, merge, delete, and full Undo.
- Eliminate false-success behavior: core data is atomic; media may be visibly pending. Never convert
  failed enrichment/media work to `null` and then display an unconditional “Saved!”.

### Acceptance

- No unapproved direct creation caller remains.
- Retry after every injected failure produces one correct graph without blank or duplicate records.
- UI and API distinguish complete, pending, partial, failed, and retryable outcomes truthfully.

## Phase 3 — Durable media, reconciliation, drafts, and real offline recovery

- Implement server-side media operation records and explicit queued/uploading/stored/processed/
  review-ready/accepted/failed/cancelled/deleting/deleted states with idempotency, compensation,
  bounded retry, cancellation, and final reconciliation.
- Turn R2/database reconciliation into preview/apply/audit/Undo workflows.
- Finish validation, Google Photos recovery, batch metadata, and similar-photo review.
- Restore a versioned scoped service worker. The current app advertises an installable manifest but
  unregisters all service workers and clears caches at startup, so required offline behavior is not
  complete.
- Cache only the public shell and owned versioned static assets—never private HTML/data, Supabase
  responses, media, signed URLs, coordinates, tokens, or map tiles.
- Persist Add/Visit/Entry and Web Share Target review drafts plus upload Blobs in IndexedDB. Prove
  restart recovery, quota failure, sign-out isolation, cancellation, and reconnection.

### Acceptance

- Failure injection leaves no silent R2/database divergence or irrecoverable confirmed media.
- Every pending/failed operation is visible, retryable or safely cancellable, and auditable.
- Offline drafts and uploads recover after browser restart without claiming unsupported iOS
  background execution.

## Phase 4 — Authenticated frontend completion, accessibility, and performance

- Complete a route/state matrix for loading, populated, empty, no-match, partial success, failure,
  stale, offline, retry, unauthorized, and viewer-only states on every authenticated page.
- Replace swallowed important errors and false-success feedback with privacy-safe actionable states.
- Finish mobile Place-sheet, bottom-nav/safe-area/keyboard, map-control, dialog, touch-target,
  reduced-motion, serious Axe, and physical iPhone/Android work.
- Run Axe and overlap/layout tests across authenticated routes and all seven target viewports.
- Add bundle budgets; lazy-load HEIC/video and other optional heavy processors. Confirm login fetches
  neither MapLibre nor HEIC.
- Split oversized CSS, MapView, PlacePanel, Settings, and data modules only behind behavior-preserving
  tests.

### Acceptance

- Authenticated screenshots and assertions cover every required route/state/viewport.
- No critical or unaccepted serious first-party Axe finding remains.
- Primary content/actions are unclipped and unobscured on desktop and physical mobile devices.
- Bundle budgets and login-waterfall assertions pass.

## Phase 5 — Production security, configuration, and recovery operations

- Resolve or document Supabase advisor findings, intended authenticated SECURITY DEFINER RPCs,
  mutable search paths, PostGIS-owned warnings, leaked-password protection, and service-role rotation.
- Synchronize `.env.example`, CI, Pages, Worker bindings, Edge Function secrets, and runbooks; the
  example currently omits part of the code-used variable inventory.
- Restore only approved cron/geocode schedules and rerun only the approved Strava backfill.
- Perform an encrypted database-plus-R2 backup and disposable restore drill with object-byte checksum
  proof.

### Acceptance

- Hosted security/configuration state matches version-controlled intent and has recorded evidence.
- The encrypted backup restores into disposable infrastructure with database and R2 checksums intact.
- Rotations, schedules, backfills, and production repairs occur only with explicit authority and a
  rollback plan.

## Phase 6 — Data Health and trip-planner feature completion

- Finish evidence-rich Data Health repair cards with severity, confidence, preview, transactional
  apply, audit history, truthful partial failure, retry, and Undo.
- Complete Trip assignments, budgets, reservations, packing, saved routes, GPX, local `.ics`,
  reactions, deterministic non-AI summaries, and the privacy-safe in-app notification center.
- Enforce editor writes and viewer-owned reactions in UI and backend.

### Acceptance

- Seeded failures can be discovered, reviewed, repaired, verified, retried, and undone.
- Complete trip-planning flows pass authenticated browser and backend authorization tests.

## Phase 7 — Optional local intelligence and large-media work

Only after Phases 1–6 are complete:

- Disabled-by-default local semantic search/OCR with ordinary-search fallback.
- Optional local import adapters.
- Resumable multipart R2 upload.
- Exactly one durable job mechanism with replay and Data Health integration.

No private content may leave current infrastructure without explicit opt-in. Normal application
behavior must remain complete when every optional feature is disabled.

## Phase 8 — Final evidence and owner-gated history scrub

- Produce the recommendation 2–70 evidence matrix against the exact release SHA.
- Rerun every safe local/hosted preview check, authenticated flow, physical-device checklist,
  encrypted backup/restore proof, and rollback drill.
- List every remaining exception, compatibility path, optional provider, and production approval.
- Prepare exact `git-filter-repo` analysis, verification, rollback, branch/PR/collaborator, credential-
  rotation, and clone-replacement instructions.
- Stop for Erica's exact approval before rewriting refs, expiring reflogs, garbage collecting,
  force-pushing, closing PRs, changing hosted credentials, or replacing collaborators' clones.

### Acceptance

- The evidence matrix has no unsupported “implemented” or “live” claim.
- The release SHA has complete verification and a tested rollback path.
- The history scrub remains a prepared, owner-gated operation until separately approved.
