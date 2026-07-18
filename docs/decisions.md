# Decisions log

Short, dated notes on choices made while building. Newest first.

## 2026-07-18 — Phase 1: skeleton, schema, map, invite-only auth

- **Monorepo via npm workspaces.** `app` (Vite + React 18 + TS), `workers/*`
  (Phase 2+), `supabase/` for migrations & Edge Functions. Root scripts proxy to
  the app workspace (`npm run lint/test/build`).
- **Geography stored as generated columns.** Every spatial table keeps plain
  `lat`/`lng` doubles plus a `geom geography(Point,4326)` column
  `GENERATED ALWAYS AS (...) STORED`. The client only reads/writes lat/lng —
  avoids PostGIS wire-format handling in the browser — while spatial jobs
  (clustering, exclusion-zone, mileage) use `geom` with GIST indexes.
- **RLS baseline = "must have a profiles row to read".** Helper functions
  (`is_member`, `is_owner`, `is_editor_or_owner`) are `security definer` to avoid
  policy recursion on `profiles`. Owner-only tables: `settings`, `invites`,
  `ingest_tokens`, `deleted_hashes`. Ingest tables (`location_pings`,
  `activities`) have no client write policy — those paths use the service_role
  key server-side.
- **Invite-only auth.** Public signups are disabled in Supabase Auth. The
  `invite` Edge Function (owner-only) records an `invites` row and emails a link;
  on first login the SPA calls the `claim_invite()` RPC, which promotes a pending
  invite into a `profiles` row with the invited role. The very first owner is
  bootstrapped by hand (`supabase/seed-owner.sql`).
- **Home-exclusion zone lives in `settings`, not code.** Seeded to Leesburg, VA
  (39.1157, -77.5636) at 24140 m (15 statute miles). The client mirrors the
  Haversine math (`app/src/lib/geo.ts`, unit-tested) only to warn before a manual
  "add place" lands inside the zone; the server is authoritative at ingest.
- **Total-miles stat is a hardcoded 0.0 placeholder** with a `TODO(Phase 4)` —
  wired to summed Strava `activities.distance` once Phase 4 lands.
- **Map:** MapLibre GL + MapTiler `streets-v2` style, places as a clustered
  GeoJSON source (cluster + unclustered-point + count layers). Hover popup shows
  name, visit dates, and placeholder photo/route chips.
- **Cloudflare Pages SPA fallback** via `app/public/_redirects` (`/* /index.html
  200`) so deep links and hard reloads route correctly.
- **Auth uses implicit flow, not PKCE.** Magic links (and admin-generated links)
  deliver tokens in the URL hash. PKCE only completes when the link is opened in
  the same browser that requested it (code verifier in localStorage) — brittle
  for a "request on phone, open from email" flow. Implicit consumes the hash
  tokens directly and works cross-device, which suits a private invite-only app.
- **Migration helper functions are defined after their tables.** Postgres
  validates `language sql` function bodies at creation, so the
  `is_member/is_owner/...` helpers that read `public.profiles` must come after the
  `create table` statements (not at the top).

### Phase 1 deployment (done 2026-07-18)
- Migration applied to the live project via the Supabase **Management API query
  endpoint** (`POST /v1/projects/{ref}/database/query`) — no DB password needed,
  just a personal access token. `invite` Edge Function deployed via the CLI.
- Owner (Erica) bootstrapped: auth user + `owner` profile created via the Admin
  API; auth config set (site_url, redirect allow-list, signups disabled).
- Site deployed to **Cloudflare Pages** (`adventureorno`) via `wrangler pages
  deploy` (Direct Upload — env baked at build). Custom domains `adventureorno.com`
  + `www` attached via the Pages API; SSL auto-provisioning.
- Verified end-to-end in a browser on the live stack: magic-link login → owner
  map; place/entry INSERT/UPDATE/DELETE through RLS as the owner JWT; anonymous
  requests return 0 rows across all tables; 20-place world-zoom clustering.
