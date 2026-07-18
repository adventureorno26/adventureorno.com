# Decisions log

Short, dated notes on choices made while building. Newest first.

## 2026-07-18 — Phase 6: backfill the past year

- **Strava backfill reuses the Phase 4 driver** (`/settings → Backfill last 12
  months`) — paginated, paced, idempotent (upsert on strava_id). No new server
  code, just the trailing-365-day run.
- **Photo backfill is the daily Shortcut with a date-range filter**
  (`ios-shortcut-backfill.md`), run month-by-month. The Worker's SHA-256 dedupe
  makes overlapping months and re-runs safe — no duplicates, no resurrected
  deletions (rule #6).
- **Google Timeline import is client-parse + server-write.** The browser handles
  the (large) Takeout JSON — a tolerant parser (`timeline.ts`, 5 unit tests)
  covers the classic `locations[]` (latitudeE7) and the on-device
  `semanticSegments/timelinePath` + visit-anchor shapes — then streams points in
  500-count batches to the owner-only `import-timeline` Edge Function, which
  applies the home-zone backstop and writes `location_pings`. Auth verified live
  (401/invalid session for non-owners).
- **`cluster_now()` = owner-guarded `cluster_unassigned()`** so the import/backfill
  flow can build places immediately (Cluster now → Name new places) instead of
  waiting for the 03:00 cron. Import runs the whole chain (import → cluster →
  geocode) and reports the tallies.
- **Cleanup uses the tools already built:** merge, inline rename, cover photos
  (Phase 3) — auto places wear the badge until touched.

## 2026-07-18 — Phase 5: partner access, trips, PWA polish

- **'viewer' role = just a CHECK-constraint change.** Writes were already gated by
  `is_editor_or_owner()` (excludes viewer) and reads by `is_member()` (any
  profile), so read-only access needed no new policies — only allowing 'viewer'
  in `profiles`/`invites`. Editor/viewer write UI is hidden client-side *and*
  blocked by RLS; owner-only tables (settings, invites, ingest_tokens,
  strava_accounts) are unchanged, so there's still no path for a non-owner to mint
  a device token (rule #7).
- **Revoke = delete the profile.** No profile + no pending invite → `claim_invite`
  fails → the app shows "no access". Auth user can linger harmlessly.
  (Josh/joshforman@gmail.com was provisioned directly as editor at session start;
  the invite UI is the general path.)
- **Trips are computed, not join-tabled.** A place belongs to a trip when its
  `first_visit` is in the trip's date range — one indexed query, no membership
  rows to keep in sync. `trip_stats()` returns places/photos/miles for the range.
- **Photo↔entry linking via a nullable `photos.entry_id`** (ON DELETE SET NULL) —
  a photo keeps its place and optionally points at one entry. The entry card shows
  its photos with an attach/detach picker over the place's gallery.
- **Shell-only service worker.** Network-first for navigations (offline open),
  cache-first for hashed `/assets/`, and it **explicitly ignores cross-origin** —
  so photo bytes (photo-gateway) and Supabase API are never cached. Manifest +
  generated PNG icons make it installable; og:image is a generated branded card,
  never a real photo (privacy). Panel becomes a bottom sheet ≤ 640 px.

## 2026-07-18 — Phase 4: Strava webhooks, routes view, mileage

- **Three Edge Functions, shared logic in `_shared/strava.ts`.** `strava-auth`
  (OAuth callback, `--no-verify-jwt`, upserts tokens), `strava-webhook`
  (`--no-verify-jwt`, GET challenge handshake + POST create/update/delete),
  `strava-backfill` (owner-only, one page/call). All deployed live; the webhook
  handshake is **verified live** (correct verify token echoes the challenge,
  wrong token → 403).
- **Tokens are server-only.** `strava_accounts` has RLS enabled with **no
  policies** (deny-all to clients); only the service_role Edge Functions touch it.
  The SPA learns connection state through the `strava_connected()` SECURITY
  DEFINER RPC — never the tokens themselves.
- **Rule #2 lives in one function** (`shouldIngest`): Hike/Walk/Run always;
  everything else only if the start point is outside the home zone. Used
  identically by the webhook and the backfill.
- **Backfill is client-driven pagination.** Each invocation processes one
  `per_page=100` page and returns `{hasMore, page}`; the SPA loops with a 1.5 s
  gap and a progress line, so we stay under Strava's 100/15 min limit and never
  blow the function wall-clock. 429 surfaces as "wait and resume".
- **New activities in a new area create a place** (`assign_activity_place`,
  30 km) that flows through the Phase 3 geocode/naming pipeline — a hike
  somewhere new proves the visit.
- **Mileage = a security-invoker aggregate view** (`activity_mileage`, one row
  per type). The client reads a handful of rows, animates a count-up to the sum,
  and shows the per-type breakdown on hover — never summing thousands of rows.
- **Routes view** decodes `summary_polyline` with `@mapbox/polyline`, draws one
  colored line per type, fits bounds, and deep-links each to strava.com. Reached
  from the place panel; hover popups now show real 📷/🥾 counts via the
  `place_counts` view.

## 2026-07-18 — Phase 3: Overland ingest + nightly clustering

- **Clustering is one idempotent SQL function** (`cluster_unassigned()`), run
  nightly by pg_cron at 07:00 UTC (≈ 03:00 ET). It re-derives every touched
  place's first/last visit, `visit_count`, and cover photo from *all* its current
  children, so a re-run is a genuine no-op. **Verified live** against the spec
  fixture: 30 photos + 500 pings across 3 cities + Leesburg → exactly 3 places,
  Leesburg's 3 photos + 50 pings excluded, second run created nothing.
- **DBSCAN eps in degrees (~10 km), minpoints = 1.** Cities are far enough apart
  that the small latitude distortion never changes membership; the
  nearest-existing-place attach uses exact `ST_DWithin` geography (10 km).
  minpoints = 1 means pings-only clusters still create places — being there counts.
- **`visit_count` = distinct calendar days with any child.** A deterministic,
  idempotent definition (the spec's ">48 h gap" heuristic isn't re-runnable).
- **Naming is split out** to the `geocode-new-places` Edge Function because SQL
  can't call MapTiler. The job flags new places `needs_geocode`; a second cron at
  07:05 UTC (pg_net → the function, service-role key read from **Vault**, never in
  committed SQL) names them. Reverse-geocode is constrained to
  `types=municipality,place,locality` so places get a city name, not the nearest
  street. Owner can also trigger it from /settings.
- **Edge-function auth by JWT role claim.** `geocode-new-places` runs
  verify_jwt = true; inside, a `service_role` claim = the cron, anything else must
  be an owner. (Comparing the raw service key failed — the injected key ≠ the one
  we send; the signed claim is the reliable signal.)
- **Overland auth reuses the one device token** (rule #7), accepted as
  `Authorization: Bearer` or `?token=` since Overland can't set custom headers.
  `ingest-overland` runs with `--no-verify-jwt` (device token, not a Supabase JWT)
  and drops home-zone + accuracy > 200 m points before insert. **Verified live.**
- **Merge + auto badge.** `merge_places(loser, winner)` (SECURITY DEFINER, editor+)
  moves all children, recomputes the winner, deletes the loser. Clustering-created
  places show an "auto" badge until first edited (editing sets `auto = false`).

## 2026-07-18 — Phase 2: photo pipeline (R2 Worker, gallery, deletion)

- **All photo bytes flow through one Worker** (`workers/photo-gateway`), the only
  path to R2. Three entry points: `/ingest` (device-token auth, Erica's daily
  Shortcut, raw JPEG body), `/upload` (session auth, manual multipart, home-zone
  & screenshot checks become overridable warnings), `/photo/:id?size=` (session
  auth, streams bytes), `/delete/:id` (session auth, permanent + sticky).
- **The ingest gate is one pure function** (`decide.ts::ingestDecision`) fed by
  async checks, so the ordering (deleted → duplicate → no_gps → screenshot →
  home_zone) is unit-tested without R2/DB. Deletion is checked first and can
  never be overridden (rule #6). 11 worker tests + the acceptance "re-upload of a
  deleted photo is rejected".
- **Resize via Photon (WASM)**, not sharp — sharp doesn't run in Workers.
  Re-encoding to JPEG is also how GPS EXIF gets stripped from the stored file;
  coordinates live only in the DB (rule #4). Web ≤ 2400 px, thumb ≤ 400 px.
- **Private reads, no signed URLs / public bucket.** `<img>` can't send a bearer,
  so the client fetches photo bytes with an `Authorization` header and uses an
  object URL (`AuthedImg`). Keeps every read behind a session with zero public
  surface, at the cost of not being CDN-cacheable (fine for a 2-person app).
- **Photo-health = token heartbeat.** The Worker stamps
  `ingest_tokens.last_used_at` on every *authenticated* `/ingest` (even when the
  photo is skipped), so a silently-dying Shortcut shows a stale time. Surfaced to
  the owner via the `last_automated_upload()` SECURITY DEFINER RPC (no token rows
  leak) and a yellow >48 h warning in /settings.
- **One device token, minted server-side** (rule #7). Raw value shown once →
  `.env.local`; only its SHA-256 is stored. No UI to create more.
- **Graceful when unconfigured.** `VITE_PHOTO_GATEWAY_URL` is unset until R2 is
  provisioned; `photosEnabled()` hides the dropzone/gallery/tray so the live site
  keeps working before the human R2 step (`docs/deploy-photo-gateway.md`).
- **Deferred to Phase 3:** unassigned photos are assigned to places manually via
  the map tray (nearest-place default); the nightly clustering job automates this.

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
