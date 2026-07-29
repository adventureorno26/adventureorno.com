-- 0099 — ADR 0001 Option A: trip_stops (Visit-linked) + careful migration of the
-- container-Place trips. ADDITIVE, IDEMPOTENT, REVERSIBLE. Verified on a disposable
-- local stack; NOT applied to production.
--
-- Correctness rules (per review):
--  * A trip_stop links a Trip to a Place, optionally to a specific VISIT. status
--    'completed' REQUIRES a linked visit (evidence); 'planned' has no visit. Repeat
--    visits to the same Place are supported (multiple completed stops, one per visit).
--  * Membership is EXPLICIT (trip_stops), never date-range inference.
--  * The backfill EXCLUDES deleted + suggested (draft) places and NEVER guesses:
--    undated/suggested/deleted/nested container-Place trips are QUARANTINED in
--    trip_migration_exceptions, not converted. A member becomes a 'completed' stop
--    ONLY where a real Visit exists in range; otherwise 'planned'.
--  * Safe FKs: trip_id/place_id CASCADE (a stop cannot outlive its trip or place);
--    visit_id ON DELETE SET NULL (deleting a visit demotes a stop to planned, never
--    deletes user data).
--  * Reads/stats are member-gated AND draft-private (exclude unsaved/deleted places)
--    and computed only from linked, visible, completed data.
--
-- ROLLBACK (removes only what 0099 added; NEVER drops the shared trips table or
-- deletes rows in tables it didn't create):
--   drop function if exists public.migrate_container_place_trips();
--   drop function if exists public.trip_place_ids(uuid);
--   drop function if exists public.trip_stats(uuid);   -- (re-run 0097's trip_stats to restore)
--   delete from public.trips where source_place_id is not null;  -- migrated trips only
--   drop index if exists trips_source_place_uidx;
--   alter table public.trips drop column if exists source_place_id;
--   drop table if exists public.trip_stops;
--   drop table if exists public.trip_migration_exceptions;

-- 1) trip_stops.
create table if not exists public.trip_stops (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  visit_id uuid references public.visits(id) on delete set null,
  status text not null default 'planned' check (status in ('planned', 'completed', 'skipped')),
  sort_order int not null default 0,
  note text,
  created_at timestamptz not null default now(),
  -- a 'completed' stop must carry its evidence visit; planned/skipped must not.
  constraint trip_stops_completed_needs_visit
    check ((status = 'completed') = (visit_id is not null))
);
-- Each Visit belongs to a trip at most once (repeat visits differ by visit_id).
create unique index if not exists trip_stops_trip_visit_uidx
  on public.trip_stops (trip_id, visit_id) where visit_id is not null;
-- At most one PLANNED entry per (trip, place).
create unique index if not exists trip_stops_trip_place_planned_uidx
  on public.trip_stops (trip_id, place_id) where visit_id is null;

alter table public.trip_stops enable row level security;
drop policy if exists trip_stops_select on public.trip_stops;
-- Draft privacy: editors/owners see all stops; viewers only stops whose Place is
-- saved + not deleted/suggested (can't discover hidden Place/Visit identifiers).
create policy trip_stops_select on public.trip_stops for select using (
  public.is_editor_or_owner()
  or (public.is_member() and exists (
    select 1 from public.places p where p.id = trip_stops.place_id
      and p.deleted_at is null and p.saved and not p.suggested))
);
drop policy if exists trip_stops_insert on public.trip_stops;
create policy trip_stops_insert on public.trip_stops for insert with check (public.is_editor_or_owner());
drop policy if exists trip_stops_update on public.trip_stops;
create policy trip_stops_update on public.trip_stops for update using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());
drop policy if exists trip_stops_delete on public.trip_stops;
create policy trip_stops_delete on public.trip_stops for delete using (public.is_editor_or_owner());

-- 2) Quarantine table for ambiguous records that must NOT be auto-converted.
create table if not exists public.trip_migration_exceptions (
  place_id uuid,
  parent_trip_place_id uuid,
  reason text not null,
  detected_at timestamptz not null default now()
);
alter table public.trip_migration_exceptions enable row level security;
drop policy if exists trip_migration_exceptions_select on public.trip_migration_exceptions;
create policy trip_migration_exceptions_select on public.trip_migration_exceptions for select using (public.is_editor_or_owner());

