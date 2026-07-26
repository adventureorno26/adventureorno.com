# CLAUDE.md — adventureorno.com

Private travel-map web app for Erica (owner) and her partner (editor). World map of visited
places, auto-built from photo EXIF, passive GPS, and Strava. Invite-only. Domain:
adventureorno.com on Cloudflare Pages. Repo: github.com/adventureorno26/adventureorno.com
(GitHub account: adventureorno26).

## Stack (do not substitute without asking)
- Frontend: React 18 + Vite + TypeScript. MapLibre GL JS v5 for all maps. Deployed to Cloudflare Pages.
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

## Backlog / TODO (proposed roadmap — not yet built)

Captured 2026-07-25 from an architecture review. Ordered by priority tier. Check items off
(or delete) as they ship. Tier 0 is correctness/security and should come first.

### Tier 0 — Security & correctness (do first)
- [~] **Audit SECURITY DEFINER functions (CRITICAL).** DONE: `match_photo` (migration 0087) now
  requires `is_member()` and only reads the caller's own pings/activities + visible places;
  `ai-suggest` now verifies an owner/editor profile row. DONE (migration 0093): audited all 83
  public SECDEF functions — 42 were `anon`-EXECUTE-able (readable with just the client-bundle anon
  key, no login), a direct rule-#8 violation. Revoked EXECUTE from `anon` + PUBLIC on every public
  SECDEF function (each keeps its explicit `authenticated` grant, so the SPA is unaffected); trigger
  functions revoked from `authenticated` too. Verified: 0 anon-executable SECDEF fns remain.
  TODO (defense in depth): add `is_member()` body guards to the ~25 client read RPCs so a
  logged-in-but-not-yet-member session (mid join-flow) also can't read via these RLS-bypassing fns.
- [ ] _(original) Audit SECURITY DEFINER functions (CRITICAL)._ `match_photo` (`0082_photo_matching.sql:11`)
  is SECURITY DEFINER, granted to all `authenticated`, does NOT check `is_member()`, and searches
  ALL pings/activities regardless of person. Require `is_member()`, accept/derive the relevant
  profile, filter pings/activities by attribution, add negative tests for revoked users + viewers.
  Review all ~66 SECURITY DEFINER occurrences the same way. The `ai-suggest` edge function's comment
  says owner/editor-only but it only checks that an Auth user exists — verify a profile + role
  before expanding AI usage.
- [x] **Preserve source identity.** The browser resizes/re-encodes before the Worker computes SHA-256
  (`app/src/lib/photos.ts:310`, worker `index.ts:133`), so the same original hashes differently across
  browsers and a manual resize won't dedupe against the Shortcut's original. Hash the ORIGINAL bytes
  client-side before conversion; optionally keep a second stored-object hash.
- [ ] **Harden photo/video ingestion.** Validate max byte size, allowed MIME types, finite/valid
  lat-lng, pixel dimensions, image-decode success before commit, video duration/type/size, valid
  UUID/place ownership; add per-profile rate limits. Stop returning raw internal error detail
  (Worker currently returns `String(err).slice(0,200)`).
- [ ] **Transaction & idempotency.** R2 writes and DB writes are separate → orphaned objects/rows on
  failure. Add a client upload-id/idempotency key, an upload-attempt table with explicit states,
  duplicate-request short-circuit, compensating deletes, and periodic R2↔DB reconciliation.
