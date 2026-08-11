-- 0159 — Trips is DERIVED from the dates, the way §2 says it is.
--
-- §2, locked: "A VISIT for more than one day counts as a TRIP in the stats bar, but
-- nothing needs to be labelled as a trip." The stats bar was still counting the stored
-- `is_trip` flag instead, so a five-day visit you never thought to mark counted as
-- nothing. That is the derived-vs-source bug again: one fact (this visit spans days)
-- stored twice, and the number reading the copy.
--
-- TWO OF ERICA'S RULES COLLIDE HERE, so this counts BOTH:
--
--   §2 says a multi-day visit IS a trip                    -> count every multi-day visit
--   "manual work is NEVER undone by automation" (0157)     -> keep the ones she marked
--
-- There are visits marked is_trip on a SINGLE day, by hand (manual = true). Deriving
-- purely from the dates would silently uncount them — an automation erasing a human
-- decision, which is the exact thing 0157 exists to prevent. So: a trip is a visit
-- spanning more than one day, OR one a person deliberately marked. Nothing is erased,
-- and nothing has to be labelled.
--
-- Erica: if you want those hand-marked single-day visits to stop counting, unmark them
-- and the number follows. The rule stays the same either way.
--
-- ROLLBACK: recreate wander_stats from 0141 (the only change is the trips_count line
-- and the extra columns carried in `qv`).

create or replace function public.wander_stats(p_profile uuid default null)
returns table(places_count integer, miles double precision, trips_count integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  with qv as (
    select v.place_id, v.is_trip, v.start_date, v.end_date
      from public.visits v
     where case when p_profile is null
                then v.solo_profile is null
                else (v.solo_profile is null or v.solo_profile = p_profile) end
       and v.status = 'taken'
  ),
  qa as (
    select distinct on (coalesce(a.shared_group_id, a.id)) a.id, a.distance
      from public.activities a
     where a.place_id is not null
       and case when p_profile is null
                then a.solo_profile is null
                else (a.solo_profile is null or a.solo_profile = p_profile) end
     order by coalesce(a.shared_group_id, a.id),
              (a.summary_polyline is not null) desc,
              (a.source = 'strava') desc,
              a.id
  )
  select
    (select count(distinct p.id)::int
       from public.places p join qv on qv.place_id = p.id
      where p.counts_as_place)                                     as places_count,
    (select coalesce(sum(qa.distance),0)/1609.344 from qa)         as miles,
    -- More than one day, or marked by hand. Never both-counted: it is one visit.
    (select count(*)::int from qv
      where coalesce(qv.end_date, qv.start_date) > qv.start_date
         or qv.is_trip)                                            as trips_count;
$function$;
