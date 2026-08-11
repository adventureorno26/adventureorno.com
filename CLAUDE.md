# CLAUDE.md — adventureorno.com

> **Read [`docs/STATE.md`](docs/STATE.md) first.** It is the only planning document.

Private travel-map web app for Erica (owner) and her partner (editor). World map of visited
places, auto-built from photo EXIF, passive GPS, and Strava. Invite-only. Domain:
adventureorno.com on Cloudflare Pages. Repo: github.com/adventureorno26/adventureorno.com
(GitHub account: adventureorno26).

## The verification rule (non-negotiable)

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


## Stack (do not substitute without asking)
- Frontend: React 18 + Vite + TypeScript. MapLibre GL JS v5 for all maps. Deployed to Cloudflare Pages.
- Basemap: MapTiler (key in env `VITE_MAPTILER_KEY`). Geocoding: MapTiler Geocoding API.
- Backend: Supabase — Postgres 15 with PostGIS, Auth, Edge Functions (Deno), pg_cron.
- Photo storage: Cloudflare R2, accessed only through the `photo-gateway` Worker (upload + signed reads).
- Workers: Wrangler-managed, in `/workers`. Edge Functions in `/supabase/functions`.
- Package manager: npm. Lint: eslint + prettier. Tests: Vitest, SQL regression tests on a disposable Supabase stack, Worker tests, and Playwright across desktop Chrome/WebKit plus iPhone/Android projects.

## Repository layout
```
/app                 React SPA
/workers/photo-gateway   R2 upload, thumbnailing, signed URL reads
/supabase/migrations     SQL migrations (numbered, never edited after merge)
/supabase/functions      ingest-overland, strava-webhook, strava-backfill, invite
/docs                MANUAL-SETUP.md, ios-shortcuts spec, decisions log
```

## Non-negotiable business rules
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
   image whose EXIF lacks a camera make/model. (The iOS Shortcut also filters `Is Screenshot =
   false` and `Has GPS = true` — the Worker is the backstop, not the only gate.)
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

## Schema quick reference

**The data model is defined in [`docs/SCHEMA.md`](docs/SCHEMA.md) — read that first.**
A place counts once; a visit counts every time; a trip is a visit you marked. There is
no `trips` table and no `trip` place category.

(Table list below; authoritative version = migrations)
`places`, `entries`, `photos`, `location_pings`, `activities`, `trips`, `profiles`, `invites`,
`deleted_hashes`, `settings`, `ingest_tokens` — as defined in `0001_init.sql`. Geometry columns
are `geography(Point,4326)`. Cluster job uses `ST_ClusterDBSCAN` over unassigned photos + pings,
merge radius 10 km, assigning to nearest existing place within 10 km before creating new ones.

## Environment (this project's live services)
- Supabase project URL: `https://aanfyhsjbtnqzphuoiem.supabase.co`
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the `sb_publishable_...` key) are
  client-safe and live in `.env.local` / Pages env vars. The **service_role key is never
  committed, printed, or logged** — Supabase/Wrangler secrets and `.env.local` only.
- `VITE_MAPTILER_KEY` is client-safe; the key is domain-restricted to adventureorno.com +
  localhost in the MapTiler dashboard.
- Actual key values: see `.env.local` (gitignored) — MANUAL-SETUP.md records the
  provider/dashboard source, never the value.

## Git & GitHub workflow
- Remote: `adventureorno26/adventureorno.com`, authenticated via the local `gh` CLI session
  (account adventureorno26). Verify with `gh auth status` at session start; if unauthenticated,
  stop and ask Erica to run `gh auth login`.
- Work on a focused branch; open a PR with a summary and exact verification counts.
  Never merge or promote a production deployment while required CI is red. This
  private repository cannot use GitHub's paid branch protection on the current
  plan, so enforce the gate through the deployment workflow and human review.
- Never force-push. The only exception is the separately approved history-scrub
  procedure, which must stop for Erica's exact approval before any rewrite.

## Conventions
- Every phase ends with: migrations applied, `npm run lint && npm run test` clean, deployed
  preview verified, PR opened, and a short entry appended to `/docs/decisions.md`.
- Secrets only via Wrangler secrets / Supabase secrets / `.env.local` (gitignored). Never commit
  keys. `.env.example` lists every var with a comment.
- Small commits with imperative messages.
- When a task requires a human step (dashboard clicks, App Store installs, OAuth approval), stop
  and print the exact steps rather than faking it — MANUAL-SETUP.md tracks these.

## There is one plan, and this is not it

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