- [x] **No-GPS handling (don't fabricate coords).** Never store the map-center as a photo's GPS. Keep
  coordinates null; match by capture time vs location history/activities; show likely places; let the
  user search / drop a pin / pick an existing place; store coords only when explicitly confirmed.
  (Partially addressed in the Sorter — audit all upload paths.)
- [x] **Fix lint + CI trust.** LocationTracker has a `react-hooks/exhaustive-deps` warning; both Vitest
  commands stalled locally (test runner / env / OneDrive-backed workspace?) — diagnose before treating
  CI as dependable. UPDATE (2026-07-26): `npm run lint` now fully green — ran `npm run format` to clear
  ~20 files of pre-existing prettier drift that were silently failing the CI lint step. eslint clean;
  `tsc -b` clean. Lint is now safe to promote to a required check.
- [x] **Strengthen CI.** Run on pushes to `main` (not only PRs); add DB migration + pgTAP jobs; add
  Playwright smoke tests; add dependency/security scanning; stop hiding the Worker dry-run failure
  behind `|| echo`; add a preview-deployment smoke test; require CI before merge; replace the generic
  auto-commit messages with descriptive commits.
- [x] **Fix product-copy inconsistencies.** Business rule allows deliberate manual re-upload after
  deletion, but the UI says a deleted photo "can never be re-added" (`PhotoGallery.tsx:211`). Align the
  copy (a deleted photo CAN be re-added by a deliberate manual upload), plus Worker comments, skip
  labels, confirmation dialogs, and docs.
- [~] **Observability & error boundaries.** React error boundary; structured error codes instead of
  swallowed `catch`; Sentry/OpenTelemetry destination; metrics for upload latency, decode failure,
  duplicate, matching-confidence, orphan objects; privacy filters so coordinates / tokens / photo URLs
  never enter logs.

### Reference projects (design inspiration — mind licenses)
- **Immich** — mobile backup, semantic search, duplicates, map, multi-user albums (large system; use as
  a design reference, review its license).
- **PhotoPrism** — labels, metadata filters, maps, face/content recognition (feature reference, not a dep).
- **Uppy** — upload queue, progress, metadata editing, resumability (R2 integration still needs backend).
- **Transformers.js** — private browser-side embeddings / classification / detection (test model
  download + mobile perf).
- **ExifTool** — comprehensive EXIF/XMP/video metadata (not usable directly inside a CF Worker).
- **MapLibre geocoder** — reusable search/typeahead (MapTiler adapter still supplies results).
- **Playwright** — cross-browser E2E + traces.

### Tier 1 — Ingestion pipeline & dedup
- [~] **Type-aware duplicate-place warning before creation.** Show existing places within
  configurable, type-aware radii: ~100 m dining/winery, 1–3 km parks/attractions, larger for
  trails/cities/containers. Offer "use existing", "create separate", "merge". (The current pipeline
  can attach photos to a place up to 30 km away — type-aware matching fixes that.)
- [x] **Multi-place batch completion screen.** A geotagged batch can touch several places, but the map
  upload flow only remembers the first. Show "N photos added across M places", one row per place with
  added/skipped/duplicated/uncertain counts, and a "review all" action.
- [ ] **Split "upload" from "process".** State machine: queued → uploading → stored → metadata
  extracted → matched → ready for review → accepted. Makes failures recoverable and unblocks future
  OCR / AI tagging / perceptual dedup / face blur without the browser waiting.
- [~] **Persistent upload queue.** Survive navigation + connection loss: per-file progress, pause /
  resume / retry / cancel, background continuation while the PWA is active, retry only failed files,
  clear per-photo skip reasons, final server reconciliation.
- [ ] **Similar-photo review (perceptual).** SHA-256 misses edited/cropped/re-downloaded/burst/
  recompressed copies. Add perceptual hashes or image embeddings; show likely-duplicate groups +
  "best shot" stacks.

### Tier 2 — Soft delete & curation UX
- [x] **Undo + trash (replace permanent delete).** Soft-delete window for places/photos/visits: undo
  snackbar immediately, a Trash page with 30-day retention, restore to original place. Keep the
  automated re-import blocklist SEPARATE from ordinary recovery. Safer than browser confirm dialogs,
  esp. on mobile.
- [ ] **Type-aware place templates.** After choosing a type, show relevant fields — Trail: distance/
  elevation/difficulty/route/trailhead; Restaurant: meal/cuisine/reservation link/dish photos;
  Winery/brewery: tasting notes/favorites; Accommodation: dates/booking ref; Park: park system/pass/
  trails/badges; Viewpoint: sunrise/sunset orientation.
- [~] **Batch metadata drawer.** Multi-select → apply-to-all: date/time + timezone correction, place
  reassignment, caption, people, tags, rotation, cover-photo selection.
- [x] **Attention-needed dashboard.** One page: unassigned photos, low-confidence matches, unnamed
  places, places missing categories/visit dates, suspected duplicate places, suspected duplicate
  photos, failed uploads, photos with missing dates, activities without places, trips awaiting
  confirmation.
- [~] **Google Photos import improvements.** Cancelable polling, download progress + failed-item retry,
  album/date filters before download, duplicate previews before transferring bytes, token
  disconnect/reconnect controls.

### Tier 3 — Views & enrichment
- [x] **Smart albums (rule-based):** national parks; beaches/sunsets; hikes > 5 mi; favorites per trip;
  unreviewed; "both of us"; new places this year; repeat visits.
- [x] **Calendar / continuous timeline** — unified chronological view of photos, visits, routes, notes,
  weather, trips (complements the map).
- [~] **Before/after & repeat-visit comparison** — side-by-side visits, route/mileage changes,
  same-viewpoint photos, "what changed" summary.
- [~] **POI enrichment (OSM/Wikidata):** suggest official name, website, hours, park/trail membership,
  nearby peaks/landmarks, Wikipedia blurb. Confirm, never overwrite curated data.
- [ ] **Route planning (OSRM/Valhalla/OpenRouteService):** itineraries, travel time between places,
  optimize a day's stop order, suggest nearby bucket-list places, GPX export.
- [ ] **Offline capture** — offline drafts (photo, rough location, note, rating, visit date) that sync
  when online, without forcing the whole library offline.

### Tier 4 — AI & search
- [ ] **Natural-language photo search (high value).** e.g. "sunsets from beach trips", "Josh and me
  hiking in California", "winery photos from 2024", "similar to this one". Image embeddings in Supabase
  pgvector (HNSW/IVFFlat). Generate privately with Transformers.js or a server model.
- [ ] **AI-assisted categorization.** Extend `ai-suggest` to propose title/category/activity tags/short
  caption with confidence + evidence. Batch queue — don't call an expensive model on every edit.
- [ ] **Image-content tagging (CLIP / Transformers.js or hosted vision):** hiking, beach, food, winery,
  summit, dog, sunset, camping (pattern proven in Immich / PhotoPrism).
- [ ] **OCR (Tesseract.js or vision API):** signs, trail markers, menus, museum labels, race bibs.
  Searchable, not shown as caption unless approved.
- [ ] **Visual duplicate & best-shot ranking:** perceptual similarity + quality signals (blur,
  exposure, resolution, eyes-open, composition, already-cover/favorite).
- [ ] **Conversational travel assistant:** "Where did we hike near Seattle?", "Which unreviewed photos
  belong to the California trip?", "Bucket-list places within 30 min of Saturday's itinerary?",
  "Which places have photos but no review?".
- [ ] **Custom AdventureOrNo MCP** (narrow, private): `search_places`, `get_place_history`,
  `find_unassigned_photos`, `suggest_photo_matches`, `find_duplicate_places`, `summarize_trip`,
  `get_data_health`, `create_place_draft`, `apply_review_decision`. Security: read-only default, no
  photo-byte access unless enabled, NEVER expose home-zone coords, mutations create drafts/require
  confirmation, separate owner/editor scopes, full audit log.

### Tier 5 — Code health & platform
- [ ] **Split oversized modules:** MapView.tsx (~1524), PlacePanel.tsx (~1420), Settings.tsx (~1007),
  index.css (~4948). Extract hooks/components for map layers, draw mode, uploads, place creation,
  photo markers, panels; feature-specific CSS / CSS modules.
- [ ] **Centralize server state (TanStack Query):** dedup requests, cache invalidation, retry, optimistic
  updates w/ rollback, consistent loading/error states — replaces the manual refetch-and-setState.
- [~] **Generate DB types** from the Supabase schema. DONE: `app/src/lib/database.types.ts`
  generated from the live schema (committed), deterministic `npm run gen:types`
  (`scripts/gen-types.mjs`), and a secret-guarded CI job (`db-types-drift`) that regenerates +
  `git diff --exit-code`s to fail when a migration changed the schema without refreshing the types.
  Excluded from eslint/prettier. TODO (incremental): flip `createClient<Database>` and adopt the
  generated Row/Insert types in `data.ts`/`strava.ts` — currently surfaces 24 real nullability
  drift errors in the hand-written interfaces that need per-site reconciliation.
- [ ] **Expand testing:** pgTAP for RLS/triggers/RPC authz/deletion/attribution/matching; Worker
  integration tests (mocked R2 + Supabase); Playwright flows (login, create place, upload, sort, merge,
  delete/restore, mobile layout); axe-core accessibility.
- [~] **Backup & data-health center:** DONE: `/health` page (migration 0092 `data_health()` RPC,
  member-gated) shows whole-dataset counts (places/photos/visits/activities/videos/pings), integrity
  signals (orphaned photos, posterless videos, placeless activities), and GPX/KML/CSV export. TODO:
  scheduled DB export, R2↔DB reconciliation, GeoJSON/JSON export, documented restore rehearsal.
