-- 0099 — Complete ADR 0001 Option A: trip_stops + migrate the 33 container-Place
-- trips into first-class trips (hybrid membership).
--
-- Model: a Trip's PLANNED stops are explicit trip_stops rows; its visited places
-- also auto-attach by date (places whose first_visit is in the trip's range —
-- kept for compatibility with app/src/lib/trips.ts). Migrating the historical
-- container-Place trips creates one 'completed' stop per curated member.
--
-- ADDITIVE, IDEMPOTENT, REVERSIBLE. Creates a table + a column + rows; deletes
-- nothing. The 33 category='trip' container-Places are NOT removed (they remain a
-- compatibility representation until the UI switches to the trips table).
-- Preflight (read-only prod): 33 trips, 221 trip_stops, 6 empty trips, 1 nested
-- trip (a member that is itself a trip — allowed; recorded as a note).
--
-- VERIFY on a disposable local stack with FICTIONAL data (never production).
-- ROLLBACK:
--   drop function if exists public.trip_place_ids(uuid);
--   -- (trip_stats reverts to its 0097 definition; re-run 0097's trip_stats block)
--   delete from public.trip_stops where trip_id in (select id from public.trips where source_place_id is not null);
--   delete from public.trips where source_place_id is not null;
--   drop index if exists trips_source_place_uidx;
--   alter table public.trips drop column if exists source_place_id;
--   drop table if exists public.trip_stops;

-- 1) trip_stops — explicit stops (planned or completed), one per (trip, place).
create table if not exists public.trip_stops (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  status text not null default 'planned' check (status in ('planned', 'completed', 'skipped')),
  sort_order int not null default 0,
  note text,
  created_at timestamptz not null default now(),
  unique (trip_id, place_id)
);

alter table public.trip_stops enable row level security;

drop policy if exists trip_stops_select on public.trip_stops;
create policy trip_stops_select on public.trip_stops for select using (public.is_member());
drop policy if exists trip_stops_insert on public.trip_stops;
create policy trip_stops_insert on public.trip_stops for insert with check (public.is_editor_or_owner());
drop policy if exists trip_stops_update on public.trip_stops;
create policy trip_stops_update on public.trip_stops for update using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());
drop policy if exists trip_stops_delete on public.trip_stops;
create policy trip_stops_delete on public.trip_stops for delete using (public.is_editor_or_owner());

-- 2) Provenance column so the backfill is idempotent + reversible (a trips row
--    migrated from a container-Place records that place's id; manual trips leave
--    it null).
alter table public.trips add column if not exists source_place_id uuid references public.places(id);
create unique index if not exists trips_source_place_uidx
  on public.trips (source_place_id) where source_place_id is not null;

-- 3) Backfill trips from the 33 container-Place trips (idempotent).
insert into public.trips (name, start_date, end_date, status, source_place_id, created_by)
select p.name, p.first_visit, p.last_visit,
       case when p.first_visit > current_date then 'upcoming' else 'taken' end,
       p.id, p.created_by
from public.places p
where p.category = 'trip'
  and not exists (select 1 from public.trips t where t.source_place_id = p.id);

-- 4) Backfill trip_stops from each migrated trip's curated members
--    (place_membership children), marked 'completed', ordered by first_visit.
insert into public.trip_stops (trip_id, place_id, status, sort_order)
select t.id, m.child_id, 'completed',
       (row_number() over (partition by t.id order by ch.first_visit nulls last, ch.name))::int
from public.trips t
join public.place_membership m on m.parent_id = t.source_place_id
join public.places ch on ch.id = m.child_id
where t.source_place_id is not null
  and not exists (
    select 1 from public.trip_stops s where s.trip_id = t.id and s.place_id = m.child_id
  );

-- 5) Compatibility read: a trip's places = explicit trip_stops UNION date-range
--    auto-attach (places whose first_visit is in the trip range). DISTINCT, so a
--    place that is both an explicit stop and in-range is returned once. Works
--    whether a trip has explicit stops, only date-range visits, or both.
create or replace function public.trip_place_ids(p_trip uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with t as (select start_date, end_date from public.trips where id = p_trip)
  select ts.place_id from public.trip_stops ts
    where ts.trip_id = p_trip and public.is_member()
  union
  select p.id
  from public.places p, t
  where public.is_member()
    and p.deleted_at is null
    and coalesce(p.holds_children, false) = false  -- leaves only; a container/trip is never a stop
    and p.first_visit is not null
    and t.start_date is not null and t.end_date is not null
    and p.first_visit >= t.start_date and p.first_visit <= t.end_date;
$$;
revoke execute on function public.trip_place_ids(uuid) from anon, public;
grant execute on function public.trip_place_ids(uuid) to authenticated;

-- 6) Overlap-safe stats: replace the naive date-range trip_stats (0097) with one
--    that counts over the DISTINCT union above, so overlapping trip ranges never
--    double-count a place, and explicit-stop-only trips still get stats.
create or replace function public.trip_stats(p_trip uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with t as (select start_date, end_date from public.trips where id = p_trip),
  pls as (
    select distinct pp.id, pp.visit_count
    from public.trip_place_ids(p_trip) g
    join public.places pp on pp.id = g
    where pp.deleted_at is null
  )
  select case when public.is_member() then json_build_object(
    'places', (select count(*) from pls),
    'visits', (select coalesce(sum(visit_count), 0) from pls),
    'miles',  (select coalesce(round(sum(a.distance) / 1609.344), 0)
               from public.activities a, t
               where a.start_date is not null and t.start_date is not null and t.end_date is not null
                 and a.start_date::date >= t.start_date and a.start_date::date <= t.end_date),
    'days',   (select (t.end_date - t.start_date) + 1 from t)
  ) else null end;
$$;
revoke execute on function public.trip_stats(uuid) from anon, public;
grant execute on function public.trip_stats(uuid) to authenticated;
