-- Fix a caller 0137 left pointing at a function it dropped.
--
-- set_visit_dates still ended with `perform public.promote_trip_stops_for_place(...)`.
-- plpgsql resolves that at CALL time, so dropping the function did not fail the
-- migration — it broke the function silently, and set_visit_dates is exactly what
-- the visit-row editor on a place card calls when Erica changes a date. Editing
-- any visit's dates would have raised "function ... does not exist".
--
-- There are no stops to promote any more: a trip is a visit you marked, and
-- marking it is set_visit_is_trip. Recomputing the place's stats is still right.

create or replace function public.set_visit_dates(p_visit uuid, p_start date, p_end date)
returns visits
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.visits;
  v_place uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_visit is null or p_start is null or p_end is null then
    raise exception 'visit id, start and end are all required';
  end if;
  if p_end < p_start then
    raise exception 'a visit cannot end before it starts';
  end if;

  select place_id into v_place from public.visits where id = p_visit;
  if v_place is null then
    raise exception 'visit % not found', p_visit;
  end if;

  update public.visits
     set start_date = p_start,
         end_date   = p_end,
         manual     = true          -- survives every future rebuild
   where id = p_visit
  returning * into v_row;

  -- Dates changed, so the place's first/last visit and counts must follow.
  perform public.recompute_place_stats(v_place);

  return v_row;
end $function$;
