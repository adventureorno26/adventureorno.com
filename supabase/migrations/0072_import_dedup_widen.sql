-- 0072_import_dedup_widen.sql — the 0070 dedup keyed on distance within 2%, but
-- Garmin and Strava record the SAME run with GPS-variance distances up to ~5%
-- apart (19.5 vs 20.2 mi), so ~60 dups slipped through. Widen: a match is the
-- same uploader with a start within 10 min AND EITHER distance within 6% OR the
-- same activity type. One person can't start two same-type activities within
-- 10 min, so type+time alone is a safe duplicate signal; the distance arm still
-- catches a Garmin "Workout" whose type label differs from Strava's "Run".

create or replace function public.import_file_activity(
  p_name text, p_type text, p_polyline text, p_distance double precision,
  p_moving integer, p_lat double precision, p_lng double precision,
  p_date timestamp with time zone
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_place uuid;
  v_id uuid;
  v_cutoff constant date := '2025-12-21';
begin
  select id into v_id from public.activities
   where owner_profile = v_me
     and abs(extract(epoch from (start_date - p_date))) < 600
     and (
       type = p_type
       or abs(coalesce(distance,0) - coalesce(p_distance,0))
            < greatest(80, coalesce(p_distance,0) * 0.06)
     )
   limit 1;
  if v_id is not null then return v_id; end if;

  v_place := public.place_for_activity(p_lat, p_lng, p_type, p_name);
  insert into public.activities
    (strava_id, type, name, distance, moving_time, start_date, lat, lng,
     place_id, summary_polyline, source, owner_profile, solo_profile)
  values
    (null, p_type, p_name, coalesce(p_distance, 0), p_moving, p_date, p_lat, p_lng,
     v_place, p_polyline, 'file', v_me,
     case when p_date < v_cutoff then v_me else null end)
  returning id into v_id;

  if v_place is not null then
    perform public.recompute_place_stats(v_place);
    perform public.rebuild_place_visits(v_place);
  end if;
  return v_id;
end $$;
