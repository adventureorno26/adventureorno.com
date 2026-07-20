-- Let owner/editor save a hand-drawn trail as an activity (no Strava). Activities
-- have no client INSERT policy by design, so this runs SECURITY DEFINER, mirrors
-- the shape of a Strava row (strava_id null), and recomputes the place's stats.
create or replace function public.create_manual_activity(
  p_name text,
  p_type text,
  p_place uuid,
  p_polyline text,
  p_distance double precision,
  p_lat double precision,
  p_lng double precision,
  p_date timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized';
  end if;
  insert into public.activities
    (strava_id, type, name, distance, start_date, lat, lng, geom, place_id, summary_polyline)
  values
    (null, p_type, p_name, coalesce(p_distance, 0), p_date, p_lat, p_lng,
     st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_place, p_polyline)
  returning id into new_id;
  if p_place is not null then perform public.recompute_place_stats(p_place); end if;
  return new_id;
end $$;

grant execute on function public.create_manual_activity(
  text, text, uuid, text, double precision, double precision, double precision, timestamptz
) to authenticated;
