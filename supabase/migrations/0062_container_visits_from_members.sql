-- 0062_container_visits_from_members.sql — a trip/city/region's visit range comes
-- from EVERYTHING it holds. So its members' activity/photo/entry days fold into
-- the container's visit islands. This lets each activity live as its own leaf
-- place (a hike, a run, a ride) while the trip/city still shows ONE fused visit
-- spanning them (spec §5: "a container's visit range = min/max of the dated
-- places it holds"). Members = places part_of the container, or leaves inside a
-- city/region boundary.

create or replace function public.rebuild_place_visits(p_place uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_place is null then return; end if;

  create temp table _isl on commit drop as
  with days as (
    -- the place's own dated rows
    select coalesce(taken_at, created_at)::date d from public.photos
      where place_id = p_place and coalesce(taken_at, created_at) is not null
    union select start_date::date from public.activities
      where place_id = p_place and start_date is not null
    union select recorded_at::date from public.location_pings where place_id = p_place
    union select date::date from public.entries
      where place_id = p_place and date is not null
    -- member days: activities/photos/entries of places that are part_of this
    -- container OR fall inside its boundary (cities/regions). Empty for leaves.
    union select a.start_date::date from public.activities a
      join public.places mp on mp.id = a.place_id
      where a.start_date is not null and mp.id <> p_place and (
        p_place = any(mp.part_of)
        or exists (select 1 from public.places c where c.id = p_place
                   and c.boundary is not null and mp.geom is not null
                   and st_contains(c.boundary::geometry, mp.geom::geometry)))
    union select coalesce(ph.taken_at, ph.created_at)::date from public.photos ph
      join public.places mp on mp.id = ph.place_id
      where coalesce(ph.taken_at, ph.created_at) is not null and mp.id <> p_place and (
        p_place = any(mp.part_of)
        or exists (select 1 from public.places c where c.id = p_place
                   and c.boundary is not null and mp.geom is not null
                   and st_contains(c.boundary::geometry, mp.geom::geometry)))
    union select e.date::date from public.entries e
      join public.places mp on mp.id = e.place_id
      where e.date is not null and mp.id <> p_place and p_place = any(mp.part_of)
  ),
  dd  as (select distinct d from days),
  grp as (select d, d - (row_number() over (order by d))::int as isl from dd)
  select min(d) as s, max(d) as e from grp group by isl;

  create temp table _isln on commit drop as
  select i.s, i.e,
    (select string_agg(v.note, ' / ' order by v.start_date) from public.visits v
       where v.place_id = p_place and v.note is not null
         and v.start_date <= i.e and v.end_date >= i.s) as note,
    exists (select 1 from public.visits v
       where v.place_id = p_place and v.solo_override
         and v.start_date <= i.e and v.end_date >= i.s) as ovr,
    (select v.solo_profile from public.visits v
       where v.place_id = p_place and v.solo_override
         and v.start_date <= i.e and v.end_date >= i.s
       order by v.start_date limit 1) as ovr_profile,
    (with a as (
        select count(*) as n,
               bool_or(solo_profile is null) as has_joint,
               array_agg(distinct solo_profile) filter (where solo_profile is not null) as solos
        from public.activities
          where place_id = p_place and start_date::date between i.s and i.e)
     select case
       when n = 0 then null
       when has_joint then null
       when array_length(solos, 1) = 1 then solos[1]
       else null end
     from a) as inferred
  from _isl i;

  delete from public.visits where place_id = p_place;
  insert into public.visits (place_id, start_date, end_date, note, solo_profile, solo_override)
    select p_place, s, e, note,
           case when ovr then ovr_profile else inferred end,
           ovr
    from _isln;

  drop table if exists _isl;
  drop table if exists _isln;
end $$;
