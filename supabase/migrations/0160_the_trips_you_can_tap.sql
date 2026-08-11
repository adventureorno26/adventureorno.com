-- 0160 — the list behind the Trips number.
--
-- 0159 made the number right. Every other stat in the bar opens when you tap it, so
-- Trips does too: which trips, where, and when — each row opening its visit.
--
-- Same definition as 0159, and it MUST stay that way: more than one day, or marked by
-- hand. If the two ever disagree the number and the list disagree, which is how "where
-- did it go" starts.
--
-- ROLLBACK: drop function public.trips_list(uuid);

create or replace function public.trips_list(p_profile uuid default null)
returns table(
  visit_id uuid,
  place_id uuid,
  name text,
  start_date date,
  end_date date,
  nights integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select v.id, p.id, p.name, v.start_date,
         coalesce(v.end_date, v.start_date) as end_date,
         (coalesce(v.end_date, v.start_date) - v.start_date)::int as nights
    from public.visits v
    join public.places p on p.id = v.place_id
   where v.status = 'taken'
     and case when p_profile is null
              then v.solo_profile is null
              else (v.solo_profile is null or v.solo_profile = p_profile) end
     -- the same rule as wander_stats: more than one day, or marked by hand
     and (coalesce(v.end_date, v.start_date) > v.start_date or v.is_trip)
   order by v.start_date desc;
$function$;

revoke all on function public.trips_list(uuid) from public;
grant execute on function public.trips_list(uuid) to authenticated;
