-- 0101 — Stable Visit reconciliation + coherent trip_stop semantics.
-- ADDITIVE (CREATE OR REPLACE of a function defined in older migrations; no old
-- migration edited). Draft; verified on a disposable local stack, NOT on prod.
--
-- Items addressed:
--  1. rebuild_place_visits reconciles instead of delete+reinsert: DERIVED visits
--     keep their IDs (matched to islands by overlap); notes/attribution/overrides
--     preserved; MANUAL visits (manual=true) are never touched.
--  2. Deleting a Visit demotes any completed trip_stop to 'planned' (visit_id→null)
--     instead of violating the completed⇔visit CHECK or aborting ingestion.
--  3. A completed stop's visit must belong to the SAME place and overlap the Trip's
--     date range (trigger-enforced).
--  4. When a qualifying Visit appears, a matching 'planned' stop is promoted to
--     'completed' without leaving a duplicate planned row.
--
-- ROLLBACK:
--   drop trigger if exists trg_trip_stops_visit_integrity on public.trip_stops;
--   drop function if exists public.trip_stops_visit_integrity();
--   drop trigger if exists trg_visits_demote_stops on public.visits;
--   drop function if exists public.demote_trip_stops_on_visit_delete();
--   drop trigger if exists trg_visits_promote_stops on public.visits;
--   drop function if exists public.promote_trip_stops_for_visit();
--   -- rebuild_place_visits reverts by re-running 0063's definition.

-- 1) Stable reconciliation.
create or replace function public.rebuild_place_visits(p_place uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
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

  -- Note/attribution/override read only from DERIVED visits (manual stays separate).
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

  -- Reconcile: match each island to an existing DERIVED visit by best overlap, so
  -- IDs are preserved. Each existing visit is reused by at most one island.
  create temp table _match on commit drop as
  select n.s, n.e, n.note, n.ovr, n.ovr_profile, n.inferred,
    (select v.id from public.visits v
       where v.place_id = p_place and not v.manual
         and v.start_date <= n.e and v.end_date >= n.s
       order by (least(v.end_date, n.e) - greatest(v.start_date, n.s)) desc, v.start_date, v.id
       limit 1) as reuse_id
  from _isln n;
  -- If two islands claim the same existing visit, only the first keeps it.
  update _match m set reuse_id = null
   where reuse_id is not null
     and exists (select 1 from _match m2 where m2.reuse_id = m.reuse_id and (m2.s, m2.e) < (m.s, m.e));

  -- Update reused visits in place (preserve id).
  update public.visits v
     set start_date = m.s, end_date = m.e, note = m.note,
         solo_profile = case when m.ovr then m.ovr_profile else m.inferred end,
         solo_override = m.ovr
  from _match m where v.id = m.reuse_id;

  -- Delete DERIVED visits that no longer match any island (BEFORE inserting new ones,
  -- so freshly-inserted visits aren't caught). Manual visits untouched.
  delete from public.visits v
   where v.place_id = p_place and not v.manual
     and not exists (select 1 from _match m where m.reuse_id = v.id);

  -- Insert islands with no reuse.
  insert into public.visits (place_id, start_date, end_date, note, solo_profile, solo_override)
    select p_place, m.s, m.e, m.note,
           case when m.ovr then m.ovr_profile else m.inferred end, m.ovr
    from _match m where m.reuse_id is null;

  drop table if exists _isl;
  drop table if exists _isln;
  drop table if exists _match;

  -- Item 4: promote planned trip_stops whose evidence now exists.
  perform public.promote_trip_stops_for_place(p_place);
end $function$;

-- 3) A completed stop's visit must be same-place and overlap the trip's date range.
create or replace function public.trip_stops_visit_integrity()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_place uuid; v_s date; v_e date; t_s date; t_e date;
begin
  if NEW.visit_id is null then return NEW; end if;
  select place_id, start_date, end_date into v_place, v_s, v_e from public.visits where id = NEW.visit_id;
  if v_place is null then
    raise exception 'trip_stops: visit % not found', NEW.visit_id;
  end if;
  if v_place <> NEW.place_id then
    raise exception 'trip_stops: visit % belongs to a different place', NEW.visit_id;
  end if;
  select start_date, end_date into t_s, t_e from public.trips where id = NEW.trip_id;
  if t_s is not null and t_e is not null and not (v_s <= t_e and v_e >= t_s) then
    raise exception 'trip_stops: visit % does not overlap trip % date range', NEW.visit_id, NEW.trip_id;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_trip_stops_visit_integrity on public.trip_stops;
create trigger trg_trip_stops_visit_integrity
  before insert or update of visit_id, place_id, status on public.trip_stops
  for each row execute function public.trip_stops_visit_integrity();

-- 2) Deleting a visit demotes its completed stops to planned (never aborts ingest).
--    trip_stops.visit_id is ON DELETE SET NULL; this BEFORE trigger runs on the
--    resulting update path via an explicit pre-delete pass.
create or replace function public.demote_trip_stops_on_visit_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Demote first (avoids the completed⇔visit CHECK when SET NULL fires), then let
  -- the FK SET NULL clear visit_id. Collapse into an existing planned row if one
  -- exists for the same (trip, place) to avoid a duplicate planned entry.
  update public.trip_stops s
     set status = 'planned', visit_id = null
   where s.visit_id = OLD.id
     and not exists (select 1 from public.trip_stops p
                     where p.trip_id = s.trip_id and p.place_id = s.place_id and p.visit_id is null and p.id <> s.id);
  delete from public.trip_stops s
   where s.visit_id = OLD.id
     and exists (select 1 from public.trip_stops p
                 where p.trip_id = s.trip_id and p.place_id = s.place_id and p.visit_id is null and p.id <> s.id);
  return OLD;
end $$;
drop trigger if exists trg_visits_demote_stops on public.visits;
create trigger trg_visits_demote_stops
  before delete on public.visits
  for each row execute function public.demote_trip_stops_on_visit_delete();

-- 4) Promotion: for a place, any planned stop whose trip range now contains a Visit
--    of that place becomes completed (linked), dropping the redundant planned row.
create or replace function public.promote_trip_stops_for_place(p_place uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.trip_stops s
     set status = 'completed', visit_id = v.id
  from public.trips t
  join public.visits v on v.place_id = p_place
  where s.place_id = p_place and s.visit_id is null and s.status = 'planned'
    and t.id = s.trip_id and t.start_date is not null and t.end_date is not null
    and v.start_date >= t.start_date and v.start_date <= t.end_date
    -- don't create a duplicate: only if this visit isn't already a stop of the trip
    and not exists (select 1 from public.trip_stops s2 where s2.trip_id = s.trip_id and s2.visit_id = v.id);
end $$;
revoke execute on function public.promote_trip_stops_for_place(uuid) from anon, public;
