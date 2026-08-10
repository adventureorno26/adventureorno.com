# Branch, deployment, and dependency reconciliation

Status verified 2026-08-08. This document is descriptive; it does not authorize
merges, deployments, branch deletion, or history rewriting.

## Current source of truth

- Remote `main` is the production source branch at `a8123f5`.
- The Cloudflare Pages project is **`adventureorno`**. Deploy only to that project.
  **`adventureorno-com` is an orphan and must never be deployed to.** An earlier
  version of this document named the orphan, and the CI deploy job was pointed at
  it; a deploy would have "succeeded" against a project nobody looks at while the
  real site stayed stale. Both have been corrected.
- Pages is **Direct Upload** (`source: null`), so pushing to GitHub does NOT deploy
  by itself. Something must run `wrangler pages deploy` — CI or a person. This is
  the single most-repeated cause of "it's pushed but the site is old".
- The former `phase-7-globe-fog` work was merged into `main`.
- The repository is private.

CI on `a8123f5` is **green**: build, security, secret-scan, osv-scan, semgrep,
zizmor, db-types-drift, edge-config-drift, e2e, db-tests, release-gate all pass
(`deploy-preview` skips by design off pull requests). The red-CI condition
described by earlier versions of this document is resolved.

`deploy-production` still **skips** on every push despite a green gate; a probe job
was added to `ci.yml` to isolate the cause. Until it is fixed, production deploys
are done by hand with `wrangler pages deploy app/dist --project-name adventureorno`,
and **the deploy must be verified** — compare the `index-*.js` referenced by
`dist/index.html` against what the live site serves. Do not compare against a
directory listing; several `index-*.js` chunks exist and the entry is not
necessarily the first one alphabetically.

Applying a migration without deploying the matching frontend has already produced a
live break (the app ran pre-change code against a post-change DB). Deploy first or
together, never migrations alone.

## Dependency branches

- Router 7 was merged in PR #19. With valid fictional placeholders, `/no-such-page`
  reaches the `/login` gate on all four Playwright projects. No Router 7 regression
  remains in that focused check.
- `deps/react-19` / PR #18 is open and still conflicts with `main`. Phase 1 is now
  green, so this may be rebased and run against the full matrix.
- `deps/worker-upgrade` / PR #17 is open and still conflicts with `main`. Rebase and
  verify separately from frontend upgrades.
- The earlier grouped Dependabot PRs were closed/superseded; do not recreate a
  multi-package mega-upgrade.

## Historical branches

Phase 1–6, Trip deployment, and canonical-backend branches are checkpoints. Do not
delete them until the history-scrub decision is resolved and a verified encrypted
backup exists. Afterward, archive/delete them only through an explicit housekeeping
task.

## Next action

Follow [`COMPLETION-PLAN.md`](COMPLETION-PLAN.md). Phase 1 is complete and green.
The open work is the live-audit findings recorded there, not a new phase.
