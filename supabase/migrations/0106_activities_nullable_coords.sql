-- 0106 — Allow coordinate-free (indoor / GPS-less) Strava activities.
--
-- Qualifying activities with distance but no start point (treadmill runs, indoor
-- rides) are now ingested: they count toward mileage + the timeline but stay
-- UNPLACED (place_id null) and OFF the map (no summary_polyline / geom). This only
-- requires lat/lng to be nullable — existing placed rows are unaffected; only new
-- coordinate-free rows use nulls. Additive + reversible.
--
-- ROLLBACK (only valid once no coordinate-free rows exist):
--   alter table public.activities alter column lat set not null;
--   alter table public.activities alter column lng set not null;

alter table public.activities alter column lat drop not null;
alter table public.activities alter column lng drop not null;
