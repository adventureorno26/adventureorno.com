-- 0010_dates_walking.sql — expand-not-overwrite visit dates + a Walking tag.
-- Numbered migration; NEVER edit after merge.

-- Walk is its own category now (was folded into hiking).
create or replace function public.activity_category(t text)
returns text
language sql
immutable
as $$
  select case
    when t in ('Hike', 'Snowshoe') then 'hiking'
    when t in ('Walk') then 'walking'
    when t in ('Run', 'TrailRun', 'VirtualRun') then 'running'
    when t in ('Ride', 'MountainBikeRide', 'GravelRide', 'EBikeRide', 'VirtualRide') then 'biking'
    else lower(t)
  end;
$$;

-- Recompute: EXPAND the visit range to cover all children AND any manual edit,
-- instead of overwriting. So a manually-widened trip sticks, and adding photos
-- over several days lengthens the trip automatically.
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
     set first_visit = least(first_visit, v_first),   -- least/greatest ignore NULLs
         last_visit  = greatest(last_visit, v_last),
         visit_count = coalesce(v_count, visit_count),
         cover_photo_id = v_cover,
         activity_categories = coalesce(
           (select array_agg(distinct public.activity_category(type))
              from public.activities where place_id = p_place and type is not null), '{}')
   where id = p_place;
end;
$$;

-- Re-derive categories (Walk → walking) for existing places.
do $$
declare r record;
begin
  for r in select id from public.places loop
    perform public.recompute_place_stats(r.id);
  end loop;
end $$;
