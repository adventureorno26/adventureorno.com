-- 0125 — Fuse a place's visits that fall inside the SAME confirmed trip, and let a
-- visit's dates be edited by hand (place-model Slice 2).
--
-- PROBLEM. Erica: "I added photos to Cape Cod over a number of days and it split it
-- into 2 trips/visits, when it should be consolidated to one visit over a range of
-- days." Cape Cod had photos on Aug 2, 3, 5, 6, 7 — nothing on Aug 4 — and
-- rebuild_place_visits builds islands with `d - row_number()`, which has ZERO gap
-- tolerance. One blank day split one stay in two.
--
-- WHY NOT A BLANKET GAP RULE. Measured first: fusing any <=2-day gap everywhere
-- collapses 445 visits to 415, and the losses land on LOCAL repeat places —
-- Potomac Station 39->27, Lake of the Red Rocks 43->38, Red Rock Regional Park
-- 28->23, all 3 miles from the house. Those are separate runs and hikes on
-- separate days; merging them UNDERCOUNTS. Restricting the rule to containers is
-- also wrong: Reston is a city, but its 2019-02-22 / 2019-02-24 pair is two day
-- trips, not a three-day stay. Distance-from-home would discriminate correctly but
-- `settings.home_zone` no longer exists and business rule #1 forbids reintroducing
-- it anywhere.
--
-- THE RULE. Fuse only what falls inside a CONFIRMED TRIP window. A trip is Erica's
-- own declaration of "I was away then", so it needs no heuristic:
--   * Cape Cod, one trip Aug 2-7  -> the Aug 2-3 and Aug 5-7 islands become ONE
--     visit. The blank Aug 4 stops mattering.
--   * Going back next year is a SECOND trip -> a SECOND visit on the SAME one
--     place. "Count the place once, count the visits every time."
--   * Reston day trips, local runs and AT hikes are in no trip window, so they stay
--     discrete and their counts do not move.
--
-- SAFETY GUARD (MAX_TRIP_DAYS). Trip windows are only trusted up to 30 days. The
-- live "Elizabeth Furnace family campground" trip spans 2024-08-11 -> 2026-05-10,
-- SIX HUNDRED AND THIRTY-SEVEN days, over 7 unrelated single-day visits. Without
-- this cap it would fuse every place visited across 21 months into one visit.
-- A bogus window must never be able to destroy the visit history.
--
-- The fused span is min(start)..max(end) of the ISLANDS that overlap the trip — the
-- actual evidence — not the trip window itself, so a visit never claims days with
-- nothing behind them.
--
-- Manual visits were already exempt from rebuild (`not v.manual` throughout) and
-- stay exempt.

create or replace function public.rebuild_place_visits(p_place uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    select coalesce(taken_at, created_at)::date d from public.photos
      where place_id = p_place and deleted_at is null and coalesce(taken_at, created_at) is not null
    union select start_date::date from public.activities
      where place_id = p_place and start_date is not null
    union select recorded_at::date from public.location_pings where place_id = p_place
    union select date::date from public.entries
      where place_id = p_place and date is not null
    union select a.start_date::date from public.activities a
      join public.places mp on mp.id = a.place_id
      where a.start_date is not null and mp.id <> p_place and (
        p_place = any(mp.part_of)
        or exists (select 1 from public.places c where c.id = p_place
                   and c.boundary is not null and mp.geom is not null
                   and st_contains(c.boundary::geometry, mp.geom::geometry)))
    union select coalesce(ph.taken_at, ph.created_at)::date from public.photos ph
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
    select t.id, t.start_date, t.end_date
      from public.trips t
     where t.start_date is not null
       and t.end_date is not null
       and (t.end_date - t.start_date) <= v_max_trip_days
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
          where place_id = p_place and start_date::date between i.s and i.e)
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

  perform public.promote_trip_stops_for_place(p_place);
end $function$;

-- ---------------------------------------------------------------------------
-- Edit a visit's dates by hand — "let me stretch a visit into a trip by adding
-- more days to it" (Erica, 2026-08-08).
--
-- CRITICAL: this sets manual = true. Every one of the 445 live visits is currently
-- manual = false, and rebuild_place_visits DELETES and recreates every non-manual
-- visit. Without this flag a hand-edited date range would be silently wiped the
-- next time anything touched that place. Flagging it is what makes the edit stick.
--
-- Permission is is_editor_or_owner(), matching the visits_write policy, so Erica
-- AND Josh can both edit — and attribution ("Just me" / "Just Josh" / "Both") does
-- not gate editing, it only records who was there.
create or replace function public.set_visit_dates(
  p_visit uuid,
  p_start date,
  p_end   date)
returns public.visits
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.visits;
  v_place uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_visit is null or p_start is null or p_end is null then
    raise exception 'visit id, start and end are all required';
  end if;
  if p_end < p_start then
    raise exception 'a visit cannot end before it starts';
  end if;

  select place_id into v_place from public.visits where id = p_visit;
  if v_place is null then
    raise exception 'visit % not found', p_visit;
  end if;

  update public.visits
     set start_date = p_start,
         end_date   = p_end,
         manual     = true          -- survives every future rebuild
   where id = p_visit
  returning * into v_row;

  -- Dates changed, so the place's first/last visit and counts must follow, and a
  -- planned trip stop may now be satisfied by this visit.
  perform public.recompute_place_stats(v_place);
  perform public.promote_trip_stops_for_place(v_place);

  return v_row;
end $function$;

revoke all on function public.set_visit_dates(uuid, date, date) from public;
revoke all on function public.set_visit_dates(uuid, date, date) from anon;
grant execute on function public.set_visit_dates(uuid, date, date) to authenticated;
grant execute on function public.set_visit_dates(uuid, date, date) to service_role;
