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

## Historical backlog ledger (not authoritative)

The checklist below is the July 25 architecture-review ledger. It is retained as
historical evidence and contains a mixture of shipped, partial, superseded, and
optional ideas. **Do not use it to choose the next task or infer completion.** Use
[`docs/COMPLETION-PLAN.md`](docs/COMPLETION-PLAN.md) for the current ordered work,
acceptance criteria, and commands.

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
- [~] **Harden photo/video ingestion.** DONE (Worker redeployed 2026-07-26,
  version c9382fbe, /health 200): stopped leaking raw internal error detail — the top-level catch
  now logs the full error server-side under a short `ref` and returns only `{error, ref}` (no SQL/
  token/coord text); added a 64 MiB max-upload guard (413) above the empty-body check. TODO:
  allowed-MIME allowlist, finite/valid lat-lng range check, pixel-dimension bounds, video
  duration/type/size, valid-UUID/place-ownership checks, per-profile rate limits.
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
- [~] **Google Photos import improvements.** DONE (2026-07-26): robust return flow — persist only the
  picker session id + return context in localStorage (NOT the access token; token now memory-only,
  re-minted from the server refresh path), named popup, `/photos/import/complete` route + resume
  banner survive a backgrounded/reloaded tab (fixes mobile stranding), uploads go to the global
  queue (return immediately), completion shows added/duplicate/failed/to-sort counts + Return button.
  TODO: album/date filters before download, duplicate previews before transferring bytes, token
  disconnect/reconnect controls.

- [x] **Primary navigation shell (UX phase 1).** Persistent bottom text nav (Map/Places/Add/Timeline/
  More; no icons per Erica). `/places` was previously unreachable — now linked. `/add` hub. Settings
  maintenance grid relabeled "Manage data", separate from preferences. Deployed 2026-07-26.

### UX/UX-workflow phase (Erica, 2026-07-26) — IN PROGRESS
- [x] **Phase 1 nav** (above).
- [x] **Phase 2 — Google Photos robust return** (above under "import improvements").
- [~] **Phase 3 — Place/Visit card + guided Add.** DONE (Slice 3a, deployed): "Log a visit" is now the
  primary Place-card action (`.log-visit-btn`, label "Log a visit"/"Log another visit"), the visit
  form captures Who (per-visit attribution via set_visit_solo), visit rows now show their note,
  picking a duplicate place in NewPlaceDraft PRESERVES entered date/who/photos as a new visit on the
  existing place (`addToExisting`) instead of discarding them, and DB terms fixed ("Part of…" →
  "Add to a trip or trail", "OSM type" → "Type"). DONE (Slice 3b, deployed): full 5-step guided Add
  wizard at `/add` (`AddWizard.tsx`, replaced the launcher) — search existing place OR create new
  (search-before-create + nearby-dupe detection) → date/who → tags/rating/notes → photos → review &
  save; non-destructive on existing places (merges tags, won't clobber a review); reuses createPlace/
  addVisit/setVisitSolo/setMyRating/uploadPhoto. DONE (per-visit enrichment): migration 0095
  `place_visit_stats(place)` (member-gated, anon-revoked) → `fetchPlaceVisitStats` → visit rows now
  show note + "N photos · N videos". TODO: people/rating per visit row; unify PlacePanel `addSpot`.
- [~] **Phase 4 — Map UX.** DONE (deployed): active-filter chips + Reset (`FilterChips`, shows
  category+person filters with ×), empty-filtered-state message, visit-count "×N" text badges on
  repeat-visit markers (`place-visit-badge` symbol layer; text not icon per Erica). Preserve map
  position across card open/close is already satisfied (the /place/:id route re-renders the same
  persistent MapView instance). TODO: map/list toggle (Places list is nav-reachable meanwhile),
  highlight newly created/visited places.
- [~] **Phase 5 — Feedback/safety + a11y + Playwright.** DONE (deployed): reusable `useDialog` hook
  (focus-into-dialog on open, Escape-to-close, Tab focus-trap, restore focus on close) wired into the
  New Place modal with proper role="dialog"/aria-modal + backdrop-click close; unsaved-form guard
  (confirm before discarding a dirty draft); "Visit logged"/"Saved!" success toasts; visit-delete now
  an **Undo snackbar** (recreates dates + attribution) instead of a browser confirm. DONE (Playwright
  harness): `app/playwright.config.ts` (4 device projects: desktop Chrome/Safari, iPhone 13, Pixel 7),
  `e2e/fixtures.ts` (test-bot session injection via password grant → localStorage; SKIPS cleanly
  without TEST_BOT_* secrets), non-destructive specs `e2e/public.spec.ts` + `e2e/app.spec.ts` (nav,
  Add-wizard steps, keyboard, "Manage data", axe-core critical-violation scans). Public suite VERIFIED
  passing (3/3 on chromium + real preview). CI `e2e` job wired (builds, installs chromium+webkit, runs
  suite, uploads report). `npm run e2e`. DONE (a11y polish, deployed): `.sr-only` util + global
  `:where(...):focus-visible` visible-focus outline; upload-queue progress announced via an
  aria-live="polite" role="status" region. TODO: the MUTATING acceptance flows (create place / two
  visits / duplicate / upload retry) need a dedicated TEST TENANT (blocked on multi-tenant Space
  isolation); real-device #10 is manual; unify the PlacePanel `addSpot` create path (deferred — risky
  refactor of the child-place/container flow).
