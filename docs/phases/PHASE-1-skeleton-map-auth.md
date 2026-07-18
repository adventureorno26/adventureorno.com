# Phase 1 — Skeleton, schema, map, invite-only auth

## Objective
A deployed app at adventureorno.com where Erica can log in via invite, see a world map, and
manually create/edit/delete places and entries. The data foundation for every later phase.

## Prerequisites (human, done)
Domain purchased; private repo exists; Supabase project created with signups disabled; MapTiler key.

## Tasks
1. Scaffold monorepo per CLAUDE.md layout. Vite + React + TS app with router: `/` (map),
   `/place/:id` (panel route), `/settings`, `/login`.
2. Migration `0001_init.sql`: all tables from CLAUDE.md schema reference, PostGIS enabled,
   `settings` seeded with home zone (39.1157, -77.5636, 24140 m). RLS on every table:
   SELECT requires a `profiles` row; INSERT/UPDATE/DELETE require role owner/editor per rules;
   `ingest_tokens`, `deleted_hashes`, `settings` writable by owner only.
3. Invite flow: `invite` Edge Function (owner creates invite → Supabase admin API generates a
   magic link email); `/login` accepts magic links; first login creates the `profiles` row with
   the invited role. Seed Erica as owner via a documented one-time SQL snippet.
4. Map view: MapLibre + MapTiler style, full viewport, places as a GeoJSON source with
   cluster/unclustered layers. Hover popup: name, visit dates, photo count placeholder, routes
   chip placeholder. Click → place panel: name (editable), country, dates, entries list with
   add/edit/delete (kinds: restaurant / activity / stay / note; title, markdown body, rating,
   URL, date). "Add place" mode: click map → reverse-geocode suggested name → save.
5. Stats bar component across the top of the map: places count, countries count, states count,
   and a **Total miles** slot hardcoded to 0.0 with a TODO(Phase 4).
6. Deploy: Cloudflare Pages project connected to the repo, custom domains adventureorno.com +
   www, env vars set. Print the exact dashboard clicks for Erica where needed.

## Acceptance criteria
- Visiting adventureorno.com logged-out shows only /login; no data leaks in network tab.
- Erica logs in via invite link; can create a place in Lisbon, add a restaurant entry with a
  rating, edit it, delete it; a second browser with no session sees nothing.
- Map clusters correctly at world zoom with 20 seeded test places; lint + tests pass.

## Out of scope
Photos, ingestion, Strava, partner invite (Phase 5 does roles UI; schema supports it now).
