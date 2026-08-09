# Decisions log

Short, dated notes on choices made while building. Newest first.

## 2026-07-29 — Removed the home-exclusion zone entirely

The 15-mile "home zone" around Leesburg is **gone**, at Erica's request. Local
outings — photos, GPS pings, and every Strava activity — are now stored and counted
like anywhere else; nothing is dropped or collapsed by location. This supersedes the
earlier "Home-exclusion zone lives in `settings`" and Strava rule-#2 entries below.
- **Migration `0102`** deletes the `home_zone` setting, strips the exclusion filter
  from `cluster_unassigned()`, makes `assign_activity_place()` home-agnostic, and
  dissolves the single "Leesburg" home place — re-scattering its activities to their
  own places so each local run/walk/hike is visible and individually counted.
- Enforcement removed from the client (`geo.ts` `isInHomeZone`/`DEFAULT_HOME_ZONE`,
  `data.ts` `fetch/updateHomeZone`, Settings' Home-zone card), the photo-gateway
  Worker (`getHomeZone`, the `home_zone` skip reason + `inZone` decision), and the
  edge functions (`ingest-overland`, `import-timeline`, shared `strava.ts`
  `shouldIngest`/`HOME_EXEMPT`, and both Strava callers).
- **Stats:** the mileage functions never filtered by home zone, so stored miles were
  always counted; the gap was activities *skipped at ingest* near home. After deploy,
  re-run the Strava backfill to pull in any previously-skipped activities.
- `detect-trips` keeps its own separate 3-mile filter (so neighborhood walks don't
  register as *trips*) — that is trip-detection, not an ingest exclusion, and does not
  drop any data. **Do not reintroduce the home zone anywhere.**

## Architecture Decision Records (ADRs)

- [ADR 0001 — Canonical Place / Visit / Entry / Trip model](adr/0001-place-visit-entry-trip-model.md)
  — **Proposed, DECISION NEEDED.** Makes `place_membership` the single canonical
  hierarchy (retiring `part_of`), defines the one idempotent `addExperience`
  creation contract, and decides whether Trip becomes a first-class entity
  (Option A) or stays a container-Place (Option B). Implement only after approval.

## 2026-07-29 — Migration chain does not replay fresh; schema drift

The historical migrations cannot be applied strictly in-order to a fresh DB, so
`supabase db reset` fails (blocking type generation + CI):
- **`0001_init.sql`** defines `language sql` helpers (`is_member`, …) referencing
  `public.profiles` before it's created → fails unless `check_function_bodies=off`.
- **`0044`** backfills `places.city` from `places.address` — but **no migration
  creates `places.address`** (nor `places.suggested`); both exist in production,
  added out-of-band (**schema drift**).
- Interim fix: **`scripts/db-bootstrap.sh`** builds a disposable local DB by
  applying the chain in one session with body-checks off (tolerating the one benign
  0044 error); **`0098`** reconciles the two drifted `places` columns (idempotent —
  no-op in prod). Verified: bootstrapped `places` = 39 cols, matching production.
- **Only the `places` table was drift-audited.** A full drift audit of all tables
  + the proper long-term fix (a squashed re-baseline so `db reset` works, done with
  Erica's approval) is Prompt 8 / Prompt 11 scope. Old migrations are never edited.

## 2026-07-29 — Local cron could POST to production; disposable-DB isolation

Standing up a local Supabase stack applied `0057`/`0071`, which `cron.schedule` a
`net.http_post` to the **production** URL with the hardcoded **production
service_role key**. So the disposable dev DB was scheduled to call production on a
timer (`geocode-new-places-nightly`, hourly geocode).
- Remediation: **unscheduled all 6 local pg_cron jobs** (nothing fires now), and
  rewrote `scripts/db-bootstrap.sh` to be **confirmation-gated**, **network-isolated**
  (unschedules cron immediately after apply so no scheduled prod HTTP can fire),
  **strict** (fails on any unexpected error; only the known 0044 backfill tolerated),
  keeps its error log, and verifies 12 core tables before reporting success.
- **Owner action — DONE (2026-07-30): the exposed service_role key was ROTATED by
  Erica.** Do not re-flag this. (History scrub to remove the old blob is separate —
  Prompt 11 — and does not require re-rotation.)

## 2026-07-29 — DOCUMENTED EXCEPTION: sanitizing applied migrations 0057 & 0071

`0057_geocode_cron.sql` and `0071_geocode_hourly.sql` embedded a live service_role
JWT (see below). They were edited **in place** to remove it and instead source the
key from `vault.decrypted_secrets` (name `aon_edge_secret_key`, provisioned out of
band). This is a **deliberate, documented exception** to the standing rule "never
edit an applied migration," justified solely by the credential exposure — it is the
ONLY sanctioned edit of an old migration.
- **The revoked JWT must never be reintroduced** to any file, fixture, log, or test.
- The disposable-DB bootstrap is network-isolated (unschedules cron), so these
  migrations' `net.http_post` can never fire from a dev/CI database.
- The exposed key was **ROTATED by Erica (2026-07-30)** — resolved.

## 2026-07-29 — Security incident: service_role key in migrations

- Migrations `0057_geocode_cron.sql` / `0071_geocode_hourly.sql` embed a hardcoded
  Supabase **service_role JWT** (full RLS bypass). It is in git history and the
  current tree. **The service-role key was ROTATED by Erica (2026-07-30) — resolved.**
  Removal of the old blob from history is the deferred scrub phase (Prompt 11); old
  migrations must not be edited. See `README.md` → Incident response.

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

## Prompt 2B — unified creation service + non-login people (2026-07-31)

- **`create_experience(key, place, visit)` RPC (migration 0111)** is the ONE
  transactional + idempotent creation path. A PL/pgSQL body is a single
  transaction, so place+visit+attribution+rating+people commit together or not at
  all — no half-built records. Idempotency is a client-supplied key recorded in
  `experience_requests`; concurrent same-key calls are serialized with a per-key
  `pg_advisory_xact_lock`, so a retry after a partial failure returns the SAME
  ids instead of duplicating. Rating delegates to `set_my_rating` (per-user
  `place_ratings` + owner mirror) rather than a blind `places.rating` write; a
  new visit calls `promote_trip_stops_for_place` so a planned trip stop in-window
  flips to completed. `is_trip` is a GENERATED column — never inserted (this also
  fixed a latent runtime crash in `restoreVisit`/visit-Undo).
- **Non-login people (migration 0110):** `people` + `visit_people` + `trip_people`.
  Children/companions are records, not auth accounts (owner=Erica, editor=Josh,
  viewers reaction-only). Member-read, editor/owner-write RLS; accessed directly
  via PostgREST.
- **Frontend:** `addExperience`/`newExperienceKey` + people helpers in `data.ts`.
  AddWizard and NewPlaceDraft save through `addExperience` with one idempotency
  key per action (reused on retry, reset on success); AddWizard gained a "Kids
  along" picker. Place-level `setPlaceSolo`, `website`, `review`, and additive tag
  merges remain compatibility enrichments the RPC doesn't own. PlacePanel's
  "log a visit" (submitVisit) also goes through addExperience now.
- **What deliberately does NOT use create_experience** (they aren't experience-
  logging): MapView's empty-container quick-add (blank name, `saved:false` — the
  RPC forbids blank names); MapView's trail fallback inside route-drawing
  (activity placement); DayView `moveToNew` (creates a place to *reassign an
  activity* to — the activity is the visit); PlacePanel `addSpot` (creates a
  CHILD place with `part_of` hierarchy the RPC doesn't model). These keep their
  specialized helpers by design. Bulk import remains the one genuine convergence
  debt (kept on the older path for now).

## 2026-08-07 — Phase 1 completion, Phase 2 creation convergence, and delivery gates

**SUPERSEDES the "What deliberately does NOT use create_experience" note above.**
All five of those exceptions now DO use it. Migration `0122` extended the RPC's
place contract with the fields they actually needed — `is_trail`, `bucket`,
`needs_geocode`, `website`, `auto`, `part_of[]`, `review` — plus an explicit
`allow_unnamed` opt-in for the map's blank-name placeholder draft. The blank-name
guard stays ON by default for every other caller, so the protection the old note
cited is preserved rather than removed. `part_of` now goes through the RPC, so the
child-place hierarchy IS modelled. Because the RPC performs the same INSERT, the
existing triggers (`sync_place_category`, `sync_membership_from_part_of`,
`neutralize_junk_place`, `set_place_park`) fire identically.

- **All nine client call sites** moved from `createPlace` to `createPlaceAtomic`.
  `PlacePanel.addSpot` collapsed from THREE writes (create, then updatePlace for
  rating/review, then addVisit) to one — previously a mid-sequence failure left a
  spot with no review and no visit, and a retry created a second place.
  `createPlace` is deprecated with zero callers and an eslint
  `no-restricted-imports` rule prevents its return.
- **Truthful success.** The Add wizard mapped every failed photo upload to `null`
  and then showed an unconditional "Saved!", so a save where every photo failed
  looked identical to a complete success. Media stays outside the atomic core on
  purpose — a failed upload must not roll back a correctly saved visit — but the
  outcome is now counted and reported via a pure, unit-tested
  `saveOutcomeMessage()`. Three more silent failures fixed: visit-delete Undo
  (which left the visit deleted while the user believed it was restored),
  PlaceQuickEdit rename/retag/rate and who-went, and BucketMap add.
- **`0123`** revoked `anon`/`authenticated` table grants on `google_tokens` and
  `strava_accounts`. RLS already denied all client access, but the grants would
  have become live the moment anyone added a permissive policy — and those tables
  hold Google and Strava refresh tokens. `oauth_states` was already locked down in
  `0120`; these two were missed.

**Delivery gates.** OSV and Semgrep ran with `|| true` and therefore could never
fail. Both are now hard gates with owner/reason/expiry exception files. Semgrep was
additionally scanning a `src` directory that does not exist at the repo root, and
`MapView.tsx` only partially parses, so the largest route file was never fully
scanned while the job reported green — both now recorded rather than hidden. A new
`deploy-preview` job deploys the merge candidate to a real Pages preview and smokes
it; `release-gate` depends on it.

**Bugs that only driving the app could find.** On iPhone the place card's primary
action, "Log a visit", was 91% covered by the floating bottom nav — `elementFromPoint`
at its centre returned the Add tab, so tapping it navigated to `/add`. The build was
green and the button passed `toBeVisible()`. A live audit found the same defect on
five more routes, including `/health`'s GPX/KML/CSV export buttons. Root cause: 14
route files each repeated the same inline page wrapper reserving zero bottom space,
and because the padding was inline it beat any stylesheet rule. They now share a
`.page` class carrying `--pnav-clearance`. `scripts/audit-live.mjs` makes that sweep
repeatable.

**Accessibility.** Axe only covered `/login` and `/add`, hiding the app's largest
defect: every row checkbox on `/places` was unlabelled (183 rows, 366 nodes),
announced as a bare "checkbox" while driving a bulk, destructive tag/untag.

**Testing note worth keeping.** Two guards written this session were initially
VACUOUS — they passed with the bug present. A hit-test-only nav check passed on the
sparse disposable dataset because the card never grew tall enough to reach the nav;
and an authenticated bundle measurement reported "no heavy chunks" when an expired
token had silently redirected every route to `/login`. Both were caught by running a
negative control. **Assert the invariant, not just the symptom, and always verify a
new gate fails when the thing it guards is broken.**

## 2026-08-08 — Place-model corrections, Slice 1: stop the nightly trip duplication

Erica reported four symptoms; all trace to three causes, and **none is covered by
any COMPLETION-PLAN phase** (Phase 6 covers trip *planning* features, not visit
derivation or the counting model). The authoritative spec, `NewClaude.md`, is
TRUNCATED — §2–§6, exactly the visit/revisit and trip sections, are collapsed into
a literal "108 lines hidden" marker — so the answers cannot be looked up.

**Approved model decisions (Erica, 2026-08-08):**
- The map badge counts **visits, not days**.
- Stays separated by **≤2 days** fuse into one visit. Cape Cod Aug 2–7 (no photos
  Aug 4) becomes ONE visit; returning next year is a SECOND visit on the SAME
  place — "count the place once, count the visits every time".
- Cape Cod becomes a **destination (region)** that counts once and holds its
  children, rather than a rollup `category='trip'` that counts zero. This matches
  the spec's own rule: *"A city is both a place you visited AND a box that holds
  other places."* Only trails and trips are non-counting rollups.
- Delete the duplicate suggestions; retire the legacy trip system.

**Slice 1 — done.** `detect-trips` re-created the same drafts nightly since
2026-07-21: 54 rows for 4 destinations. It documents itself as idempotent, but the
guard reads `places.first_visit`, which it never populates (it inserts a `visits`
row without triggering the recompute), so **all 54 rows had first_visit NULL**, the
candidate range list came back empty, and the overlap check could never match.
Dismissing was futile too: `resolveSuggestedTrip(id,false)` DELETES the row and
records nothing, so the next run recreated it.

`detect-trips-nightly` is now **unscheduled** rather than patched, because the
legacy `places.category='trip'` system it feeds is being retired and the function
must be rewritten against the canonical `trips` table. Restore SQL:

```sql
select cron.schedule('detect-trips-nightly', '30 7 * * *', $$
  select net.http_post(
    url:='https://aanfyhsjbtnqzphuoiem.supabase.co/functions/v1/detect-trips',
    headers:=jsonb_build_object('Content-Type','application/json','apikey',
             (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')),
    body:='{}'::jsonb) $$);
```

Do NOT restore it before the rewrite, or the duplicates return.

Cleanup was verified safe before executing: 0 photos / activities / entries /
videos / trip_stops referenced the 54 rows, and every real place referencing them
keeps its own visits. Removed 54 places, 496 junk membership links, 126 derived
container visits. places 186→132, visits 571→445, memberships 510→14; **photos 168
and activities 444 unchanged**. 24 real places became top-level — intended. Also
fixed 7 pre-existing dangling `part_of` references (that parent id was NOT among
the 54; it had been deleted long before). Zero dangling references remain.

Raw snapshot (gitignored — contains exact coordinates):
`supabase/snapshots/2026-08-08-suggested-trip-cleanup/`.

**A per-view defect found while planning Slice 3.** `visit_count` is global and not
person-aware, so the badge is identical in Just Erica / Just Josh / Both. Potomac
Station shows **67** in Erica's view though all 39 of its visits are Josh's; Lake of
the Red Rocks shows **52** in Josh's view with zero Josh visits. Slice 3 therefore
needs a per-person `place_visit_counts(p_profile)` RPC, mirroring the existing
`settings_stats(p_profile)` / `race_stats(p_profile)` pattern — not a single column.

---

## 2026-08-08 — One outing counts once (migrations 0140–0142)

Erica's 2026-03-07 Purcellville run was stored **three times**: her Strava record
(45.1 mi), a file import of the same run (44.9), and Josh's record of the outing they
did together (44.7). The headline mileage counted all three — **134.7 miles for one
45-mile run**.

Duplicates are **grouped** on `shared_group_id`, never deleted. Every record survives
and ungrouping restores the previous totals.

**`dedupe_joint_outings` was deleting activities nightly.** It ran at 04:20 with
`delete from public.activities`, against Erica's standing rule that nothing
mass-deletes her data. It never caught this run — it only compared owner vs
non-owner and required both starts within 800 m — and was blind to same-person
duplicates entirely. Same name (the cron entry still works); it groups now.

**`wander_stats` was the only stat that didn't dedupe.** `mileage_by_person`,
`settings_stats` and `wrapped_year_miles` all did. That asymmetry is why the map's
headline total disagreed with its own per-type breakdown.

Automatic rule is deliberately tight — same type, within 20 minutes, distance within
10% — and matched only the March 7 triple. Everything looser went to Erica.

Merged with her approval: 2018-08-01 W · 2018-08-13 W · 2020-05-12 R · 2022-12-04 H ·
2023-05-24 R · 2023-05-30 R · 2023-08-01 R · 2023-08-02 R · 2025-10-04 R.
Result: Erica 2064.8 → 1950.5 mi, Josh 1048.0 → 986.3, Both 474.9 → 430.2. 444
activities before and after.

### DATES ARE BUCKETED IN UTC — open, and it bit twice here

`start_date::date` is UTC, so any evening outing after ~20:00 ET (17:00 PT) is filed
on the **next day**. 12 activities are currently on the wrong calendar day.

* Erica: "on the 13th I only did a 4.1 and 4.7 walk — where did the other come from?"
  She was right. The 4.35 mi "San Diego walkabout" started 00:25 UTC = **17:25 local
  on 12 July**. Not a third walk on the 13th.
* She approved merging the 2024-09-03 pair; its "Evening Walk" was 00:04 UTC =
  **2 September** local. Two real walks, two different days — excluded and flagged
  back to her rather than merged on stale facts.
* It also **hid** a real duplicate: the 2018-08-13 walk crossed midnight UTC, so its
  two records sat on different days and at two different places ("Lake of the Red
  Rocks" and "Red Rock Regional Park").

Strava sends `start_date_local` and we never stored it. This drives which visit an
activity belongs to, the day view, and duplicate detection in both directions.

Snapshots are gitignored (they contain exact coordinates):
`supabase/snapshots/2026-08-08-activities-pre-dedupe.json` and
`supabase/snapshots/2026-08-08-approved-activity-merges.md`, both local only.

## 2026-08-09 — Places know where they are, and stop being named after roads

**State/country** filled on all 36 places that lacked one, by reverse geocoding —
Erica approved this explicitly and asked that the NAME be left alone, so the update
touches `admin1`/`country` only and `coalesce` means an existing value always wins.
3 remain without a state and that is correct: Florida (resolves by longitude) and
two Barbados places (by country).

Local times were then recomputed, because `local_zone()` prefers a known state over
a longitude band — Utah is west of −112.5 but Mountain, Nevada is east of −114 but
Pacific.

**Addresses** on 90 of the 91 places that had none. Erica: "I DO want the address of
the trailhead added so I can find it easily." This is what the Directions button
reads, which is why it so rarely appeared. MapTiler prefixes `-, ` when there is no
house number; that is stripped.

**Renames.** The old geocoder named places after the street at the activity's start
point — a hike begins in a trailhead parking lot, so 14 places were called things
like Freedom Drive and Old Rag Fire Road. Renamed only where the evidence is clear,
and only where `not name_locked`, so the 60 names Erica gave are untouched:

| was | now | evidence |
|---|---|---|
| Old Rag Fire Road | Old Rag Mountain | AllTrails: 5.1 mi hike vs 5.6 mi trail, Shenandoah NP |
| Edwards Ferry Rd | Red Rock Wilderness Overlook | AllTrails: 1.0 vs 1.1 mi, 0.28 mi from trailhead |
| Freedom Drive | Reston Town Center | POI at the coordinates, 12 runs |
| Exchange Street | One Loudoun | POI, 3 runs |
| Browns Chapel Road | Brown's Park | POI, Lake Anne Village |
| Water Vista Drive | Brambleton Community Park West | POI |
| Jefferson Drive Southwest | National Mall | Smithsonian grounds, 3 runs |

**Left alone on purpose** — no confident answer, and a wrong rename on a place with
a dozen visits is worse than a bad one: Riverpoint Drive (19.5 mi longest, probably
W&OD), Isaac Newton Square, Fairway Drive, North Courthouse Road (geocodes to a
Subway), N Moore Street, North Street Northeast, Broadlands.

Renames deliberately do NOT set `name_locked` — that flag means "a person chose
this". These are machine suggestions Erica can overwrite freely.

**Method note.** Plain reverse geocoding on an activity's START point returns the
road: SR630, 211, TR408. The route MIDPOINT lands on the trail instead
("Tuscarora–Overall Run Trail", "Strickler Knob Trail"), and AllTrails on that
midpoint, cross-checked against the recorded distance, is better still. AllTrails
has no public API, so the app itself cannot call it; OSM covers trailheads for
everyone with no account.

Snapshots (gitignored): `2026-08-09-place-names-pre-rename.json`,
`2026-08-09-visits-pre-rebuild.json`.
