-- 0063_attribution_in_rebuild.sql — Phase A1. Bake the attribution DEFAULT into
-- rebuild_place_visits so it is re-derived (never erased) on every rebuild.
--
-- Inference order for each visit island:
--   1. manual override (solo_override) wins — keeps VA Beach 2026-03-22 = Erica
--   2. all activities that day owned solely by Josh → Josh (his own imports/runs)
--   3. date rule: island starts before 2025-12-21 → Erica, on/after → Both (null)
-- Erica's own pre-cutoff falls out of the date rule; shared/photo-only days too.

create or replace function public.rebuild_place_visits(p_place uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_josh uuid := (select id from public.profiles where display_name = 'Josh' limit 1);
  v_erica uuid := (select id from public.profiles where role = 'owner'
                   and coalesce(display_name,'') !~* '(test|bot)' limit 1);
  v_cutoff constant date := '2025-12-21';
begin
  if p_place is null then return; end if;

  create temp table _isl on commit drop as
  with days as (
    select coalesce(taken_at, created_at)::date d from public.photos
      where place_id = p_place and coalesce(taken_at, created_at) is not null
    union select start_date::date from public.activities
      where place_id = p_place and start_date is not null
    union select recorded_at::date from public.location_pings where place_id = p_place
    union select date::date from public.entries
      where place_id = p_place and date is not null
    -- container rollup: members' days (part_of, or inside a city/region boundary)
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
    -- default: all-Josh day → Josh; else date rule (pre-cutoff → Erica, else Both)
    (with a as (
        select count(*) n,
               array_agg(distinct owner_profile) filter (where owner_profile is not null) owners
        from public.activities
          where place_id = p_place and start_date::date between i.s and i.e)
     select case
       when a.n > 0 and a.owners = array[v_josh] then v_josh
       when i.s < v_cutoff then v_erica
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
