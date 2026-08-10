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

## 2026-08-09 — 29 activities moved to where they actually happened

Erica: "There are hikes in Elizabeth Furnace Family Campground that do not belong
there." The old importer snapped an activity to the nearest place within 30 km, so
eight hikes across three counties landed on one campground.

Each activity's real location came from its **route midpoint**, not its start point
— an activity starts in a trailhead car park, which is why geocoding the start
returns SR630, 211 and TR408 while the midpoint returns "Tuscarora–Overall Run
Trail" and "Strickler Knob Trail". AllTrails cross-checked the hikes against the
recorded distance. **Distances were never touched.**

Result: **Elizabeth Furnace 8 hikes → 0.** Activities more than 3 miles from a
non-trail place: 29 → 6, and those 6 are legitimately far (a county place, and the
Tuscarora Trail, which is linear).

Care taken while planning, because a sloppy version of this is worse than the bug:
* names cleaned of map-marker colours ("Strickler Knob Trail (pink)")
* "Strickler Knob" and "Strickler Knob Trail" recognised as one feature
* clustered on the MIDPOINT within 5 km, so two hikes at one trailhead share a
  place instead of making two
* an existing place with the same name is reused (60 km for a county/locality name,
  25 km otherwise) rather than inventing a second "Loudoun"
* a road run that geocodes to a business is not "a place we went" — "Cutt-N-Up" and
  "Oak Grove Baptist Church" fell back to the locality

15 new places created, 132 → 147 (plus one for a new hike that arrived mid-work).

### Every new activity was leaving a place called "New place"

`place_for_activity` inserts new leaf places named literally `New place` with
`needs_geocode`, expecting the nightly geocoder to name them — but that job was
unscheduled in 0130 because sweeping every place overwrote names Erica had given.
So nothing named them. Erica's hike this morning proved it live.

`ingestActivity` now names the ONE place it just created, from the route midpoint,
and only while that place is still called "New place" and unlocked — so it can
never touch a name a person chose. strava-webhook v18 and strava-backfill v20
deployed. This morning's hike is "Camp Fraser".

## 2026-08-09 — Step 0 of the ingest rebuild: a Strava re-sync can no longer rename an activity

`supabase/functions/_shared/strava.ts` had stopped treating `name` as a Strava-owned
field, but the *deployed* functions still did. Until this shipped, a routine sync could
put "Morning Hike" back over a name Erica had approved — and an approval system built on
top of that is built on sand. Deployed `strava-webhook` v20 and `strava-backfill` v22.

Verified by re-syncing a real activity rather than by reading the deployed code: activity
`d3f471f3` reads "Lake of the Red Rocks" while Strava still calls it "Evening Walk"; a
genuine `update` webhook event returned `{ok:true, outcome:'stored'}` and left the name
alone, while `distance` synced to 2321.3 — proving the update ran instead of no-opping.
Dataset after: 445 activities, 130 distinct names, 0 clock-reading names.

**Bug found while proving it.** Both functions called
`admin.rpc('dedupe_shared_outings').catch(() => undefined)`. A Supabase `rpc()` returns a
thenable, not a Promise: there is no `.catch()`, and failures arrive in `error` rather
than as a throw. That line raised a `TypeError` on every call — so every webhook returned
`ok:false` after the ingest had already succeeded, and the final page of every backfill
returned a 500. Replaced with the `{ error }` form and a `console.error`. The nightly
`dedupe-joint-outings` cron had been masking it, so dedup was only ever delayed to
overnight and no data was lost.

Lesson worth keeping: the failure was invisible because it happened *after* the useful
work, and the caller's own error handling swallowed the symptom into a generic
`ok:false`. Deploy-then-exercise-the-real-path caught what reading the diff did not.

## 2026-08-09 — Ingest rebuild steps 1 and 2: the ledger, and the suggester

