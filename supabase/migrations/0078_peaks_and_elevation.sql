-- 0078_peaks_and_elevation.sql — records (for reproducibility) the peaks table,
-- elevation columns, and stat RPCs that were first applied via direct SQL.
--   peaks: summits reached, matched from hike GPS tracks vs OSM natural=peak
--   activities.elevation_profile: ~30 sampled elevations (m) for the profile chart
--   peaks_bagged() / climbing_stats(): the Settings "Peaks & climbing" card
-- Backfill of elevation_gain + elevation_profile is a one-off script (Open-Topo-
-- Data), not this migration. All statements are idempotent.

create table if not exists public.peaks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ele_m double precision,
  lat double precision not null,
  lng double precision not null,
  geom geography(Point, 4326) generated always as
    (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  created_at timestamptz not null default now(),
  unique (name, lat, lng)
);
alter table public.peaks enable row level security;
drop policy if exists peaks_select on public.peaks;
create policy peaks_select on public.peaks for select using (public.is_member());

alter table public.activities add column if not exists elevation_profile jsonb;

create or replace function public.peaks_bagged()
returns table(id uuid, name text, ele_ft integer)
language sql stable security definer set search_path = public as $$
  select id, name, round(ele_m * 3.28084)::int as ele_ft
  from public.peaks order by ele_m desc nulls last, name;
$$;
grant execute on function public.peaks_bagged() to authenticated;

-- p_profile null → COMBINED total across everyone (the couple's "Our stats"
-- climbing); a specific profile → that person's (their solo + joint).
create or replace function public.climbing_stats(p_profile uuid default null)
returns table(total_ft integer, everests double precision)
language sql stable security definer set search_path = public as $$
  select round(coalesce(sum(elevation_gain), 0) * 3.28084)::int,
         round((coalesce(sum(elevation_gain), 0) / 8848.86)::numeric, 2)::float
  from public.activities
  where elevation_gain is not null
    and (p_profile is null or solo_profile is null or solo_profile = p_profile);
$$;
grant execute on function public.climbing_stats(uuid) to authenticated;
