-- 0016_visits.sql — explicit visits/trips per place, so the card can show a
-- clean count + list, log a one-tap single-day visit, and delete visits.

create table if not exists public.visits (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,          -- = start_date for a single-day visit
  note        text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists visits_place_idx on public.visits (place_id, start_date desc);

alter table public.visits enable row level security;
drop policy if exists visits_select on public.visits;
create policy visits_select on public.visits for select using (public.is_member());
drop policy if exists visits_write on public.visits;
create policy visits_write on public.visits for all
  using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());

-- Ensure a visit covers p_day for a place: extend an adjacent visit or insert a
-- new single-day one. Runs security definer (called from triggers + backfill).
create or replace function public.ensure_visit(p_place uuid, p_day date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_place is null or p_day is null then return; end if;
  if exists (select 1 from public.visits
              where place_id = p_place and p_day between start_date and end_date) then
    return;
  end if;
  update public.visits set end_date = p_day
    where place_id = p_place and end_date = p_day - 1;
  if found then return; end if;
  update public.visits set start_date = p_day
    where place_id = p_place and start_date = p_day + 1;
  if found then return; end if;
  insert into public.visits (place_id, start_date, end_date) values (p_place, p_day, p_day);
end $$;

-- Keep visits in sync as photos/activities land.
create or replace function public.visit_from_photo() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_visit(NEW.place_id, coalesce(NEW.taken_at::date, NEW.created_at::date));
  return NEW;
end $$;
drop trigger if exists photos_ensure_visit on public.photos;
create trigger photos_ensure_visit after insert or update of place_id on public.photos
  for each row when (NEW.place_id is not null) execute function public.visit_from_photo();

create or replace function public.visit_from_activity() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_visit(NEW.place_id, NEW.start_date::date);
  return NEW;
end $$;
drop trigger if exists activities_ensure_visit on public.activities;
create trigger activities_ensure_visit after insert or update of place_id on public.activities
  for each row when (NEW.place_id is not null and NEW.start_date is not null)
  execute function public.visit_from_activity();

-- Backfill: group each place's existing visit-days into consecutive-day trips.
do $$
declare r record;
begin
  for r in
    with days as (
      select place_id, taken_at::date d from public.photos
        where place_id is not null and taken_at is not null
      union select place_id, start_date::date from public.activities
        where place_id is not null and start_date is not null
      union select place_id, recorded_at::date from public.location_pings where place_id is not null
      union select place_id, date::date from public.entries
        where place_id is not null and date is not null
    ),
    distinct_days as (select distinct place_id, d from days),
    islands as (
      select place_id, d,
             d - (row_number() over (partition by place_id order by d))::int as island
        from distinct_days
    )
    select place_id, min(d) as s, max(d) as e from islands group by place_id, island
  loop
    if not exists (select 1 from public.visits
                    where place_id = r.place_id and start_date = r.s and end_date = r.e) then
      insert into public.visits (place_id, start_date, end_date) values (r.place_id, r.s, r.e);
    end if;
  end loop;
end $$;