**Step 1 — `0148_a_machine_may_only_propose`.** `suggestions`, `approved_fields`,
`ingest_runs`, and `may_autowrite()`. Pure addition: nothing reads the guard until step
4, so it shipped the day it was written. Backfilled the locks that already existed in
four inconsistent forms — 61 `name_locked` places and 12 `manual` visits. No photo
backfill (0 of 168 photos carry a `visit_id`, so §9.3 was a no-op) and no activity
backfill, deliberately: the 328 names fixed today were machine-written, so they stay open
to a better suggestion.

`may_autowrite` is SECURITY DEFINER, departing from the design's plain SQL. A guard whose
answer depends on the caller's row visibility is worse than no guard — a caller who
cannot see the lock would be told "yes, go ahead".

**Step 2 — the `suggest` edge function.** Ports `scripts/naming/route_namer.py` to Deno.
The pure parts (`_shared/polyline.ts`, `_shared/routescore.ts`) are plain TypeScript and
are covered by the existing vitest runner via one added include path — there is no local
Deno, and shipping the scorer untested was not acceptable when a silent bug there would
poison every suggestion at once. 24 tests assert the recorded output of the prototype on
13 real routes, from the recorded tallies, so a pass cannot be an Overpass fluke.

Four judgement calls that departed from the written design, each because the design
contradicted itself or reality:

1. **Ranked list, not a winner.** "Appalachian Trail 9/9, inside Sky Meadows 8/9" is one
   hike with two correct names. The prototype had to choose; the Inbox does not, and
   choosing silently is what this rebuild exists to stop. Rank 0 only pre-selects.
2. **Total tie-breaking.** Python's `Counter.most_common` breaks ties by insertion order —
   by whatever order Overpass happened to reply in. That decided a real case (Loudoun:
   W&OD Bridle Trail 9 vs Washington & Old Dominion Trail 9). Ties now break by count,
   then longer name, then alphabetically.
3. **The geocoder fallback only fills a void.** §5.1 says fall back to MapTiler when OSM is
   silent; §5.4 says Red Rock must produce nothing. Those collide, because MapTiler will
   return a nearby town for Red Rock. Resolved by what the fallback is FOR: it runs only
   when the activity has no real name to lose.
4. **Already on one of the right answers = say nothing.** Today's hike is "Seneca Regional
   Park" because Erica corrected it herself, and the scorer ranks Potomac Heritage Trail
   (10 hits) above it (8). Offering to rename her own correction is asking her to decide
   the same thing twice. If the current name is ANY candidate, the question is settled.

