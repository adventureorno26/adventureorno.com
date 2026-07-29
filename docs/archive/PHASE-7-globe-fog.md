# PHASE 7 — GLOBE & FOG: MapLibre 5, fog of war, ping layers, photo caching, CI

First, amend CLAUDE.md: under Stack, change "MapLibre GL JS" to "MapLibre GL JS v5". No other stack changes.

Tasks:
1. Upgrade maplibre-gl ^4.7 to latest v5. Work through the v4→v5 changelog; our usage (GeoJSON cluster source, popups, fitBounds, RoutesView polylines) is low-risk. Antialiasing now lives in canvasContextAttributes: { antialias: true }. All existing behavior (hover popups, add-place mode, deep links, bottom sheet ≤640px) must work identically before new features. Commit the upgrade separately.
2. Globe projection: on style load, map.setProjection({ type: 'globe' }) with atmosphere defaults; verify MapTiler streets-v2 renders on the globe. flyTo with a gentle arc from panel/deep links. Slow idle auto-rotate after 60s of no interaction and no selected place; any pointer/touch cancels. Feature-flag behind a settings row map_projection (default 'globe') with a /settings toggle so we can fall back to Mercator without a deploy.
3. Fog of war job: new numbered migration adding revealed_area (single row, geom geography(MultiPolygon,4326), updated_at) and idempotent rebuild_revealed_area(): union of ST_Buffer 10km around every photo, location_ping, and activity start_point (route-line buffering = TODO comment, not this phase), simplified with ST_SimplifyPreserveTopology ~0.01° before storing. pg_cron at 07:10 UTC (after clustering/geocode) and called at the end of cluster_now(). Log to job_runs.
4. Fog of war layer: SECURITY INVOKER RPC revealed_area_geojson() (member read). Client renders the INVERSE — world-covering polygon with revealed areas as holes, fill layer, near-black, fill-opacity ~0.55, above basemap, below markers. Second larger-buffer ring at lower opacity for a soft edge. New layers control top-right (Fog / Heat / none) persisted to localStorage. Must render correctly on the globe.
5. Ping layers: confirm location_pings has a member SELECT policy (add if Phase 1 didn't — writes stay service-role only). Do NOT ship raw pings: RPC pings_overview() returns ST_SnapToGrid (~0.005°) cells with a weight count, capped ~20k rows. Render as a native heatmap layer weighted by count plus a circle layer. Wire into the layers control.
6. Photo-gateway edge caching: in GET /photo/:id, AFTER the session check passes, check caches.default keyed on a synthetic URL like https://cache.internal/photo/{id}/{size}; on miss stream from R2 and ctx.waitUntil(cache.put(...)) with Cache-Control: private, max-age=86400. /delete/:id must purge both size variants BEFORE returning (rule #6 — deleted photos must not survive at the edge). Worker test for delete-purges-cache. Auth still runs on every request; only the R2 read is skipped. Add an X-Cache: HIT/MISS debug header.
7. CI: .github/workflows/ci.yml on PR — npm ci, tsc -b, npm run lint, npm run test, and a wrangler dry-run/check for photo-gateway (skip with a comment if it needs secrets). dependabot.yml grouping npm updates into one monthly PR per workspace. CI badge in README.
8. /settings (owner): "Rotate device token" — mint new token server-side, store only the hash, invalidate old, show raw value once with exact Shortcut + Overland re-config steps (mirror the Phase 2 mint flow). Then STOP and present two decisions to me with your recommendation, do not decide: (a) make the GitHub repo private (it currently exposes home-zone coordinates and business rules publicly); (b) enable R2 object versioning on the photos bucket via dashboard + add a dated restore-drill note to MANUAL-SETUP.md.

## Acceptance criteria
- Zoomed out = globe with atmosphere; idle 60s rotates; touch stops it; /settings toggle falls back to Mercator cleanly.
- Fog on: unvisited world dims, Rome/Barbados/Cape Cod glow through, Leesburg shows nothing new (rule #1 holds — nothing there was ever stored).
- Heatmap renders from one pings_overview() RPC call in <1s, not thousands of rows.
- Second gallery load shows X-Cache: HIT; delete then re-request a photo → 404, not cached bytes.
- A PR with a lint error fails CI; this phase's PR passes.
- Token rotation: old token → 401 on /ingest, new one ingests, last_used_at heartbeat updates.

End with: migrations applied, lint+test clean, preview verified, PR opened via gh, decisions.md entry, and copy the brief above into docs/phases/PHASE-7-globe-fog.md.
