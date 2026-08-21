-- 0261 — the numbers follow the same people the markers do.
--
-- 0260 gave the map's markers, visit counts and route lines a people-aware sibling. The stats
-- bar sitting on top of that same map did not get one, and six more functions still asked the
-- two-person question:
--
--     wander_stats · mileage_by_person · race_stats · races_list · activities_of_type · trips_list
--
-- Shipping half of it would have produced the exact failure this session has already made
-- twice: **a screen whose markers say one thing and whose numbers say another.** With "Anyone"
-- selected the map would show 135 places while the miles beside them counted only the 54 they
-- had been to together — each correct on its own terms, and the pair of them a lie.
--
-- So all six, and none of them re-implements anything: every one consumes `people_memory_keys`
-- exactly as 0260's three do. The bodies are otherwise untouched.
--
-- EACH REPLACEMENT WAS CHECKED AGAINST THE LIVE DEFINITION rather than assumed, and the check
-- earned itself three times while writing this: `activities_of_type` takes a type argument
-- BEFORE the profile, so the generated signature did not match; its CASE is wrapped across
-- lines differently from the others, so a pattern that fitted them did not fit it; and
-- `wander_stats` has TWO — one over visits and one over activities — so a generator that
-- replaced "the" CASE would have left half the function asking the old question and still
-- compiled. Every time, the build stopped rather than writing a migration that changed most
-- of what it claimed to. An edit that quietly does not apply is the other thing this session
-- has already done twice.
--
-- THE OLD SIX STAY. They take a profile, they are what everything outside the map filter uses,
-- and nothing is repointed here that does not need to be.