-- 3) Provenance column `trips.source_place_id` + its unique index are defined in
--    0097 (they must exist before 0097's draft-privacy RLS references them). Nothing
--    to add here.

-- 4) The migration/backfill as a reusable, IDEMPOTENT function so the migration and
--    the tests exercise the SAME logic (no duplicated SQL). Quarantines ambiguous
--    records; never guesses completion.
create or replace function public.migrate_container_place_trips()
returns void language plpgsql security definer set search_path = public
as $$
begin
  -- a) Quarantine ambiguous container-Place trips: suggested / deleted / missing or
  --    reversed date range. (Null-category places aren't trips, so aren't touched.)
  insert into public.trip_migration_exceptions (place_id, reason)
  select p.id, case when p.deleted_at is not null then 'trip_deleted'
                    when p.suggested then 'trip_suggested_draft'
                    when p.first_visit is null or p.last_visit is null then 'trip_undated'
                    else 'trip_reversed_range' end
  from public.places p
  where p.category = 'trip'
    and (p.deleted_at is not null or p.suggested
         or p.first_visit is null or p.last_visit is null
         or p.first_visit > p.last_visit)
    and not exists (select 1 from public.trip_migration_exceptions e
                    where e.place_id = p.id and e.parent_trip_place_id is null);

  -- b) Migrate only CLEAN trips: not deleted, not suggested, both dates present and
  --    ordered.
  insert into public.trips (name, start_date, end_date, status, source_place_id, created_by)
  select p.name, p.first_visit, p.last_visit,
         case when p.first_visit > current_date then 'upcoming' else 'taken' end,
         p.id, p.created_by
  from public.places p
  where p.category = 'trip' and p.deleted_at is null and not p.suggested
    and p.first_visit is not null and p.last_visit is not null
    and p.first_visit <= p.last_visit
    and not exists (select 1 from public.trips t where t.source_place_id = p.id);

  -- c) Quarantine ambiguous members (nested/container, deleted, suggested, unsaved).
  insert into public.trip_migration_exceptions (place_id, parent_trip_place_id, reason)
  select ch.id, m.parent_id,
         case when ch.category = 'trip' or coalesce(ch.holds_children,false) then 'member_is_container_or_trip'
              when ch.deleted_at is not null then 'member_deleted'
              when ch.suggested then 'member_suggested_draft'
              else 'member_unsaved_draft' end
  from public.trips t
  join public.place_membership m on m.parent_id = t.source_place_id
  join public.places ch on ch.id = m.child_id
  where t.source_place_id is not null
    and (ch.category = 'trip' or coalesce(ch.holds_children,false)
         or ch.deleted_at is not null or ch.suggested or not ch.saved)
    and not exists (select 1 from public.trip_migration_exceptions e
                    where e.place_id = ch.id and e.parent_trip_place_id = m.parent_id);

  -- d) COMPLETED stops: clean member + real Visit in range → one stop per visit
  --    (repeat visits → multiple stops).
  insert into public.trip_stops (trip_id, place_id, visit_id, status, sort_order)
  select t.id, ch.id, v.id, 'completed',
         (row_number() over (partition by t.id order by v.start_date, ch.name))::int
  from public.trips t
  join public.place_membership m on m.parent_id = t.source_place_id
  join public.places ch on ch.id = m.child_id
  join public.visits v on v.place_id = ch.id
       and v.start_date >= t.start_date and v.start_date <= t.end_date
  where t.source_place_id is not null
    and ch.deleted_at is null and not ch.suggested and ch.saved
    and ch.category <> 'trip' and not coalesce(ch.holds_children,false)
    and not exists (select 1 from public.trip_stops s where s.trip_id = t.id and s.visit_id = v.id);

  -- e) PLANNED stops: clean member with NO in-range visit → associated, not guessed.
  insert into public.trip_stops (trip_id, place_id, status, sort_order)
  select t.id, ch.id, 'planned', 0
  from public.trips t
  join public.place_membership m on m.parent_id = t.source_place_id
  join public.places ch on ch.id = m.child_id
  where t.source_place_id is not null
    and ch.deleted_at is null and not ch.suggested and ch.saved
    and ch.category <> 'trip' and not coalesce(ch.holds_children,false)
    and not exists (select 1 from public.visits v where v.place_id = ch.id
                    and v.start_date >= t.start_date and v.start_date <= t.end_date)
    and not exists (select 1 from public.trip_stops s
                    where s.trip_id = t.id and s.place_id = ch.id and s.visit_id is null);
end $$;
revoke execute on function public.migrate_container_place_trips() from anon, public;

select public.migrate_container_place_trips();

-- 9) EXPLICIT membership read (no date-range), member-gated + draft-private.
create or replace function public.trip_place_ids(p_trip uuid)
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select distinct s.place_id
  from public.trip_stops s
  join public.places p on p.id = s.place_id
  where s.trip_id = p_trip
    and public.is_member()
    and p.deleted_at is null and p.saved and not p.suggested;  -- draft-private
$$;
revoke execute on function public.trip_place_ids(uuid) from anon, public;
grant execute on function public.trip_place_ids(uuid) to authenticated;

-- 10) Stats ONLY from linked, visible, completed data (never date-range household
--     activity). Miles = activities of a completed stop's place dated within that
--     stop's linked visit.
create or replace function public.trip_stats(p_trip uuid)
returns json language sql stable security definer set search_path = public
as $$
  with completed as (
    select s.place_id, s.visit_id, v.start_date, v.end_date
    from public.trip_stops s
    join public.visits v on v.id = s.visit_id
    join public.places p on p.id = s.place_id
    where s.trip_id = p_trip and s.status = 'completed'
      and p.deleted_at is null and p.saved and not p.suggested
  )
  select case when public.is_member() then json_build_object(
    'places',  (select count(distinct place_id) from completed),
    'visits',  (select count(*) from completed),
    -- Each Activity counted at most ONCE even if it falls in overlapping Visits.
    'miles',   (select coalesce(round(sum(d.distance) / 1609.344), 0) from (
                  select distinct a.id, a.distance
                  from public.activities a
                  join completed c on c.place_id = a.place_id
                  where a.start_date is not null
                    and a.start_date::date >= c.start_date and a.start_date::date <= c.end_date
                ) d),
    'days',    (select (end_date - start_date) + 1 from public.trips where id = p_trip)
  ) else null end;
$$;
revoke execute on function public.trip_stats(uuid) from anon, public;
grant execute on function public.trip_stats(uuid) to authenticated;
