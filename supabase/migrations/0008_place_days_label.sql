-- 0008_place_days_label.sql — show the Strava activity name on the visit row.
-- Numbered migration; NEVER edit after merge. (Redefines place_days from 0007.)

drop function if exists public.place_days(uuid);
create or replace function public.place_days(p_place uuid)
returns table(
  day date, activities integer, entries integer, photos integer, pings integer, label text
)
language sql
stable
security definer
set search_path = public
as $$
  with d as (
    select start_date::date as day, 'a' as kind
      from public.activities where place_id = p_place and start_date is not null
    union all
    select date, 'e' from public.entries where place_id = p_place and date is not null
    union all
    select taken_at::date, 'p' from public.photos where place_id = p_place and taken_at is not null
    union all
    select recorded_at::date, 'g'
      from public.location_pings where place_id = p_place
  ),
  grouped as (
    select
      day,
      count(*) filter (where kind = 'a')::int as activities,
      count(*) filter (where kind = 'e')::int as entries,
      count(*) filter (where kind = 'p')::int as photos,
      count(*) filter (where kind = 'g')::int as pings
    from d group by day
  )
  select
    g.*,
    -- The name of an activity that day (most-recent one with a name), if any.
    (select a.name from public.activities a
       where a.place_id = p_place and a.start_date::date = g.day and a.name is not null
       order by a.start_date desc limit 1) as label
  from grouped g
  order by g.day desc;
$$;

revoke all on function public.place_days(uuid) from public;
grant execute on function public.place_days(uuid) to authenticated;
