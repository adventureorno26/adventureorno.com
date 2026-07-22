-- 0058_fix_import_geom.sql — GPX/TCX/FIT file import was failing for everyone with
-- "cannot insert a non-DEFAULT value into column geom". activities.geom is a
-- GENERATED column (computed from lat/lng); the import RPC must not insert into it.
-- (The Strava edge function already omits geom, which is why sync kept working.)

create or replace function import_file_activity(
  p_name text, p_type text, p_polyline text, p_distance double precision,
  p_moving integer, p_lat double precision, p_lng double precision, p_date timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_place uuid; v_id uuid;
begin
  -- Same-person dedup (±5 min, ±2% distance).
  select id into v_id from public.activities
   where owner_profile = v_me and source = 'file'
     and abs(extract(epoch from (start_date - p_date))) < 300
     and abs(coalesce(distance,0) - coalesce(p_distance,0)) < greatest(50, coalesce(p_distance,0)*0.02)
   limit 1;
  if v_id is not null then return v_id; end if;

  v_place := public.place_for_activity(p_lat, p_lng, p_type, p_name);
  -- NOTE: no geom column here — it is generated from lat/lng automatically.
  insert into public.activities
    (strava_id, type, name, distance, moving_time, start_date, lat, lng,
     place_id, summary_polyline, source, owner_profile)
  values
    (null, p_type, p_name, coalesce(p_distance, 0), p_moving, p_date, p_lat, p_lng,
     v_place, p_polyline, 'file', v_me)
  returning id into v_id;
  if v_place is not null then
    perform public.recompute_place_stats(v_place);
    perform public.rebuild_place_visits(v_place);
  end if;
  return v_id;
end $$;
grant execute on function import_file_activity(text,text,text,double precision,integer,double precision,double precision,timestamptz) to authenticated;
