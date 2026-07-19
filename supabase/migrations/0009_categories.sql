-- 0009_categories.sql — Phase 9: place categories (auto from Strava + manual)
-- Numbered migration; NEVER edit after merge.

-- Manual tags the owner/editor adds; auto tags derived from Strava activities.
alter table public.places add column if not exists categories text[] not null default '{}';
alter table public.places add column if not exists activity_categories text[] not null default '{}';

-- Map a Strava activity type to one of our category slugs.
create or replace function public.activity_category(t text)
returns text
language sql
immutable
as $$
  select case
    when t in ('Hike', 'Walk', 'Snowshoe') then 'hiking'
    when t in ('Run', 'TrailRun', 'VirtualRun') then 'running'
    when t in ('Ride', 'MountainBikeRide', 'GravelRide', 'EBikeRide', 'VirtualRide') then 'biking'
    else lower(t)
  end;
$$;

-- Recompute stats (from 0003) + now the auto activity_categories.
create or replace function public.recompute_place_stats(p_place uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first date;
  v_last  date;
  v_count integer;
  v_cover uuid;
begin
  with days as (
    select taken_at::date as d from public.photos
      where place_id = p_place and taken_at is not null
    union
    select recorded_at::date from public.location_pings where place_id = p_place
    union
    select start_date::date from public.activities where place_id = p_place and start_date is not null
  )
  select min(d), max(d), count(*) into v_first, v_last, v_count from days;

  select id into v_cover from public.photos
    where place_id = p_place and is_landscape order by taken_at desc nulls last limit 1;
  if v_cover is null then
    select id into v_cover from public.photos
      where place_id = p_place order by taken_at desc nulls last limit 1;
  end if;

  update public.places
     set first_visit = coalesce(v_first, first_visit),
         last_visit  = coalesce(v_last, last_visit),
         visit_count = coalesce(v_count, 0),
         cover_photo_id = v_cover,
         activity_categories = coalesce(
           (select array_agg(distinct public.activity_category(type))
              from public.activities where place_id = p_place and type is not null), '{}')
   where id = p_place;
end;
$$;

-- Add per-place mileage to the counts view (popups show it for hikes/runs).
create or replace view public.place_counts
  with (security_invoker = on) as
  select
    p.id as place_id,
    (select count(*) from public.photos ph where ph.place_id = p.id) as photo_count,
    (select count(*) from public.activities a where a.place_id = p.id) as route_count,
    (select round((coalesce(sum(a.distance), 0) / 1609.344)::numeric, 1)
       from public.activities a where a.place_id = p.id) as miles
  from public.places p;

grant select on public.place_counts to authenticated;

-- Backfill activity_categories for existing places.
do $$
declare r record;
begin
  for r in select id from public.places loop
    perform public.recompute_place_stats(r.id);
  end loop;
end $$;
