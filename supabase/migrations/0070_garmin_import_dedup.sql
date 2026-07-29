-- 0070_garmin_import_dedup.sql — Erica is importing Garmin activities on top of
-- her existing Strava + file history. Two fixes to import_file_activity:
--   1. DEDUP against ALL of the uploader's activities (Strava OR file), not just
--      prior file imports. Garmin and Strava record the SAME physical runs, so
--      without this every already-synced run would double. Match = same uploader,
--      start within 5 min, distance within ~2%. No type check (Garmin's "Workout"
--      wouldn't match Strava's "Run"; two activities can't overlap in time anyway).
--      Only the uploader's own rows are candidates, so a run Josh recorded
--      separately is never wrongly skipped.
--   2. LABELING by the Dec-21-2025 cutoff: the uploader's own PRE-cutoff work is
--      theirs (Erica's Garmin before the cutoff → Just Erica; Josh's → Just Josh);
--      ON/AFTER the cutoff → Both (null), per the established cutoff rule.

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
  -- Dedup: same person, same physical outing (≤5 min apart, ≤2% distance delta).
  select id into v_id from public.activities
   where owner_profile = v_me
     and abs(extract(epoch from (start_date - p_date))) < 300
     and abs(coalesce(distance,0) - coalesce(p_distance,0))
           < greatest(50, coalesce(p_distance,0) * 0.02)
   limit 1;
  if v_id is not null then return v_id; end if;

  v_place := public.place_for_activity(p_lat, p_lng, p_type, p_name);
  -- geom is generated from lat/lng — do NOT insert it.
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
