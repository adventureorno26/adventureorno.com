-- 0059_retire_legacy.sql — retire the legacy single-parent trail link and the
-- dead second "trips" system. place_membership (mirrored from part_of) is now the
-- ONLY parent↔child mechanism (§3/§6 of the place-model spec).
--
-- Verified safe before running: all 10 places.trail_id links are already present
-- in place_membership (0 would be lost); the trips table (1 row), trip_stats, and
-- add_place_to_trail are referenced only by dead frontend code (lib/trips.ts,
-- addPlaceToTrail) that is imported/called nowhere.

drop function if exists public.add_place_to_trail(uuid, uuid, text);
drop function if exists public.add_place_to_trail(uuid, uuid);
drop function if exists public.trip_stats(uuid);
drop table if exists public.trips cascade;
alter table public.places drop column if exists trail_id;
