# Phase 3 — Overland ingestion + clustering: the map builds itself

## Objective
Passive GPS breadcrumbs flow in from Erica's phone; a nightly job clusters unassigned photos and
pings into named places automatically.

## Tasks
1. Edge Function `ingest-overland`: accepts Overland's GeoJSON batch format, bearer-auths against
   `ingest_tokens`, drops points inside the home zone and points with accuracy > 200 m, bulk
   inserts `location_pings`, returns Overland's expected `{"result":"ok"}`. Output for
   MANUAL-SETUP: the URL + token to paste into the Overland app.
2. Nightly clustering job (pg_cron, 03:00 ET) as a SQL function:
   - Input: photos with place_id NULL + pings from the last 14 days not yet consumed.
   - `ST_ClusterDBSCAN(eps := 10km, minpoints := 1)` in a suitable projection.
   - Per cluster: nearest existing place within 10 km → attach (update last_visit, visit_count
     when the gap since previous visit > 48 h); else create a place at the cluster centroid.
   - New places: reverse-geocode via MapTiler (Edge Function `geocode-new-places`, called by the
     job or a follow-up cron minute) → locality-level name ("Asheville, North Carolina"),
     country, US state. Cover photo = most recent landscape-orientation photo, if any.
   - Pings-only clusters (no photos) still create places — being there counts.
   - Idempotent and safe to re-run; log a one-row summary per run to a `job_runs` table.
3. UI: place names editable inline (auto-names are just defaults); merge tool — select two
   places → merge (photos, entries, activities, visit history combine); places created by
   clustering get a subtle "auto" badge until first edited.
4. /settings → Home zone card: shows center + radius from `settings`, editable by owner only.

## Acceptance criteria
- Seeded fixture: 30 fake photos + 500 fake pings across 3 cities + Leesburg → job run creates
  exactly 3 named places, Leesburg data absent, second run changes nothing.
- Real test: Erica walks around with Overland for a day outside the zone → place appears next
  morning without touching anything.
- Merging two places preserves all children and deletes the loser.
