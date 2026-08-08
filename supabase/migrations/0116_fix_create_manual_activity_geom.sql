-- 0116 — Fix create_manual_activity: stop writing the generated geom column, and
-- validate coordinates (Prompt 3).
--
-- activities.geom is GENERATED ALWAYS AS (st_setsrid(st_makepoint(lng,lat),4326)
-- ::geography). create_manual_activity still listed `geom` in its INSERT with an
-- explicit value, which Postgres rejects ("cannot insert a non-DEFAULT value into
-- column geom") — so the map's draw-a-trail / manual-activity flow was throwing on
-- every call. Remove geom from the insert (the column computes itself from lat/lng)
-- and reject out-of-range coordinates.
--
-- ROLLBACK: recreate the prior definition (it re-introduces the broken geom insert).

create or replace function public.create_manual_activity(
  p_name text, p_type text, p_place uuid, p_polyline text,
  p_distance double precision, p_lat double precision, p_lng double precision,
  p_date timestamp with time zone)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare new_id uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if (p_lat is not null and (p_lat < -90 or p_lat > 90))
     or (p_lng is not null and (p_lng < -180 or p_lng > 180)) then
    raise exception 'invalid coordinates';
  end if;
  -- geom is a generated column — never inserted; it derives from lat/lng.
  insert into public.activities
    (strava_id, type, name, distance, start_date, lat, lng, place_id, summary_polyline)
  values
    (null, p_type, p_name, coalesce(p_distance, 0), p_date, p_lat, p_lng, p_place, p_polyline)
  returning id into new_id;
  if p_place is not null then perform public.recompute_place_stats(p_place); end if;
  return new_id;
end
$function$;