**Overpass reality, measured not assumed.** The endpoint rate-limits to 2 slots PER IP and
an edge function egresses from shared Supabase infrastructure, so the first live run drew
four 504s and two 429s. Fixed by rotating independent mirrors (private.coffee answered in
1.0s while the main endpoint 504'd), a 25s hard abort per attempt, and a 110s overall
deadline that returns partial work with a `remaining` count instead of being killed by the
runtime — which is how the second attempt died, losing work it had already done.

**Verified live.** "Loudoun County Running" → rank 0 Washington & Old Dominion Trail
(7 of 9, 0.78), rank 1 the containing regional park (6 of 9), rank 2 the bridle trail.
The activity's name is UNCHANGED, `approved_fields` is untouched at 73, both runs are in
`ingest_runs`, and an identical re-run added no rows (`already_offered: 4`). Red Rock and
the Seneca hike correctly produce nothing.

## 2026-08-09 — When both are true, the PARK wins (Erica's decision)

Asked because "Appalachian Trail 9/9, inside Sky Meadows State Park 8/9" is one hike
with two correct names. Erica: "go with the park." Implemented in `scoreRoute`: a park
clearing 40% of samples takes rank 0; a trail wins only when no park qualifies. This
sets which option is PRE-SELECTED — the trail is always offered at rank 1, one tap away.

A consequence worth having seen: the W&OD now defaults to "Washington & Old Dominion
Trail Regional Park" rather than the trail she actually calls it, and a long
point-to-point on the AT will default to whichever park that particular hike crossed.
Both remain one tap from the right answer, and step 7 (`naming_rules`) is what makes a
per-area preference stick permanently.

## 2026-08-09 — Step 3: the Inbox

Migration `0149`: `approval_undo`, `apply_inbox_field`, `inbox`, `inbox_counts`,
`approve_card`, `reject_suggestion`, `undo_approval`, `clear_approval`. Route `/inbox`,
`app/src/routes/Inbox.tsx`, `app/src/lib/inbox.ts`.

- **approve_card is one transaction.** A stale option raises rather than approving half
  a card — a name written without its lock is the exact state this design prevents.
- **Undo restores the values AND removes the locks.** Either alone is not undo.
- **No `skip_card` RPC.** Skipping writes nothing by definition, so it is client-side;
  the card returns on the next load. An RPC that does nothing is a thing to maintain.
- **`apply_inbox_field` uses an explicit CASE, not dynamic SQL.** The set of fields the
  Inbox may write is small and fixed and worth stating out loud; anything else raises.
  Changing an activity's place rebuilds stats and visits at BOTH ends.
- **The Inbox nav tab appears only when something is waiting.** Six permanent tabs do
  not fit a 320px phone. Settings-side entry still needs adding.
- **Step 8 folded in:** `© OpenStreetMap contributors`, linked, visible without
  interaction, on the screen where OSM names are shown. That compliance gap is closed.

**A real bug caught only by driving it.** The app's global input styling is
`display:block; width:100%`, which is right for text fields and very wrong for a radio:
the dot rendered **238px wide**, collapsed the label beside it to zero width, and pushed
the row off a 320px screen (`scrollWidth` 386 vs 320). Typecheck, lint and unit tests
were all green throughout — only measuring the real page at 320px found it. Fixed by
pinning the radio to 16px.

Verified on the deployed build: the card reads "Loudoun County Running", offers the park
(contains 6 of 9 route points) pre-selected with the trail at rank 1, evidence in words
on every option, "Looks right" / "Skip", nav shows "Inbox 1", no console errors, and no
horizontal overflow at 320px.

## 2026-08-09 — Step 4: the machines go behind the guard

Migration `0150`. Steps 1–3 built the ledger, the suggester and the Inbox; until this,
the rule only bound code that opted in.

**Group 4.1 — person-initiated (write AND lock).** `set_place_name`, `update_activity`,
`reassign_activity`, `set_visit_place`, `set_visit_is_trip`, `set_photo_visit` now call
`record_approval(...)` with `via='edit'`. Her edit in the app IS the approval, so the
Inbox never asks about something she has already decided. One deliberate subtlety:
`update_activity` records an approval only when a NAME was supplied — a type-only fix
("this was a Ride, not a Run") must not silently end all future naming of that activity.

**Group 4.2 — the one that could actually undo an approval.**
`rename_activities_for_place` rewrites every generic name at a place whenever that place
is renamed. Its only protection was `is_generic_activity_name()`, which cannot tell a
name Erica chose from a previous guess. It now also requires
`may_autowrite('activity', a.id, 'name')`.

**The inventory was taken from the LIVE function bodies, not the design's list**, and it
changes the conclusion. The design named ~13 machine functions to guard; on inspection
most cannot overwrite a decision at all:

- `import_file_activity`, `cluster_unassigned`, `ensure_visit` place things that were
  never placed — there is no prior decision to overwrite, and guarding an INSERT is
  meaningless.
- `merge_places` / `merge_places_auto` repoint rows off a place being merged away.
  Refusing per-activity would strand them on a place that no longer exists, which is
  worse than what the guard protects against.

So one function needed the guard, not thirteen. Saying that plainly is better than
mechanically wrapping twelve functions to make a checklist look complete.

**The test is the deliverable.** `supabase/tests/0150_machines_behind_the_guard.test.sql`
reads EVERY function body, splits statements, examines only the part of an `UPDATE`
between `set` and `where` (so a field named in a WHERE clause is not mistaken for a
write), and fails if anything outside a reasoned allowlist writes an Inbox-owned field
with neither an approval nor `may_autowrite`. Every allowlist entry carries its reason.

Two blocks exist to stop the test lying: one plants a deliberately rule-breaking
function and requires the scan to catch it (a test that cannot fail proves nothing), and
one asserts every allowlisted person-initiated function really does call
`record_approval` — otherwise allowlisting them would be an unchecked assumption.

Verified on prod in a rolled-back transaction: 6 blocks pass, `approved_fields` back to
73, 445 activities, 0 clock-reading names, no fixtures or planted functions left behind.

## 2026-08-09 — Step 6, run bounded on purpose

Swept 24 of the 80 weak-named activities ("Loudoun County Running" ×76, plus a few
county/township names) through the scorer. **Bounded deliberately:** sweeping all 80
would have put ~76 cards in Erica's Inbox unannounced, and step 7 (`naming_rules`,
"stop asking after the 3rd identical approval") is the thing that exists to prevent
exactly that. Better to prove the gate on a sample and let her choose.

