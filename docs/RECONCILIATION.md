# Branch & dependency-PR reconciliation (analysis only — no actions taken)

Snapshot at HEAD `90937ce` on branch `phase-7-globe-fog`
(tracks `origin/phase-7-globe-fog`, in sync 0/0). **Nothing below was merged,
rebased, closed, deleted, or pushed.** This is a recommendation for a human.

## Branch state

- **Active branch:** `phase-7-globe-fog` — carries essentially all recent work
  (the UX overhaul, migrations 0092–0095, Playwright, Worker hardening) and is
  what has been deployed to Cloudflare Pages via Direct Upload.
- **`main`** is **not** an ancestor of `phase-7-globe-fog`: the two have
  **diverged**. `main`'s tip (`57e8421` "Stats bar: restore States/Countries
  counts") is not contained in the active branch, and the active branch has a
  large body of commits not in `main`.
- Older `phase-1-skeleton … phase-6-backfill` branches are historical
  checkpoints; per the phase-doc deprecation they can be archived/deleted later,
  but only after confirming `main` (or the active branch) contains their work.
  (Exact ahead/behind counts weren't computed — `git rev-list` is very slow on
  this OneDrive-backed working tree; use a local non-synced clone to measure.)

**Recommended (do not execute here):** open a PR from `phase-7-globe-fog` → `main`,
review, and reconcile so `main` becomes the single source of truth again. Resolve
`main`'s divergent commit (`57e8421`) during that review — confirm whether the
stats-bar fix it contains is already reproduced on the active branch before
discarding either side. Once `main` is current, retire the stale phase branches.

## Open Dependabot PRs (all based on `main`)

| PR | Group | Scope | Recommendation |
|----|-------|-------|----------------|
| **#7** | github_actions | 2 action bumps | Superseded by the CI-hardening work (pinned action SHAs). **Do not merge as-is** — re-create with SHA-pinned, verified actions (see Prompt 8 / rec 52–62). |
| **#8** | photo-gateway (Worker) | 5 updates | Stage as a Worker upgrade with a **regenerated lockfile** and Worker/Miniflare checks before merge. |
| **#9** | app | **13** frontend updates in one PR | **Do not merge as-is.** Split into separate migrations — React, Router, Vite, testing, ESLint/Prettier, MapLibre — running the full check matrix after each family (Prompt 8 / rec 55). |

None of these should be merged, closed, or rebased until (a) `main` is reconciled
with the active branch, and (b) the staged-upgrade plan above is followed. Because
they target `main`, they will likely need rebasing after the branch reconciliation.

## Why this matters for the other prompts

- CI hardening (Prompt 3/8) pins action SHAs → makes PR #7 obsolete.
- Generated-types + build fixes (Prompt 5/8) must pass before the PR #9 mega-bump
  is split and landed, or type drift will hide real breakage.
