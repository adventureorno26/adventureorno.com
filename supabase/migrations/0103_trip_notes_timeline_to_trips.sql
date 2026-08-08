-- 0103 — Re-point the trip itinerary from container-Place ids to canonical trips.id.
--
-- 0081 keyed trip_notes + trip_timeline on a container Place's id (the old
-- "trip = a Place" model). The canonical model has a first-class `trips` table, so
-- the frontend passes a trips.id. This migration re-points both:
--   1. trip_notes.trip_id FK: places(id) -> trips(id), migrating existing rows via
--      trips.source_place_id (production trip_notes = 0 rows, so this is a no-op there).
--   2. trip_timeline(p_trip): now takes a trips.id and resolves member places from
--      trip_stops (the explicit canonical set) instead of part_of / spatial boundary,
--      with member-gating + draft privacy to match trip_place_ids / trip_stats.
-- add_trip_note / delete_trip_note keep their signatures; p_trip is now a trips.id
-- (enforced by the new FK).
--
-- VERIFY on the disposable local stack (never production).
-- ROLLBACK:
--   alter table public.trip_notes drop constraint trip_notes_trip_id_fkey;
--   alter table public.trip_notes add constraint trip_notes_trip_id_fkey
--     foreign key (trip_id) references public.places(id) on delete cascade;
--   (and re-apply 0081's trip_timeline body)

-- 1) Migrate existing notes from container-Place id -> the trips row that was
-- backfilled from that Place (0099 sets trips.source_place_id = the old place id).
update public.trip_notes tn
   set trip_id = t.id
  from public.trips t
 where t.source_place_id = tn.trip_id;

-- Drop any note that still doesn't resolve to a trip (e.g. a quarantined container
-- that never became a trip) so the new FK can be added. No-op on production (0 rows).
delete from public.trip_notes tn
 where not exists (select 1 from public.trips t where t.id = tn.trip_id);

alter table public.trip_notes drop constraint trip_notes_trip_id_fkey;
alter table public.trip_notes
  add constraint trip_notes_trip_id_fkey
  foreign key (trip_id) references public.trips(id) on delete cascade;

-- 2) trip_timeline over a trips.id — members only, draft-private, canonical members.
create or replace function public.trip_timeline(p_trip uuid)
returns table(day date, kind text, title text, sub text, place_id uuid)
language sql stable security definer set search_path = public as $$
  with mem as (
    -- The places explicitly stopped on this trip (canonical membership), filtered
    -- to what the caller may see (draft-private, same rule as trip_place_ids).
    select distinct s.place_id as id, p.name
      from public.trip_stops s
      join public.places p on p.id = s.place_id
     where s.trip_id = p_trip
       and public.is_member()
       and p.deleted_at is null and p.saved and not p.suggested
  )
  select a.start_date::date as day, 'activity' as kind,
         coalesce(nullif(a.name, ''), a.type) as title,
         a.type || ' · ' || round((a.distance / 1609.344)::numeric, 1) || ' mi'
           || coalesce(' · ' || m.name, '') as sub,
         a.place_id
    from public.activities a
    join mem m on m.id = a.place_id
   where a.start_date is not null
  union all
  select e.date::date, 'spot', e.title, m.name, e.place_id
    from public.entries e
    join mem m on m.id = e.place_id
   where e.date is not null
  order by day, kind;
$$;
revoke execute on function public.trip_timeline(uuid) from anon, public;
grant execute on function public.trip_timeline(uuid) to authenticated;
