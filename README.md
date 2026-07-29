# AdventureOrNo

[![CI](https://github.com/adventureorno26/adventureorno.com/actions/workflows/ci.yml/badge.svg)](https://github.com/adventureorno26/adventureorno.com/actions/workflows/ci.yml)

A **private, two-person family memory journal + trip planner** for Erica and Josh.
It maps where they've been, remembers each visit (dates, people, notes, ratings,
photos/videos), and plans upcoming trips. Invite-only; there is no public access
and no commercial/multi-tenant functionality.

> **Scope is fixed and private.** This is not a SaaS. Do not add paid services,
> external-AI calls on private data, or "Spaces"/multi-tenant abstractions. See
> [`CLAUDE.md`](CLAUDE.md) for the working rules.

## People & roles

- **Erica** — `owner` (full control).
- **Josh** — `editor` (create/update/delete household content).
- **Children** — **people records**, not login accounts; selectable as who was on
  a visit, but they don't authenticate.
- **Viewer** — may **read** household-visible, non-draft content and may create/
  update/delete **only their own reactions**. Viewers cannot upload, import,
  create/edit places or visits, or run privileged actions.

## Architecture

- **Frontend:** React 18 + Vite + TypeScript SPA, MapLibre GL for maps. Hosted on
  Cloudflare Pages.
- **Backend:** Supabase — Postgres 15 + PostGIS, Auth, Edge Functions (Deno),
  pg_cron. Every table has Row-Level Security; access requires a `profiles` row.
- **Media:** Cloudflare R2, reached **only** through the `photo-gateway` Worker
  (upload, resize/thumbnail, signed reads). Originals aren't retained; GPS EXIF is
  stripped from stored files (coordinates live in the DB).
- **Maps/geocoding:** MapTiler (domain-restricted key).

## Privacy model

- Invite-only; signups disabled in Supabase Auth.
- RLS on every table; SECURITY DEFINER functions are member-gated and revoked from
  `anon`/`PUBLIC`.
- **AI is disabled by default and local-first.** Private photos, notes,
  coordinates, identifiers, tokens, or signed URLs are never sent to an external
  provider, log, fixture, or telemetry endpoint.
- A home-exclusion zone rejects ingest near the household's home (a privacy rule;
  being made fully data-driven — see the entity/ADR work).

## Domain concepts (canonical model — ADR pending)

- **Place** — a durable real-world destination or legitimate geographic container.
- **Visit** — the canonical dated occurrence of one or more people at a Place.
- **Entry** — a narrative memory that references Visits/Places/Trips (not an
  alternate representation of a Place or Visit).
- **Trip** — a planning + journal container (planned stops, visits, reservations,
  routes, notes).
- **Activity/route** — movement evidence linked to a Visit or Trip.

The precise contract (and the retirement of the legacy `part_of` arrays in favour
of one canonical hierarchy relation) is defined in an ADR under
[`docs/adr/`](docs/adr) — **implement only after that ADR is approved.**

## Repository layout

```
app/                     React SPA (Vite)
app/e2e/                 Playwright acceptance/a11y tests
workers/photo-gateway/   R2 upload / thumbnail / signed reads Worker
supabase/migrations/     Numbered SQL migrations — NEVER edit an applied one
supabase/functions/      Edge Functions (Deno)
scripts/gen-types.mjs    Regenerate app/src/lib/database.types.ts from live schema
docs/                    This documentation set
```

## Setup

1. Node ≥ 20, npm. `npm ci` at the repo root (npm workspaces).
2. Create **`.env.local`** (gitignored — never commit). Use your own values;
   the placeholders below are the full inventory:

   ```sh
   # Client-safe (baked into the build by Vite)
   VITE_SUPABASE_URL=<https://YOUR-PROJECT.supabase.co>
   VITE_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
   VITE_MAPTILER_KEY=<maptiler-key, domain-restricted>
   VITE_PHOTO_GATEWAY_URL=<https://your-photo-gateway.workers.dev>
   VITE_GOOGLE_CLIENT_ID=<google-oauth-client-id>      # Google Photos import
   VITE_STRAVA_CLIENT_ID=<strava-client-id>            # optional
   VITE_MAPBOX_TOKEN=<optional>
   VITE_FOURSQUARE_KEY=<optional>

   # SERVER-ONLY — never expose to the client, never commit
   SUPABASE_SERVICE_ROLE_KEY=<from dashboard>          # bypasses RLS
   SUPABASE_ACCESS_TOKEN=<sbp_... management API>
   CLOUDFLARE_API_TOKEN=<pages/worker deploy>
   GOOGLE_CLIENT_SECRET=<offline OAuth refresh>
   STRAVA_CLIENT_SECRET=<optional>
   STRAVA_VERIFY_TOKEN=<optional>
   # ANTHROPIC_API_KEY is intentionally UNSET — AI stays disabled.
   ```

