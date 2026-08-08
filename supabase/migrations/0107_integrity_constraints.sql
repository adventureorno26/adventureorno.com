-- 0107 — Staged data-integrity constraints: finite coordinate ranges, non-negative
-- distance/durations, and paired activity coordinates. Production was verified clean
-- (0 violations), so the NOT VALID → VALIDATE pattern succeeds immediately. Additive,
-- reversible, idempotent (drop-if-exists before each add). Coordinate checks are
-- null-tolerant (coordinate-free activities + no-GPS photos are allowed).
--
-- ROLLBACK: alter table <t> drop constraint if exists <name>;  (for each below)

-- Coordinate ranges.
alter table public.places drop constraint if exists places_coord_range;
alter table public.places add constraint places_coord_range check (
  (lat is null or lat between -90 and 90) and (lng is null or lng between -180 and 180)
) not valid;
alter table public.places validate constraint places_coord_range;

alter table public.photos drop constraint if exists photos_coord_range;
alter table public.photos add constraint photos_coord_range check (
  (lat is null or lat between -90 and 90) and (lng is null or lng between -180 and 180)
) not valid;
alter table public.photos validate constraint photos_coord_range;

alter table public.location_pings drop constraint if exists location_pings_coord_range;
alter table public.location_pings add constraint location_pings_coord_range check (
  (lat is null or lat between -90 and 90) and (lng is null or lng between -180 and 180)
) not valid;
alter table public.location_pings validate constraint location_pings_coord_range;

alter table public.activities drop constraint if exists activities_coord_range;
alter table public.activities add constraint activities_coord_range check (
  (lat is null or lat between -90 and 90) and (lng is null or lng between -180 and 180)
) not valid;
alter table public.activities validate constraint activities_coord_range;

-- An activity is either placed (both coords) or coordinate-free (neither) — never half.
alter table public.activities drop constraint if exists activities_paired_coords;
alter table public.activities add constraint activities_paired_coords check (
  (lat is null) = (lng is null)
) not valid;
alter table public.activities validate constraint activities_paired_coords;

-- Non-negative movement metrics.
alter table public.activities drop constraint if exists activities_nonneg_metrics;
alter table public.activities add constraint activities_nonneg_metrics check (
  distance >= 0
  and (moving_time is null or moving_time >= 0)
  and (elapsed_time is null or elapsed_time >= 0)
) not valid;
alter table public.activities validate constraint activities_nonneg_metrics;