create or replace function public.activities_of_type_for_people(p_type text, p_people uuid[], p_mode text default 'all')
 RETURNS TABLE(id uuid, type text, name text, distance double precision, start_date timestamp with time zone, place_id uuid, place_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select a.id, a.type, a.name, a.distance, a.start_date, a.place_id, p.name
    from public.visible_activities a
    left join public.places p on p.id = a.place_id
   where a.type = p_type
     and (coalesce(array_length(p_people, 1), 0) = 0
            or coalesce(a.shared_group_id, a.id) in
                 (select k.key from public.people_memory_keys(p_people, p_mode) k
                   where k.kind = 'outing'))
   order by a.start_date desc nulls last;
$function$
;

create or replace function public.mileage_by_person_for_people(p_people uuid[], p_mode text default 'all')
 RETURNS TABLE(type text, activity_count bigint, meters double precision, miles numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with canon as (
    -- One outing counted once: the same run recorded by two people shares a
    -- shared_group_id (0140/0141).
    select distinct on (coalesce(a.shared_group_id, a.id)) a.type, a.distance
      from public.visible_activities a
     where (coalesce(array_length(p_people, 1), 0) = 0
            or coalesce(a.shared_group_id, a.id) in
                 (select k.key from public.people_memory_keys(p_people, p_mode) k
                   where k.kind = 'outing'))
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select type, count(*)::bigint, coalesce(sum(distance), 0::float8),
    round((coalesce(sum(distance), 0::float8) / 1609.344::float8)::numeric, 1)
  from canon group by type;
$function$
;

create or replace function public.race_stats_for_people(p_people uuid[], p_mode text default 'all')
 RETURNS TABLE(bucket text, n integer, miles double precision, ord integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select b.bucket, count(*)::int as n, coalesce(sum(a.distance),0)/1609.344 as miles,
    case b.bucket when '5K' then 1 when '10K' then 2 when '10 Mile' then 3
                  when 'Half' then 4 when 'Full' then 5 else 6 end as ord
  from public.visible_activities a
  join public.places p on p.id = a.place_id
  cross join lateral (select public.race_bucket(a.distance/1609.344) as bucket) b
  where (a.is_race or p.categories @> array['race'])
    and (coalesce(array_length(p_people, 1), 0) = 0
            or coalesce(a.shared_group_id, a.id) in
                 (select k.key from public.people_memory_keys(p_people, p_mode) k
                   where k.kind = 'outing'))
  group by b.bucket
  order by ord;
$function$
;

create or replace function public.races_list_for_people(p_people uuid[], p_mode text default 'all')
 RETURNS TABLE(id uuid, name text, times integer, miles double precision, bucket text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select p.id, p.name, count(a.*)::int as times,
    coalesce(sum(a.distance),0)/1609.344 as miles,
    public.race_bucket((coalesce(sum(a.distance),0)/1609.344) / nullif(count(a.*),0)) as bucket
  from public.places p
  join public.visible_activities a on a.place_id = p.id
  where (a.is_race or p.categories @> array['race'])
    and (coalesce(array_length(p_people, 1), 0) = 0
            or coalesce(a.shared_group_id, a.id) in
                 (select k.key from public.people_memory_keys(p_people, p_mode) k
                   where k.kind = 'outing'))
  group by p.id, p.name
  having count(a.*) > 0
  order by p.name;
$function$
;

create or replace function public.trips_list_for_people(p_people uuid[], p_mode text default 'all')
 RETURNS TABLE(visit_id uuid, place_id uuid, name text, start_date date, end_date date, nights integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select av.id, p.id, p.name, av.start_date, av.end_date,
         (av.end_date - av.start_date)::int as nights
    from public.accepted_visits av
    join public.places p on p.id = av.place_id
   where av.is_trip_qualified
     and av.is_headline
     and p.deleted_at is null
     and (coalesce(array_length(p_people, 1), 0) = 0
            or av.id in (select k.key from public.people_memory_keys(p_people, p_mode) k
                              where k.kind = 'visit'))
   order by av.start_date desc;
$function$
;

create or replace function public.wander_stats_for_people(p_people uuid[], p_mode text default 'all')
 RETURNS TABLE(places_count integer, miles double precision, trips_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  with qv as (
    select av.id, av.place_id, av.is_trip_qualified, av.is_headline
      from public.accepted_visits av
     where (coalesce(array_length(p_people, 1), 0) = 0
            or av.id in (select k.key from public.people_memory_keys(p_people, p_mode) k
                              where k.kind = 'visit'))
  ),
  qa as (
    select distinct on (coalesce(a.shared_group_id, a.id)) a.id, a.distance
      from public.visible_activities a
     where a.place_id is not null
       and (coalesce(array_length(p_people, 1), 0) = 0
            or coalesce(a.shared_group_id, a.id) in
                 (select k.key from public.people_memory_keys(p_people, p_mode) k
                   where k.kind = 'outing'))
     order by coalesce(a.shared_group_id, a.id),
              (a.summary_polyline is not null) desc,
              (a.source = 'strava') desc,
              a.id
  )
  select
    (select count(distinct p.id)::int
       from public.places p join qv on qv.place_id = p.id
      where p.counts_as_place
        and p.deleted_at is null)                                  as places_count,
    (select coalesce(sum(qa.distance),0)/1609.344 from qa)         as miles,
    (select count(*)::int from qv
      where qv.is_trip_qualified and qv.is_headline)               as trips_count;
$function$
;

revoke all on function public.activities_of_type_for_people(text, uuid[], text) from public, anon;
grant execute on function public.activities_of_type_for_people(text, uuid[], text) to authenticated;
revoke all on function public.mileage_by_person_for_people(uuid[], text) from public, anon;
grant execute on function public.mileage_by_person_for_people(uuid[], text) to authenticated;
revoke all on function public.race_stats_for_people(uuid[], text) from public, anon;
grant execute on function public.race_stats_for_people(uuid[], text) to authenticated;
revoke all on function public.races_list_for_people(uuid[], text) from public, anon;
grant execute on function public.races_list_for_people(uuid[], text) to authenticated;
revoke all on function public.trips_list_for_people(uuid[], text) from public, anon;
grant execute on function public.trips_list_for_people(uuid[], text) to authenticated;
revoke all on function public.wander_stats_for_people(uuid[], text) from public, anon;
grant execute on function public.wander_stats_for_people(uuid[], text) to authenticated;
