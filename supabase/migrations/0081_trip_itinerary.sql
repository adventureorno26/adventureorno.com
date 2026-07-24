-- 0081_trip_itinerary.sql — day-by-day trip itinerary. Two parts:
--   trip_timeline(trip): AUTO timeline built from what actually happened — every
--     activity + spot/entry across the trip's member places, grouped by day.
--   trip_notes: MANUAL plan notes you add on top, per day.

create table if not exists public.trip_notes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.places(id) on delete cascade,
  day date not null,
  note text not null,
  created_at timestamptz not null default now()
);
create index if not exists trip_notes_trip on public.trip_notes(trip_id, day);
alter table public.trip_notes enable row level security;
drop policy if exists trip_notes_select on public.trip_notes;
create policy trip_notes_select on public.trip_notes for select using (public.is_member());
drop policy if exists trip_notes_write on public.trip_notes;
create policy trip_notes_write on public.trip_notes
  for all using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());

-- Auto timeline: activities + spots across the trip's members (part_of the trip
-- OR inside its boundary) and the trip's own rows, one row per item, by day.
create or replace function public.trip_timeline(p_trip uuid)
returns table(day date, kind text, title text, sub text, place_id uuid)
language sql stable security definer set search_path = public as $$
  with mem as (
    select id, name from public.places
    where id = p_trip or p_trip = any(part_of)
       or exists (select 1 from public.places c where c.id = p_trip
                  and c.boundary is not null and public.places.geom is not null
                  and st_contains(c.boundary::geometry, public.places.geom::geometry))
  )
  select a.start_date::date as day, 'activity' as kind,
         coalesce(nullif(a.name,''), a.type) as title,
         a.type || ' · ' || round((a.distance/1609.344)::numeric,1) || ' mi'
           || coalesce(' · ' || m.name, '') as sub,
         a.place_id
  from public.activities a join mem m on m.id = a.place_id
  where a.start_date is not null
  union all
  select e.date::date, 'spot', e.title, m.name, e.place_id
  from public.entries e join mem m on m.id = e.place_id
  where e.date is not null
  order by day, kind;
$$;
grant execute on function public.trip_timeline(uuid) to authenticated;

create or replace function public.add_trip_note(p_trip uuid, p_day date, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  insert into public.trip_notes (trip_id, day, note) values (p_trip, p_day, btrim(p_note))
    returning id into v_id;
  return v_id;
end $$;
grant execute on function public.add_trip_note(uuid, date, text) to authenticated;

create or replace function public.delete_trip_note(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  delete from public.trip_notes where id = p_id;
end $$;
grant execute on function public.delete_trip_note(uuid) to authenticated;
