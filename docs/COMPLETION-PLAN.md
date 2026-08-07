# AdventureOrNo completion plan

Authoritative operational status and execution order as of 2026-08-07. This replaces status claims
in old phase briefs, completion summaries, and the historical checklist in `CLAUDE.md`.

The external `CLAUDE-CODE-INSTRUCTIONS-2-70.md` contains the detailed copy/paste implementation
prompts and recommendation traceability. This file controls current status, phase order, and phase
acceptance. The Claude Code instructions control execution detail only. If the files diverge, update
both in the same documentation change; until then, this completion plan governs status and order.

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
- HTML also emits `Access-Control-Allow-Origin: *`; this conflicts with the intended no-wildcard-
  HTML-CORS policy and remains a Phase 1 review/fix.
- Authenticated production routes and role enforcement are **not confirmed live** because no
  authorized production test account was used.
- The exact production deployment SHA is **not confirmed**. Local GitHub CLI credentials were
  invalid during the audit, preventing inspection of hosted Actions, PR, branch-rule, and deployment
  state.

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