**Gate met.** 7 cards / 20 options pending. `suggestions` on locked places: **0**.
Suggestions proposing the name the activity already has: **0**. Activities still 445,
0 clock-reading names, `approved_fields` still 73 — nothing was written.

Real improvements found: `Loudoun County Running` → *Washington & Old Dominion Trail* /
*W&OD Railroad Regional Park* (9 of 9 on one route), and one → *Battlefield Parkway
Trail*. 17 produced NOTHING, correctly: suburban neighbourhood runs with no named OSM
trail or park, where the geocoder is deliberately not consulted because the name is not
generic and there is a real name to lose.

**The park-first rule, visible in her own data.** On activity `1f175094` the trail
scores 7 of 9 and the park 5 of 9, and the PARK is still pre-selected with the
higher-scoring trail at rank 1. That is her decision working as specified, and it is
what step 7 will let her flip permanently for a given area.

**Overpass from Supabase egress is genuinely unreliable:** 19 transport failures
(4×429, 5×504, 10 network) across 24 activities even with three mirrors and retries.
Failures cost nothing — nothing is written and the activity is simply re-offered later
— but a full sweep belongs in a nightly job that retries, not a foreground request.

## 2026-08-09 — Step 7: it learns what you call a place

Migration `0151`: `naming_rules`, `rule_offer`, `learn_rule`, `forget_rule`,
`apply_naming_rule`, `naming_rules_list`. The Inbox offers "Always call them that?"
only after the SAME name has been approved for the SAME area **three** times — twice
can be coincidence, three times is a habit.

**The safeguard that makes automation acceptable here.** Applying a rule writes the
name AND an `approved_fields` row (`via='rule'`) AND a `suggestions` row
(`status='approved', source='rule'`) whose label reads "Called it X because you always
do here", carrying the rule id, radius and how many approvals taught it. Silent
automation caused everything this rebuild is fixing; this is automation that shows its
working and can be undone by the ordinary `clear_approval`.

**Her decision outranks her own rule.** `apply_naming_rule` calls `may_autowrite`
first, so a name she chose is never replaced by a rule she made earlier. Tested.

The suggester now checks for a rule BEFORE reaching for Overpass, which both stops the
asking and saves a call on the endpoint that fails most often.

Tests (`0151_...test.sql`, 7 blocks, all with controls): offers on a habit but not a
coincidence; applies and leaves both the lock and the audit row; **does not reach past
its radius**; **does not overwrite a name she chose**; stops offering once learned;
`forget_rule` really forgets; non-members read no rules.

Deliberately NOT done: no rule was created on her data, and no card was approved on her
behalf. Those are her decisions, and the offer only appears once she makes three.

## 2026-08-10 — The nav pill: fit six, and make the highlight mean something

