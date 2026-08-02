# Branch, deployment, and dependency reconciliation

Status verified 2026-08-02. This document is descriptive; it does not authorize
merges, deployments, branch deletion, or history rewriting.

## Current source of truth

- Remote `main` is the production source branch at `7e9c6d0`.
- Cloudflare Pages project `adventureorno-com` deployed that commit to production.
- The former `phase-7-globe-fog` work was merged into `main`; the old divergence
  described by earlier versions of this document no longer exists.
- The repository is private.

Production being current does **not** mean it is verified: CI for `7e9c6d0` is
red. Cloudflare deployed the commit independently of the application test result.
Stabilizing and gating that path is completion-plan Phase 1.

## Dependency branches

- Router 7 was merged in PR #19. The first post-merge Playwright run failed its
  catch-all-route assertion because the preview was built without required Vite
  placeholders and could not boot correctly. With valid fictional placeholders,
  `/no-such-page` reaches the `/login` gate on all four Playwright projects. No
  Router 7 regression remains in that focused check.
- `deps/react-19` / PR #18 is open, conflicts with current `main`, and has failing
  checks. Rebase only after Phase 1 is green, then run the full matrix.
- `deps/worker-upgrade` / PR #17 is open, conflicts with current `main`, and has
  failing checks. Rebase and verify separately from frontend upgrades.
- The earlier grouped Dependabot PRs were closed/superseded; do not recreate a
  multi-package mega-upgrade.

## Historical branches

Phase 1–6, Trip deployment, and canonical-backend branches are checkpoints. Do
not delete them until the history-scrub decision is resolved and a verified
encrypted backup exists. Afterward, archive/delete them only through an explicit
housekeeping task.

## Next action

Follow [`COMPLETION-PLAN.md`](COMPLETION-PLAN.md), beginning with Phase 1. Do not
start React 19, the Worker upgrade, optional AI, or history rewriting while the
production commit's CI remains red.

The current uncommitted Phase 1 workspace includes CI/bootstrap corrections and a
forward migration numbered `0120`; none of it is live until it is reviewed,
committed, pushed, checked, and deliberately promoted.