3. `npm run dev` (in `app/`) to run locally.

## Command matrix

| Purpose | Command | Where |
|---|---|---|
| Typecheck (app) | `npx tsc -b` | `app/` |
| Lint + format check | `npm run lint` | `app/` (eslint + prettier --check) |
| Auto-format | `npm run format` | `app/` |
| Unit tests | `npm run test` | `app/` (vitest, scoped to `src/**/*.test.ts`) |
| E2E + a11y | `npm run e2e` | `app/` (Playwright; authed specs skip without `TEST_BOT_*`) |
| Worker typecheck | `npm run typecheck` | `workers/photo-gateway/` |
| Worker tests | `npm run test` | `workers/photo-gateway/` |
| Production build | `npm run build` | `app/` (`tsc -b && vite build`) |
| Regenerate DB types | `npm run gen:types` | root (`SUPABASE_ACCESS_TOKEN` required) |
| DB migrations (local) | `supabase db reset` on a **disposable** stack | — |

CI runs typecheck, lint, unit tests, production build, Worker typecheck/tests,
Worker dry-run, `db-types-drift`, dependency audit, and the Playwright suite.

## Local acceptance environment

Mutating/authenticated tests run against a **disposable local Supabase stack**
seeded with **fictional** editor + viewer accounts — **never production data or
credentials.** External providers are mocked deterministically. The authenticated
Playwright specs skip cleanly when `TEST_BOT_*`/`VITE_SUPABASE_*` aren't set.

## Deployment (mechanism — run by a human)

- **Frontend:** Cloudflare Pages Direct Upload of `app/dist`
  (`wrangler pages deploy app/dist --project-name adventureorno`). Vite bakes
  `VITE_*` at build time, so **build before deploy**.
- **Worker:** `wrangler deploy` in `workers/photo-gateway/`.
- **Migrations:** applied to Supabase via the CLI/management API against the
  production project — additively, never editing an applied migration.

## Rollback

- **Frontend:** re-deploy the previous known-good `dist` (Pages keeps prior
  deployments; promote an older one).
- **Migrations:** every new migration ships with a reverse/rollback section; apply
  it to undo. Never `DROP` user data.
- **Worker:** `wrangler rollback` to the prior version.

## Backup & restore

Encrypted, zero-budget procedure (uses `age`; destinations you supply) —
[`docs/backup-restore.md`](docs/backup-restore.md). Restores default to a
disposable local stack; production restore is manual with an explicit override.

## Incident response

- **Leaked credential (e.g. a key committed to git):** rotate the credential in
  the provider dashboard **first** (history rewriting cannot revoke an exposed
  key), then follow the history-scrub runbook. A known instance: a `service_role`
  JWT is embedded in migrations `0057`/`0071` — **rotate the Supabase service-role
  key** and treat those migrations in the scrub plan. See
  [`docs/decisions.md`](docs/decisions.md) and the scrub plan (Prompt 11).
- **Suspected data exposure:** revoke sessions, rotate affected keys, take a fresh
  encrypted backup, and reconcile via Data Health.

## Physical-device checklist (manual, no automation)

On a real iPhone (Safari) and Android (Chrome): install to Home Screen; verify
name/icon; rotate; test keyboard + safe-area insets; go offline and confirm the
app shell + queued uploads survive; Web Share Target creates a review draft;
camera/photo selection works; notifications opt-in per category. These can't be
faked in CI.

## Historical docs

The `docs/phases/` briefs and `docs/UNFUCK-PLAN.md` describe the original
build-out and are **archived/deprecated** — see [`docs/archive/`](docs/archive).
This README + `CLAUDE.md` + the ADRs are the current source of truth.
