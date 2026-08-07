# AdventureOrNo completion plan

Authoritative as of 2026-08-02. This replaces status claims in old phase briefs,
completion summaries, and the historical checklist in `CLAUDE.md`.

## Working rules

1. Start from current remote `main`; record HEAD and `git status`.
2. Preserve unrelated and untracked files. Never edit an applied migration.
3. Use fictional data and a disposable local Supabase stack for tests. Never point
   acceptance tests, reset commands, imports, or repair jobs at production.
4. No push, merge, deployment, hosted setting change, credential rotation, backup
   upload, or history rewrite without the authority appropriate to that action.
5. A phase is complete only when its acceptance criteria and exact check counts
   are recorded. A Cloudflare build alone is not verification.

## Phase 1 — restore a trustworthy delivery pipeline

This phase blocks every other implementation phase.

### Progress on 2026-08-02 (working tree; not deployed)

Completed locally:

- CI uses Node 22 and safe fictional Vite placeholders across build/test jobs;
  missing GitHub secrets no longer replace the public Playwright environment with
  empty strings.
- Invalid SQL UUID fixtures and the JWT-shaped telemetry fixture are removed.
- Router 7's unknown-route behavior passes the login gate on Chrome, Android,
  Safari, and iPhone. No router revert is indicated.
- Migration `0120` closes the remaining editor draft-entry read leak and restores
  service-role-only OAuth-state consumption. All 17 SQL files pass on a clean
  disposable rebuild, and export/restore is byte-identical.
- App tests/typecheck/lint/build, Worker tests/typecheck/dry-run, public Playwright,
  and a clean-tree Gitleaks scan pass locally.

Still required before Phase 1 is complete:

- Seed fictional authenticated users in CI and make canonical `main` fail clearly
  when authenticated acceptance cannot run.
- Implement and pass the mutating acceptance flows below.
- Disable Cloudflare automatic production deployments, then add and prove the
  green-CI promotion gate in [`deploy-cloudflare.md`](deploy-cloudflare.md).
- Push these changes through review and confirm every required hosted check; local
  success does not change what is live.

### Work

- Fix CI placeholder environment scope so typecheck, unit tests, and builds all
  receive syntactically valid client-safe placeholders without production secrets.
- Replace invalid fictional UUID fixtures and the JWT-shaped telemetry fixture.
- Re-test the Router 7 catch-all route after building the Playwright preview with
  valid Vite placeholders; fix or revert Router 7 only if it still fails.
- Seed fictional owner/editor/viewer accounts in the disposable Supabase stack.
  Canonical `main` CI must fail if authenticated acceptance prerequisites are
  absent; fork/public-only behavior may skip with an explicit summary.
- Add mutating acceptance coverage for create, edit, viewer reaction, forbidden
  viewer writes, delete/full Undo, import retry, and upload retry.
- Separate production promotion from Cloudflare's automatic build success. Use a
  workflow/manual promotion that can run only after required CI jobs succeed.
- Keep React 19 and Worker upgrade PRs out until this phase is green.

### Required checks

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
```

Also run the pinned current-tree Gitleaks command from `.github/workflows/ci.yml`.

### Acceptance

- Zero failing required jobs; no required job is skipped because an earlier job
  failed.
- Authenticated/mutating acceptance tests run against disposable fictional data.
- Unknown routes reach the login gate on all four Playwright projects.
- A red CI commit cannot become the production custom-domain deployment.

## Phase 2 — finish the canonical creation cutover

- Route every place/visit creation surface through `create_experience`.
- Remove direct compatibility writes only after tests prove equivalent behavior.
- Complete explicit Trip/Visit/Activity/Entry links and `entry_links`.
- Cover retry after partial failure, two visits at one place, planned-to-completed
  stops, non-login people, import attribution, delete, merge, and Undo.

## Phase 3 — media durability and repair

- Implement the explicit upload/process state machine and server-side operation
  records, compensation, bounded retry, cancellation, and final reconciliation.
- Turn R2/database reconciliation from owner-only dry run into preview/apply/audit/
  Undo workflows.
- Finish Google Photos recovery controls, batch metadata, and similar-photo review.

## Phase 4 — frontend, accessibility, and offline completion

- Finish durable Add/Visit/Entry drafts and Web Share Target review drafts.
- Complete loading/failure/empty/offline/stale/retry states across every route.
- Finish mobile Place sheet behavior, serious Axe findings, Lighthouse PWA checks,
  and the physical iPhone/Android checklist.
- Split oversized modules only behind behavior-preserving tests.

## Phase 5 — security and production operations

- Confirm Supabase service-role key rotation and enable leaked-password protection.
- Resolve or document advisor findings: mutable search paths, extension-owned
  PostGIS warnings, and intended authenticated SECURITY DEFINER RPCs.
- Rerun the approved Strava backfill and restore approved cron/geocode schedules.
- Perform an encrypted backup plus disposable restore drill with R2 object bytes.

## Phase 6 — Data Health and trip-planner completion

- Add evidence-rich repair cards with severity, preview, transactional apply,
  audit trail, truthful partial failure, retry, and Undo.
- Complete Trip assignments, budgets, reservations, packing, saved routes, GPX,
  local `.ics`, reactions, and the privacy-safe notification center.

## Phase 7 — optional local intelligence and large-media work

Only after Phases 1–6: disabled-by-default local semantic search/OCR, resumable
multipart R2 upload, optional local import adapters, and one durable job mechanism.
No private content may leave current infrastructure without explicit opt-in.

## Phase 8 — final verification and owner-gated history scrub

- Produce the recommendation 2–70 evidence matrix and rerun every safe check.
- Verify an encrypted backup and credential rotations first.
- Prepare exact `git-filter-repo` analysis, rewrite, verification, rollback, branch,
  PR, collaborator, and clone-replacement instructions.
- Stop for Erica's exact approval before rewriting refs, expiring reflogs, garbage
  collection, force-pushing, closing PRs, or changing hosted credentials.
