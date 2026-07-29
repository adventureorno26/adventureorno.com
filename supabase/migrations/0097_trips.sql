-- 0097 — Trips: first-class named date-range entity (ADR 0001, Option A).
--
-- A Trip is a planning + journal container. Places "belong" to a trip when their
-- first_visit falls in the trip's date range (computed, not stored) — see
-- app/src/lib/trips.ts. This ADDITIVE migration adds the table + RLS + the
-- trip_stats RPC that trips.ts already calls. It does NOT migrate the existing
-- container-Place trips (category='trip') — those remain a compatibility
-- representation until the UI is switched over (a later, data-migration step).
--
-- Roles: members read; editors/owners write. Follows the app's is_member /
-- is_editor_or_owner helpers. Consistent with the 0093 discipline, the SECURITY
-- DEFINER RPC is revoked from anon/PUBLIC.
--
-- VERIFY on the disposable local stack (never production).
-- ROLLBACK:
--   drop function if exists public.trip_stats(uuid);
--   drop table if exists public.trips;   -- (cascades its policies)

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date,
  end_date date,
  status text not null default 'taken' check (status in ('taken', 'upcoming')),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.trips enable row level security;

drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips
  for select using (public.is_member());

drop policy if exists trips_insert on public.trips;
create policy trips_insert on public.trips
  for insert with check (public.is_editor_or_owner());

drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips
  for update using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());

drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips
  for delete using (public.is_editor_or_owner());

-- Aggregate stats for a trip: places/visits/miles over the places whose
-- first_visit is inside the trip's date range, plus the trip's day span.
create or replace function public.trip_stats(p_trip uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with t as (select start_date, end_date from public.trips where id = p_trip),
  pls as (
    select p.id, p.visit_count
    from public.places p, t
    where p.deleted_at is null
      and p.first_visit is not null
      and t.start_date is not null and t.end_date is not null
      and p.first_visit >= t.start_date and p.first_visit <= t.end_date
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
