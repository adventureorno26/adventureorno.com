-- 0134 — A trip is ONE occasion, and it contains the places you went to inside it.
--
-- Erica: "A trip will contain several other places. Cape Cod was a trip during which
-- we visited Linnell Landing. it's also a place." And: "I want it to be the week was
-- one occasion, and the beach and restaurant still count as places but not as extra
-- visits."
--
-- THE RULE
--   Cape Cod is a place AND the trip you took there. Linnell Landing is a place you
--   visited during it. Both count as PLACES, once each, forever. But the week is ONE
--   occasion, so the beach and the restaurant do not add to the headline visit count.
--
--   A visit is "inside a trip" purely by DATE: it falls within the window of some
--   other visit that a person marked as a trip. Nothing is stored, so nothing can
--   drift out of sync — mark a visit as a trip and it gains contents; unmark it and
--   they go back to standing on their own. Every previous version of this stored the
--   relationship (trip_stops, part_of, suggested trips) and every one of them drifted.
--
--   Deliberately NOT nested by location. A trip's contents are what happened during
--   it; only 4 of 132 places have a boundary, so a spatial rule would silently fail
--   to nest most things.
--
-- WHAT COUNTS
--   Places    every place with a qualifying visit, counted once — including the ones
--             inside a trip. Cape Cod, Linnell and the restaurant are 3 places.
--   Visits    OCCASIONS: visits not contained by a trip. That week is 1.
--   Trips     visits marked is_trip. Never counted a second time on top of the visit.
--   A place's OWN card still lists all of its own visits — Linnell says 1 visit, and
--   the W&OD says 40, because each hike is a visit to the W&OD.

-- Is this visit inside somebody's marked trip? Self-containment doesn't count, and
-- a trip is never contained by another trip (the outer one is the occasion).
create or replace function public.visit_is_inside_trip(p_visit uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.visits v
      join public.visits t
        on t.is_trip
       and t.id <> v.id
       and v.start_date >= t.start_date
       and v.end_date   <= t.end_date
     where v.id = p_visit
       and not v.is_trip
  );
$function$;

-- The places you went to during a trip — the trip's contents, derived from dates.
-- Excludes the trip's own place: Cape Cod is the trip, not something inside it.
create or replace function public.trip_contents(p_visit uuid)
returns table (place_id uuid, place_name text, visit_id uuid, start_date date, end_date date)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select p.id, p.name, v.id, v.start_date, v.end_date
    from public.visits t
    join public.visits v
      on v.id <> t.id
     and v.start_date >= t.start_date
     and v.end_date   <= t.end_date
    join public.places p on p.id = v.place_id
   where t.id = p_visit
     and t.is_trip
     and v.place_id <> t.place_id
   order by v.start_date, p.name;
$function$;

-- Occasions for a view: what the headline "Visits" number shows.
create or replace function public.occasion_count(p_profile uuid default null)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select count(*)::int
    from public.visits v
   where case when p_profile is null
              then v.solo_profile is null
              else (v.solo_profile is null or v.solo_profile = p_profile) end
     and v.status = 'taken'
     -- a visit inside a marked trip folds into that trip
     and not exists (
       select 1 from public.visits t
        where t.is_trip
          and t.id <> v.id
          and v.start_date >= t.start_date
          and v.end_date   <= t.end_date
          and not v.is_trip
     );
$function$;

revoke all on function public.visit_is_inside_trip(uuid) from public;
revoke all on function public.visit_is_inside_trip(uuid) from anon;
grant execute on function public.visit_is_inside_trip(uuid) to authenticated;
grant execute on function public.visit_is_inside_trip(uuid) to service_role;

revoke all on function public.trip_contents(uuid) from public;
revoke all on function public.trip_contents(uuid) from anon;
grant execute on function public.trip_contents(uuid) to authenticated;
grant execute on function public.trip_contents(uuid) to service_role;

revoke all on function public.occasion_count(uuid) from public;
revoke all on function public.occasion_count(uuid) from anon;
grant execute on function public.occasion_count(uuid) to authenticated;
grant execute on function public.occasion_count(uuid) to service_role;
