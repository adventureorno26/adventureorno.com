-- 0047_visit_rebuild.sql — make visits self-healing.
-- The old ensure_visit() only merged EXACTLY-adjacent days, so out-of-order
-- ingests left overlapping ranges (e.g. Paynes Bay 04-16→20 AND 04-18→20), and
-- moving/deleting a backing row never cleaned up the visit it left behind. This
-- replaces the incremental logic with an idempotent rebuild-from-backing-days,
-- so a place's visits are ALWAYS the correct set of merged consecutive ranges.

-- A multi-day visit is a "trip". Computed, so it can never drift out of sync.
alter table public.visits
  add column if not exists is_trip boolean generated always as (end_date > start_date) stored;

-- Recompute one place's visits from its actual photo/activity/ping/entry days.
-- Fuses overlapping/adjacent days into consecutive islands, drops orphaned visits
-- (day no longer backed by anything here), and carries user notes forward by overlap.
create or replace function public.rebuild_place_visits(p_place uuid)
returns void language plpgsql security definer set search_path = public as $$
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
  ),
  dd  as (select distinct d from days),
  grp as (select d, d - (row_number() over (order by d))::int as isl from dd)
  select min(d) as s, max(d) as e from grp group by isl;

  -- Snapshot notes from any old visit overlapping each new island (before we delete).
  create temp table _isln on commit drop as
  select i.s, i.e,
    (select string_agg(v.note, ' / ' order by v.start_date) from public.visits v
       where v.place_id = p_place and v.note is not null
         and v.start_date <= i.e and v.end_date >= i.s) as note
  from _isl i;

  delete from public.visits where place_id = p_place;
  insert into public.visits (place_id, start_date, end_date, note)
    select p_place, s, e, note from _isln;

  drop table if exists _isl;
  drop table if exists _isln;
end $$;

-- Retire the old adjacency-only trigger functions in favour of a full rebuild of
-- BOTH the old and new place whenever a backing row is inserted, moved, or deleted.
create or replace function public.visits_sync_photo() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') and OLD.place_id is not null then
    perform public.rebuild_place_visits(OLD.place_id);
  end if;
  if tg_op in ('INSERT','UPDATE') and NEW.place_id is not null
     and NEW.place_id is distinct from OLD.place_id then
    perform public.rebuild_place_visits(NEW.place_id);
  elsif tg_op in ('INSERT','UPDATE') and NEW.place_id is not null then
    perform public.rebuild_place_visits(NEW.place_id);
  end if;
  return null;
end $$;

create or replace function public.visits_sync_activity() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') and OLD.place_id is not null then
    perform public.rebuild_place_visits(OLD.place_id);
  end if;
  if tg_op in ('INSERT','UPDATE') and NEW.place_id is not null then
    perform public.rebuild_place_visits(NEW.place_id);
  end if;
  return null;
end $$;

drop trigger if exists photos_ensure_visit on public.photos;
drop trigger if exists photos_sync_visit on public.photos;
create trigger photos_sync_visit after insert or update of place_id, taken_at or delete
  on public.photos for each row execute function public.visits_sync_photo();

drop trigger if exists activities_ensure_visit on public.activities;
drop trigger if exists activities_sync_visit on public.activities;
create trigger activities_sync_visit after insert or update of place_id, start_date or delete
  on public.activities for each row execute function public.visits_sync_activity();

drop trigger if exists entries_sync_visit on public.entries;
create trigger entries_sync_visit after insert or update of place_id, date or delete
  on public.entries for each row execute function public.visits_sync_activity();

-- One-time backfill: heal every place. Fixes Paynes Bay's overlap and clears the
-- phantom visits left at Red Rock Regional Park / W&OD / Leesburg by the reattributions.
do $$
declare pid uuid;
begin
  for pid in
    select id from public.places p where exists (
      select 1 from public.visits v where v.place_id = p.id
      union all select 1 from public.activities a where a.place_id = p.id
      union all select 1 from public.photos ph where ph.place_id = p.id
      union all select 1 from public.entries e where e.place_id = p.id
      union all select 1 from public.location_pings lp where lp.place_id = p.id
    )
  loop
    perform public.rebuild_place_visits(pid);
  end loop;
end $$;
