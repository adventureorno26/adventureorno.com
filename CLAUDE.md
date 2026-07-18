# CLAUDE.md — adventureorno.com

Private travel-map web app for Erica (owner) and her partner (editor). World map of visited
places, auto-built from photo EXIF, passive GPS, and Strava. Invite-only. Domain:
adventureorno.com on Cloudflare Pages. Repo: github.com/adventureorno26/adventureorno.com
(GitHub account: adventureorno26).

## Stack (do not substitute without asking)
- Frontend: React 18 + Vite + TypeScript. MapLibre GL JS for all maps. Deployed to Cloudflare Pages.
- Basemap: MapTiler (key in env `VITE_MAPTILER_KEY`). Geocoding: MapTiler Geocoding API.
- Backend: Supabase — Postgres 15 with PostGIS, Auth, Edge Functions (Deno), pg_cron.
- Photo storage: Cloudflare R2, accessed only through the `photo-gateway` Worker (upload + signed reads).
- Workers: Wrangler-managed, in `/workers`. Edge Functions in `/supabase/functions`.
- Package manager: npm. Lint: eslint + prettier defaults. Tests: vitest for pure logic (EXIF parsing, clustering helpers, exclusion-zone math); no e2e framework.

## Repository layout
```
/app                 React SPA
/workers/photo-gateway   R2 upload, thumbnailing, signed URL reads
/supabase/migrations     SQL migrations (numbered, never edited after merge)
/supabase/functions      ingest-overland, strava-webhook, strava-backfill, invite
/docs                MANUAL-SETUP.md, ios-shortcuts spec, decisions log
```

## Non-negotiable business rules
1. **Home exclusion zone.** Photos and location pings whose coordinates fall within **15 statute
   miles (24.14 km) of Leesburg, VA (39.1157, -77.5636)** are REJECTED at ingest (HTTP 200 with
   `{"skipped":"home_zone"}`, nothing stored). Center + radius live in a `settings` table, not
   hardcoded in logic.
2. **Strava exemption.** Strava activities of type `Hike`, `Walk`, or `Run` are ALWAYS ingested,
   including inside the home zone. All other Strava activity types are ingested only when their
   start point is outside the home zone.
3. **Mileage counter.** The stats bar shows total miles (sum of `activities.distance`, meters →
   miles, 1 decimal) across all stored Strava activities, plus a per-type breakdown on hover/tap.
4. **Photo processing.** Server-side resize so the longest edge ≤ 2400 px (originals are NOT
   retained), plus a 400 px thumbnail. Serve via signed URLs only — no public R2 access. Strip
   GPS EXIF from the stored file; coordinates live only in the DB.
5. **No screenshots.** The upload Worker rejects: any image without GPS EXIF, any PNG, and any
   image whose EXIF lacks a camera make/model. (The iOS Shortcut also filters `Is Screenshot =
   false` and `Has GPS = true` — the Worker is the backstop, not the only gate.)
6. **Deletion is permanent and sticky.** Owner can delete any photo; an editor can delete photos
   they uploaded. Deletion removes the R2 objects and DB row AND inserts the photo's SHA-256
   content hash into `deleted_hashes`. The upload Worker rejects any upload whose hash is in
   `deleted_hashes` — a deleted photo must never reappear via the nightly Shortcut.
7. **Auto-upload is Erica-only.** Exactly one device ingest token exists (Erica's). The partner
   has role `editor`: full manual upload / entry editing rights in the UI, but no ingest token is
   ever issued to him, and there is no UI to create additional device tokens without owner role.
8. **Privacy.** No public routes. Every page requires an authenticated session; every table has
   RLS requiring a `profiles` row. Signups disabled in Supabase Auth — access only via the invite
   flow. Never log photo coordinates or tokens.

## Schema quick reference (authoritative version = migrations)
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
- Actual key values: see `.env.local` (gitignored) — MANUAL-SETUP.md records where each came from.

## Git & GitHub workflow
- Remote: `adventureorno26/adventureorno.com`, authenticated via the local `gh` CLI session
  (account adventureorno26). Verify with `gh auth status` at session start; if unauthenticated,
  stop and ask Erica to run `gh auth login`.
- Work on a branch per phase (`phase-1-skeleton`, …); open a PR with `gh pr create` including a
  summary + acceptance-criteria checklist; Erica reviews and merges. Never push directly to
  main after Phase 1's initial scaffold commit. Never force-push.

## Conventions
- Every phase ends with: migrations applied, `npm run lint && npm run test` clean, deployed
  preview verified, PR opened, and a short entry appended to `/docs/decisions.md`.
- Secrets only via Wrangler secrets / Supabase secrets / `.env.local` (gitignored). Never commit
  keys. `.env.example` lists every var with a comment.
- Small commits with imperative messages.
- When a task requires a human step (dashboard clicks, App Store installs, OAuth approval), stop
  and print the exact steps rather than faking it — MANUAL-SETUP.md tracks these.