- Search RPC `search_photos` (migration 0094, member-gated) landed to back "search existing places
  before creating"; NL-search edge fn + UI still to wire.

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
  Excluded from eslint/prettier. TODO (low priority): flipping `createClient<Database>` surfaces 24
  errors in `data.ts`/`strava.ts`, but on inspection ~9 are FALSE POSITIVES (Supabase's generator
  types SQL function args as non-null even when the fn accepts null — our `p_profile ?? null` is
  correct) and the rest are harmless type-lies the code already coalesces at runtime (no actual
  bugs). Not worth the cast noise now; revisit only if adopting generated Row types wholesale. The
  committed types + drift CI already deliver the schema-safety win.
- [~] **Expand testing:** DONE: vitest confirmed healthy (was stalling — environmental, not the runner;
  26 tests green). Added `exports.test.ts` (10 tests) after extracting pure `placesToCsv/Gpx/Kml`
  builders from the DOM `download()` — covers exportable-filtering, name sort, CSV quote/comma/newline
  escaping, XML entity escaping, coordinate order, empty-input well-formedness. Protects the data-
  recovery/export path used by the new Data Health page. TODO: pgTAP for RLS/triggers/RPC authz/
  deletion/attribution/matching; Worker integration tests (mocked R2 + Supabase); Playwright flows
  (login, create place, upload, sort, merge, delete/restore, mobile layout); axe-core accessibility.
- [~] **Backup & data-health center:** DONE: `/health` page (migration 0092 `data_health()` RPC,
  member-gated) shows whole-dataset counts (places/photos/visits/activities/videos/pings), integrity
  signals (orphaned photos, posterless videos, placeless activities), and GPX/KML/CSV export. TODO:
  scheduled DB export, R2↔DB reconciliation, GeoJSON/JSON export, documented restore rehearsal.

## Commercial multi-tenant + Space branding plan (PROPOSED 2026-07-26 — NOT started)

Erica's directive to build a commercial, multi-tenant SaaS version ("Spaces") from this codebase.
A full written proposal was delivered in chat; this is the durable capture. **Do not start until
Erica approves a phase.** Guardrails from her brief:

**Repository strategy**
- KEEP this repo + deployment as the private Erica/Josh system; do NOT rewrite its migration history
  or point commercial customers at its DB.
- NEW commercial repo with NO inherited git history; new domain, Supabase project, R2 buckets,
  Workers, OAuth clients, payment resources, deploy envs.
- Do NOT copy personal data, credentials, home-zone values, names, special dates, or personal
  cleanup migrations. Reuse UI/domain code only after removing household assumptions.
- Design so the household can later be migrated in as the FIRST Space; keep the old deploy as a
  rollback until migration is verified. Do NOT maintain two permanently diverging feature codebases
  (the endgame is the household running ON the commercial platform as Space #1).

**Space branding** — Space-scoped settings: display name, short installed name, slug, icon type
(product|letter|photo), icon letter, icon bg color, icon photo, theme color, brand version. Branding
screen: live app-header preview, Home-Screen icon preview, maskable/rounded preview, letter+color
picker, photo upload/crop, "Restore Product Branding", install instructions.

**Icon processing** — validate bytes/dims/MIME/size; NO arbitrary SVG; strip EXIF/metadata; fix
orientation; crop square; generate 192 / 512 / maskable-512 / Apple-touch / favicon; store keys under
Space namespace; immutable versioned URLs; safe delete of old derivatives after replace; default to a
generated letter icon; warn a photo icon shows on the device Home Screen.

**Dynamic install** — Space-specific install route + dynamic manifest (stable Space id, Space
start_url, name/short_name, versioned icon URLs, display standalone, theme/bg colors, correct
content-type). Don't expose private Space names/photos via predictable public URLs. Revocable
high-entropy install token OR authenticated delivery (threat-model token leakage + caching). Cache
keys MUST include Space + brand version. Install flows for iPhone Safari, Android Chrome, desktop
Chrome/Edge/Safari, no-prompt fallback, already-installed, post-install icon/name change (explain
some platforms need remove+reinstall to update).

**PWA** — replace the current SW-unregistration behavior with: versioned SW, update notification,
offline shell, offline drafts, resumable upload queue, strict Space-specific cache isolation, logout
cache cleanup, no private media in shared caches. NEVER cache authed API responses unless the cache
identity includes user + Space + permissions + version.

**Acceptance tests (10):** two Spaces distinct name/icon; each installed app opens its Space; Space A
can't get Space B manifest/icons/branding; letter icons at all sizes; photo metadata stripped;
branding change updates web UI immediately; UI warns when reinstall required; revoking an install
token blocks manifest/icon retrieval without breaking authed in-app use; logout clears private cached
Space content; real-device iPhone+Android install flows.

**Report delivered (summary):** monorepo (`apps/web`, `apps/workers/*`, `packages/core|ui|tenancy|
branding|db`, `supabase/`); SAFE-to-extract modules = geo, exports, categories, uploadQueue, snackbar,
maptiler, walks/timeline pure helpers, AuthedImg, worker image pipeline (decide/cache/render);
REWRITE = auth→org/Space membership + roles + billing, all RLS to be space_id-scoped, home-zone as
per-Space config, attribution (2-person Me/Josh/Both → N-member), Strava/Garmin/Google OAuth to
per-Space clients, ingest tokens per Space, service worker + manifest. Top risks = cross-tenant
leakage (RLS + every query space-scoped; SECDEF fns must filter by space), and cache poisoning across
tenants (Space+brand-version in every cache key; no private media in shared caches; authed manifest/
icon delivery). Migration = stand up commercial platform empty → import household as Space #1 via an
ETL that maps profiles→members and strips home-zone/personal cleanup → verify → cut DNS → keep old
deploy as rollback. Phases: P0 tenancy foundation, P1 branding+icon pipeline, P2 dynamic manifest+
install, P3 commercial PWA, P4 billing/onboarding, P5 household migration, P6 retire old deploy.
