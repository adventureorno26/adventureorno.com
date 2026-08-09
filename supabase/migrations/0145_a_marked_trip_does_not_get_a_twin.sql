-- A marked trip must not grow a derived twin beside it.
--
-- rebuild_place_visits deletes the derived (non-manual) visits at a place and
-- rebuilds them from the days that have evidence. A visit you MARKED is manual, so
-- it survives that delete — and then the same days produce a derived visit as well.
-- Cape Cod: photos on Aug 2-6, a marked trip Aug 2-7, and rebuilding gives you
-- "Aug 2-7 - Trip" AND a second "Aug 2-7". Across Erica's six trip places that is
-- 486 visits becoming 492.
--
-- Pre-existing, and confirmed pre-existing: the same drift appears when the OLD
-- function is run against the same data, so it is not a side effect of the
-- local-date work in 0143/0144.

begin;

CREATE OR REPLACE FUNCTION public.rebuild_place_visits(p_place uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_josh uuid := (select id from public.profiles where display_name = 'Josh' limit 1);
  v_erica uuid := (select id from public.profiles where role = 'owner'
                   and coalesce(display_name,'') !~* '(test|bot)' limit 1);
  v_cutoff constant date := '2025-12-21';
  -- Never trust a trip window longer than this many days (see the note above).
  v_max_trip_days constant int := 30;
begin
  if p_place is null then return; end if;

  create temp table _isl_raw on commit drop as
  with days as (
    select coalesce(local_date, coalesce(taken_at, created_at)::date) d from public.photos
      where place_id = p_place and deleted_at is null and coalesce(taken_at, created_at) is not null
    union select coalesce(local_date, start_date::date) from public.activities
      where place_id = p_place and start_date is not null
    union select recorded_at::date from public.location_pings where place_id = p_place
    union select date::date from public.entries
      where place_id = p_place and date is not null
    union select coalesce(a.local_date, a.start_date::date) from public.activities a
      join public.places mp on mp.id = a.place_id
      where a.start_date is not null and mp.id <> p_place and (
        p_place = any(mp.part_of)
        or exists (select 1 from public.places c where c.id = p_place
                   and c.boundary is not null and mp.geom is not null
                   and st_contains(c.boundary::geometry, mp.geom::geometry)))
    union select coalesce(ph.local_date, coalesce(ph.taken_at, ph.created_at)::date) from public.photos ph
      join public.places mp on mp.id = ph.place_id
      where ph.deleted_at is null and coalesce(ph.taken_at, ph.created_at) is not null and mp.id <> p_place and (
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

  -- Fuse islands that fall inside the same confirmed trip window.
  create temp table _isl on commit drop as
  with usable_trips as (
    -- A trip is a VISIT somebody marked (docs/SCHEMA.md), so the window comes
    -- from visits.is_trip now that the old table is gone. Windows stay GLOBAL
    -- rather than per-place, exactly as before: the Cape Cod trip is what fuses
    -- the separate days at Linnell Landing into one stay.
    select v.id, v.start_date, v.end_date
      from public.visits v
     where v.is_trip
       and v.status = 'taken'
       and v.start_date is not null
       and v.end_date is not null
       and (v.end_date - v.start_date) <= v_max_trip_days
  ),
  mapped as (
    select i.s, i.e,
           (select t.id from usable_trips t
             where t.start_date <= i.e and t.end_date >= i.s
             order by t.start_date, t.id
             limit 1) as trip_id
      from _isl_raw i
  )
  select min(s) as s, max(e) as e
    from mapped
   -- islands sharing a trip collapse into one; untripped islands keep their own key
   group by coalesce(trip_id::text, s::text || '|' || e::text);

  -- An island already covered by a MANUAL visit does not need a derived twin.
  -- Cape Cod is the case: photos on Aug 2-6 sit entirely inside the marked trip
  -- Aug 2-7, and rebuilding produced a second "Aug 2-7" visit beside the trip.
  -- Manual visits are protected from the delete below, so without this the two
  -- accumulate. Partial overlaps still get their own visit — those days really are
  -- outside the marked span.
  delete from _isl i
   where exists (select 1 from public.visits v
                  where v.place_id = p_place and v.manual
                    and i.s >= v.start_date and i.e <= v.end_date);

  create temp table _isln on commit drop as
  select i.s, i.e,
    (select string_agg(v.note, ' / ' order by v.start_date) from public.visits v
       where v.place_id = p_place and not v.manual and v.note is not null
         and v.start_date <= i.e and v.end_date >= i.s) as note,
    exists (select 1 from public.visits v
       where v.place_id = p_place and not v.manual and v.solo_override
         and v.start_date <= i.e and v.end_date >= i.s) as ovr,
    (select v.solo_profile from public.visits v
       where v.place_id = p_place and not v.manual and v.solo_override
         and v.start_date <= i.e and v.end_date >= i.s
       order by v.start_date limit 1) as ovr_profile,
    (with a as (
        select count(*) n,
               array_agg(distinct owner_profile) filter (where owner_profile is not null) owners
        from public.activities
          where place_id = p_place and coalesce(local_date, start_date::date) between i.s and i.e)
     select case
       when a.n > 0 and a.owners = array[v_josh] then v_josh
       when i.s < v_cutoff then v_erica
       else null end
     from a) as inferred
  from _isl i;

  create temp table _match on commit drop as
  select n.s, n.e, n.note, n.ovr, n.ovr_profile, n.inferred,
    (select v.id from public.visits v
       where v.place_id = p_place and not v.manual
         and v.start_date <= n.e and v.end_date >= n.s
       order by (least(v.end_date, n.e) - greatest(v.start_date, n.s)) desc, v.start_date, v.id
       limit 1) as reuse_id
  from _isln n;
  update _match m set reuse_id = null
   where reuse_id is not null
     and exists (select 1 from _match m2 where m2.reuse_id = m.reuse_id and (m2.s, m2.e) < (m.s, m.e));

  update public.visits v
     set start_date = m.s, end_date = m.e, note = m.note,
         solo_profile = case when m.ovr then m.ovr_profile else m.inferred end,
         solo_override = m.ovr
  from _match m where v.id = m.reuse_id;

  delete from public.visits v
   where v.place_id = p_place and not v.manual
     and not exists (select 1 from _match m where m.reuse_id = v.id);

  insert into public.visits (place_id, start_date, end_date, note, solo_profile, solo_override)
    select p_place, m.s, m.e, m.note,
           case when m.ovr then m.ovr_profile else m.inferred end, m.ovr
    from _match m where m.reuse_id is null;

  drop table if exists _isl_raw;
  drop table if exists _isl;
  drop table if exists _isln;
  drop table if exists _match;

end $function$
;

commit;