Erica: "the inbox pill is half off the screen and the highlight should be the brighter
blue that was on the add choice previously."

**The highlight.** `.pnav-tab.active` used `--accent-soft` — a 16% wash that was too
faint to read as a selection. It is now the filled `--accent` (#3b82f6) with white
text: the bright fill Add used to carry permanently, moved onto whichever tab you are
actually on.

**The clipping.** Six tabs did not fit, and `overflow-x: auto` on the pill turned that
into a tab cut off at the pill's edge — which is what "half off the screen" was. Tab
padding/font now step down at 470px and 380px so six fit at every width we target;
measured 320-430px with the worst-case label ("Inbox 12"): nothing clipped, no page
overflow.

**The Inbox tab is now permanent.** Hiding it when the queue was empty had a second
bug: `/inbox` then highlighted no tab at all. Only the count comes and goes.

## 2026-08-10 — Step 5: photos from that day

Migration `0153`. All 167 live photos were unpinned. A photo suggestion is just a
suggestion with `subject_type='photo', field='visit_id'`, so it inherits approval,
locking and undo for free — the payoff for building the ledger generically in 0148.

`propose_photos()` matches an unpinned photo to the NEAREST visit whose date range
contains the photo's **local_date**, within 5 km. `local_date`, not `taken_at`: a 9pm
photo must not land on the next day. One proposal per photo — offering the same photo
to three visits is a question with no good answer.

**Photo cards are their own cards** (`group_key = 'visit:<id>'`) rather than being
bolted onto activity cards: a visit is what a photo attaches to, one card can offer a
whole day at once, and activity naming stays untouched. `inbox()` now returns both
shapes, reading the subject from the group_key prefix because a photo card has many
subjects. `approve_card` gained an optional `"photos": [...]` — still one transaction,
one undo token. Unticked photos are **superseded, not rejected**: she passed this time,
she did not say the photo never belongs there.

First run proposed 20 across 12 visits, and the groupings are obviously right:
San Diego 4 (0 m), Cape Cod 3, Paynes Bay 3, Sunset Cliffs 2. Nothing was written —
0 photos pinned, 0 approvals.

**A date bug caught by reading the screen against the database.** The card said
"Monday, July 13" for a visit the database records as **2026-07-14**. A date-only
string parses as UTC midnight, which renders as the previous day west of Greenwich —
the same class of bug migrations 0143/0144 fixed server-side, reintroduced in the
client. `dayLabel` now parses `YYYY-MM-DD` as a local date. Verified against the DB:
Fort Rosecrans 07-14, Cape Cod 08-02, San Diego 07-11 all now read correctly.

## 2026-08-10 — Offline mode, re-enabled safely

The service worker was ripped out once because a cached shell served old code and
blocked updates, leaving the app with no offline mode. Re-enabling it required fixing
the reason it failed, not just turning it back on.

**The old worker cached everything the same way, including index.html.** A stale
index.html points at hashed assets that no longer exist — the white-screen failure.
The new one splits by kind:

- **Navigations / HTML — network first, always.** Cache is only an offline fallback,
  so stale HTML online is impossible.
- **`/assets/<hash>.*` — cache first.** Vite content-hashes these, so a URL's bytes
  can never change; caching them forever is the definition of the file, not a risk.
- **Cross-origin — untouched.** Supabase, the photo gateway and MapTiler are other
  origins, so private photo bytes and authed API responses are never written to a
  cache. Rule #8 holds by construction. **Verified: 0 cross-origin cache entries.**

**A kill switch, because the fear was well earned.** `adventureorno.com/?sw=off`
unregisters the worker, clears every cache, remembers the choice and reloads; `?sw=on`
restores it. The reload matters: clearing caches while the old worker still CONTROLS
the page loses the race — it services a fetch and re-caches it, which left a cache
behind in testing. Verified end to end: 0 registrations, 0 caches, flag dropped.

**The offline message is stall-based, not `navigator.onLine`-based.** With the network
cut, Chromium still reported `onLine === true`; captive portals lie the same way. A 6s
timer measures what actually matters — nothing has arrived — so the message is honest
whether the cause is offline, a portal, or a dead backend. Both loading gates (the auth
check and the lazy-route Suspense fallback) use it.

Verified on production: registered, controlling, caches `aon-shell-v4` / `aon-assets-v4`,
6 nav tabs, no page errors; offline, the shell boots from cache and explains itself.

## 2026-08-10 — The authz matrix, and the two gaps it found

The backlog called this "pgTAP authz matrices". **pgTAP is available (1.3.3) but was
deliberately not installed:** it puts ~200 functions into a PRODUCTION database purely
so a test can say `ok()` instead of `raise exception`, and these tests already run
against production in a rolled-back transaction because there is no local Docker. The
grid is the deliverable; the framework is not.

`supabase/tests/0154_authz_matrix.test.sql` asserts eight invariants: every public
table has RLS; anon holds no table grant; the token tables are service-role only; the
ledger is member-readable and client-unwritable; no table is reachable with zero
policies; a signed-in non-member reads nothing anywhere; a member reads through the
same policies (the negative control, so test 6 cannot pass on empty tables); and no
SECURITY DEFINER function is anon-executable.

**It failed on first run, twice, and both were real.**

1. **`anon` held SELECT/INSERT/UPDATE/DELETE grants on ~35 tables**, including
   `settings`, `ingest_tokens`, `deleted_hashes` and `parks`. No data was exposed —
   every policy is `to public` with an `is_member()` predicate, so anon was refused by
   the predicate. But it left one correctly-written USING clause, forever, as the only
   thing between the anon key (which ships in the client bundle) and the data. 0093
   made exactly this argument for functions and revoked EXECUTE from anon on all 83
   SECDEF ones; tables were never given the same treatment. Now revoked, plus
   `alter default privileges` so the next `create table` cannot silently re-open it.

2. **The ledger was writable by `authenticated` at the grant layer** — and that one was
   mine. 0148/0149/0151 each did `revoke all … from public, anon` then granted SELECT.
   That is not enough: Supabase's DEFAULT PRIVILEGES give `authenticated` its own
   direct grant of ALL, and revoking from PUBLIC does not touch a role's own grant.
   RLS still refused the writes (SELECT policy, no write policy), which is exactly why
   the 0148 test passed — an RLS refusal and a missing grant both raise 42501, and that
   test could not tell them apart. An audit trail should not rest on a single policy.

Two exclusions, both stated in the test rather than hidden: `spatial_ref_sys` (PostGIS
EPSG reference data, not ours to re-grant) and extension-owned functions (PostGIS ships
`st_estimatedextent` as SECDEF and anon-executable; it reads planner statistics for a
table the caller can already see).

Verified afterwards that nothing broke: the login page still renders for anon, and a
member still reads the Inbox (12 cards) and Places (149 rows) with no page errors.

## 2026-08-10 — The accessibility pass, and retiring an allowance

Axe (WCAG 2.0/2.1 A + AA) across /login, /inbox, /timeline, /places and /settings found
exactly one violation, and it was one I had just introduced: the active nav pill.

Erica asked for the bright accent fill on whichever tab you are on. White on `--accent`
(#3b82f6) at 12-13px bold is **3.68:1**, below the 4.5:1 AA requires for text that size,
and axe flagged it as serious on every authenticated page. The nearest passing blue to
hers is #396ef0 at exactly 4.50:1 — too close to the line to rely on — so the pill now
uses a new `--accent-strong` (#2563eb, **5.17:1**). `--accent` is unchanged, so nothing
else in the app shifted; the pill still reads as the same bright blue.

**The allowance is gone.** `e2e/a11y.spec.ts` carried a rule-wide `color-contrast` entry
in ACCEPTED_SERIOUS with a note to "retire it once a run is green without it". A
rule-wide allowance also hides unrelated findings — that same entry would have
swallowed any new contrast bug anywhere in the app, including this one. ACCEPTED_SERIOUS
is now empty, and the comment says an entry may come back only for a decision.

`/inbox` was added to the scanned routes: it is the newest surface and has the most
controls per card — radio groups, a free-text alternative, per-option "Never", and photo
checkboxes. **17/17 pass** (8 routes × 2 viewports, plus the place-row checkbox naming
test) with nothing accepted.

## 2026-08-10 — CI caught four things production testing structurally could not

Runs 75–82 failed on the feature branches. **None of them deploy** — they are
`pull_request` events, and the production job only runs on push to `main` — but the
failures were all real, and one of them was already live because I had been deploying
by hand with `wrangler pages deploy --branch main`, which bypasses CI entirely.

**1. A live UI regression: the nav covered the map's zoom buttons.** Adding the sixth
(Inbox) tab widened the pill until, on a phone, it sat on top of `Zoom in` / `Zoom out`.
`e2e/nav-obstruction.spec.ts` hit-tests rather than trusting `toBeVisible()`, which is
the only reason it was caught — the buttons were visible, just untappable. The pill is
centred and at most 348px, so it can only reach the controls below ~450px of viewport;
`.maplibregl-ctrl-bottom-*` now lifts by `--pnav-clearance` there and desktop is
untouched. 10/10 that spec now passes.

**2–4. Three of my own SQL tests asserted PRODUCTION numbers.** CI applies the
migration chain to an empty disposable database, where "61 locked place names" and
"a member sees more than 0 places" are both wrong — so they passed against prod and
failed in CI, which is the opposite of useful. A test that only holds against one
database is measuring the database, not the code. 0148 now asserts an invariant (every
locked place has a recorded name decision) instead of a count; 0154 creates its own
fixtures for the negative control. 0151 was simply stale: 0152 replaced
`apply_naming_rule(uuid)` with the two-argument form, and the test still called the old
signature — so it also gained a block for the behaviour 0152 exists for (a rule must not
apply when the route disagrees, and silence is not agreement).

Fixing 0148 surfaced one more thing worth writing down: inserting a named place trips a
trigger that sets `name_locked`, so the test's own fixtures were locked-without-approval
by construction. The invariant is about data that predates the transaction, and now
says so.

**The lesson, plainly:** running SQL tests only against production in a rolled-back
transaction is not equivalent to running them against a fresh database, and deploying
by hand is not equivalent to shipping through CI. Both gaps hid real defects.

## 2026-08-10 — Phase 0: one planning document, and the Appalachian Trail

**Six competing "what to do next" documents became one.** ~40 markdown files, ~380 KB,
of which COMPLETION-PLAN (41 KB), CLAUDE-CODE-INSTRUCTIONS-2-70 (58 KB), NewClaude
(52 KB), CLAUDE.md's backlog (29 KB), RESUME-HERE (15 KB) and INGEST-BUILD-PLAN all
claimed to say what to do next. Every session picked a different one, which is the
mechanical reason Erica kept re-asking for the same work.

`docs/STATE.md` is now the only planning document: what the app is, the one model
(place → visits → the day), the single Edit page that absorbs add/import/ingest/sort/
edit/organize/delete/fix, the five remaining phases, a register of things removed **on
purpose** with the commit to restore them, and the facts that must not be relearned.
Everything else moved to `docs/archive/`, whose README says plainly that it is history.
CLAUDE.md now points at STATE.md rather than the archived COMPLETION-PLAN.

**The Appalachian Trail.** Erica: "the appalachian trail no longer exists in Places…
why do segments of it appear?" It was never deleted — `app/src/lib/data.ts:443` filters
out anything with `holds_children`, so every container (AT, Tuscarora, W&OD, trips,
cities) vanished while its sections remained. A stats rule ("containers don't count
twice") had leaked into visibility. Fix is Phase 2.

The card also renders one row per outing, so "Maryland Heights" appears nine times
rather than once with nine dates. Her instruction — section listed once, opening to its
dates, dates opening to the card — is the Sections shape applied everywhere.

**"downtown Leesburg, VA" — approved for deletion, and NOT deleted.** She approved it on
my report that it had 0 activities. That was true but incomplete: it also holds **3
photos and 2 visits**. It is a real place she has been; it simply is not on the
Appalachian Trail. Removed the membership row only, so the trail is correct and nothing
of hers was destroyed. Flagged for her to decide whether the place itself should go.

Decision recorded: **the map goes straight to self-hosted** (Protomaps pmtiles in R2
behind a Worker), not a proxy first. Nobody outside can suspend it, and it is the only
version that scales commercially.

## 2026-08-10 — Phase A at Places: a container is what it holds

**Places lists each container once, holding its sections.** The list was 148 rows,
flat and alphabetical, with the Appalachian Trail sitting between its own sections.
Now a container is a row that opens to its sections, each listed once, and a section
is not repeated at the top level. Nothing is hidden: every place is still in the list,
and searching flattens it so a match can never hide inside a collapsed container.

**A container is a place that HOLDS other places — not one carrying the
`holds_children` flag.** The flag is wrong in both directions: it is set on 15 places
that hold nothing (Reston, Seattle, Cape Cod, Rehoboth Beach…) and unset on Leesburg,
which holds North Street Northeast. Reading the flag was also hiding data — a "rollup"
shows fused visits and no activity rows, so the 8 outings logged on Reston, Seneca
Rocks, Shockey's Knob, Claytor Lake and Virginia Beach were invisible on their own
cards. They are back.

**Sections are listed once and open to their dates.** The trail card poured every
section's outings into one flat list — `fetchActivitiesForPlaceTree` returns the whole
tree — so "Maryland Heights" appeared nine times instead of once with nine dates. A
section now shows its name, its most recent date and a text control reading "9 dates";
opening it gives the dates; a date opens the day card. That is Erica's shape —
container → section → dates → the day — and it now applies to cities, regions and
trips too, not only trails. The same decision retires the second listing: a city's
places appeared under NOTES AND REVIEWS *and* would have appeared here.

**The trail's own 32 days were not being shown at all.** `visitRows` was
`isTrail ? [] : …`, so a trail card listed activities and nothing else — and 32 of the
AT's days are photo days with no Strava activity. A trail is a place you went; the
days you went are its dates.

The rules that decide all of this now live in `app/src/lib/containers.ts` with 11
tests built from the real Appalachian Trail: the container is listed once, sections
nest under it and not beside it, nothing is dropped, a day with a visit and a hike is
ONE date with the hike on it, and a section's list never contains the container's own
outings.

**"downtown Leesburg, VA" was still on the Appalachian Trail** — six days after she
approved removing it. Only the `place_membership` row was deleted, and membership is
not the record: `places.part_of` is, and `sync_membership_from_part_of` rebuilds the
table from the array on the next update of that place. So the card still showed it and
the row would have come back on its own. Migration `0155` removes it from `part_of`,
which removes it from both. The AT now has 6 sections; the place keeps its 3 photos
and 2 visits and is simply a place again.

That is the fourth instance of one fact having two mechanisms and the UI reading the
wrong one — after `part_of` vs the card, `counts_as_place` vs the Places filter, and
the park name vs `places.park`. The pattern is worth naming: when a value is derived,
write the source and read the source.

**Card wording.** "+ Add a place here" and "+ Add existing places" read as the same
button twice, and only one of them adds a place — the first opens the note/review
editor. They now say "+ Write a note or review" and "+ Put a place inside this one".

Also fixed on the way past: `fmtRunDate` was given date-only strings (`first_visit`),
which parse as UTC midnight and render as the previous day west of Greenwich. It now
parses `YYYY-MM-DD` with local components itself.
