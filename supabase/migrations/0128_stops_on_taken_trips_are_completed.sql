-- 0128 — A stop on a trip you already took is a visit, not a plan.
--
-- Erica: "it looks right except Annabelle's says it is a planned visit when it is
-- one we already made."
--
-- WHY IT WAS STUCK. `trip_stops_completed_needs_visit` requires
--     (status = 'completed') = (visit_id is not null)
-- so a stop can only be completed if it carries a visit, and
-- `promote_trip_stops_for_place` only promotes when the place already has a visit
-- inside the trip window. "Annabelle's On The Beach" has no photos of its own — all
-- 19 Barbados photos are attached to the Paynes Bay destination — so it had no
-- visit, could not be promoted, and stayed "planned" forever despite the Barbados
-- trip being marked taken. It was the only such stop; every other one completed.
--
-- THE RULE. A stop on a trip whose status is 'taken' is something that HAPPENED. If
-- its place has no visit overlapping the trip window, record one for the trip dates
-- and complete the stop. Trips still 'upcoming' are left alone — those really are
-- plans.
--
-- The created visit is manual = true, and that is essential rather than cosmetic:
-- the place has no photos/activities/pings of its own, so `rebuild_place_visits`
-- derives no days for it and would DELETE a non-manual visit the next time anything
-- touched the place. The flag is what makes the record survive.
--
-- Attribution follows the existing inference: the visit is left unattributed
-- (solo_profile null = "Both") for post-cutoff dates, which is what rebuild would
-- have inferred for a 2026 stay.

create or replace function public.complete_stops_on_taken_trips()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_visit uuid;
  v_count integer := 0;
  v_cutoff constant date := '2025-12-21';
  v_erica uuid := (select id from public.profiles where role = 'owner'
                   and coalesce(display_name,'') !~* '(test|bot)' limit 1);
begin
  for r in
    select s.id as stop_id, s.place_id, t.start_date, t.end_date
      from public.trip_stops s
      join public.trips t on t.id = s.trip_id
     where t.status = 'taken'
       and s.status = 'planned'
       and t.start_date is not null
       and t.end_date is not null
       and not exists (
         select 1 from public.visits v
          where v.place_id = s.place_id
            and v.start_date <= t.end_date
            and v.end_date   >= t.start_date)
  loop
    insert into public.visits (place_id, start_date, end_date, manual, solo_profile, solo_override)
    values (
      r.place_id, r.start_date, r.end_date, true,
      case when r.start_date < v_cutoff then v_erica else null end,
      false)
    returning id into v_visit;

    update public.trip_stops
       set status = 'completed', visit_id = v_visit
     where id = r.stop_id;

    perform public.recompute_place_stats(r.place_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end $function$;

revoke all on function public.complete_stops_on_taken_trips() from public;
revoke all on function public.complete_stops_on_taken_trips() from anon;
grant execute on function public.complete_stops_on_taken_trips() to authenticated;
grant execute on function public.complete_stops_on_taken_trips() to service_role;

-- Apply it to the existing data.
select public.complete_stops_on_taken_trips();
