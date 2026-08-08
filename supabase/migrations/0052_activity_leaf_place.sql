-- 0052_activity_leaf_place.sql — §2 code: an activity gets its OWN leaf place at
-- its START point. No more 30 km nearest-pin snapping (the Ashburn→Purcellville
-- bug). Same-start-point activities collapse onto one place (§5a: returning adds
-- a visit, not a new place).

-- Map a raw activity type to a category slug (matches the app's category vocab).
drop function if exists public.activity_category(text);
create or replace function public.activity_category(p_type text)
returns text language sql immutable as $$
  select case lower(coalesce(p_type,''))
    when 'hike' then 'hiking' when 'walk' then 'walking' when 'run' then 'running'
    when 'ride' then 'biking' when 'bike' then 'biking' when 'cycling' then 'biking'
    when 'jeep' then 'jeeping' else null end;
$$;

-- Return the leaf place an activity at (lat,lng) belongs to: reuse an existing
-- leaf within 150 m (so repeat outings from the same trailhead share one place +
-- many visits), else create a new leaf place at that exact point. NEVER snaps to
-- a far container/city pin.
create or replace function public.place_for_activity(
  p_lat double precision, p_lng double precision, p_type text, p_name text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_place uuid; v_cat text;
begin
  if p_lat is null or p_lng is null then return null; end if;
  v_cat := public.activity_category(p_type);

  -- Reuse a nearby leaf place (not a container/city/trail/trip rollup).
  select id into v_place from public.places
   where kind = 'leaf' and not holds_children and lat is not null
     and st_dwithin(geom, st_setsrid(st_makepoint(p_lng, p_lat),4326)::geography, 150)
   order by st_distance(geom, st_setsrid(st_makepoint(p_lng, p_lat),4326)::geography)
   limit 1;
  if v_place is not null then return v_place; end if;

  -- Otherwise a new leaf place at the start point.
  insert into public.places (name, lat, lng, saved, auto, needs_geocode, kind,
                             category, categories)
  values (coalesce(nullif(trim(p_name),''), 'Activity spot'), p_lat, p_lng, true, true, true,
          'leaf', v_cat, case when v_cat is null then '{}'::text[] else array[v_cat] end)
  returning id into v_place;
  return v_place;
end $$;
grant execute on function public.place_for_activity(double precision,double precision,text,text) to authenticated, service_role;

-- Repoint file import to the new leaf-at-start logic.
create or replace function import_file_activity(
  p_name text, p_type text, p_polyline text, p_distance double precision,
  p_moving integer, p_lat double precision, p_lng double precision, p_date timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_place uuid; v_id uuid;
begin
  -- Same-person dedup (±5 min, ±2% distance) — unchanged intent.
  select id into v_id from public.activities
   where owner_profile = v_me and source = 'file'
     and abs(extract(epoch from (start_date - p_date))) < 300
     and abs(coalesce(distance,0) - coalesce(p_distance,0)) < greatest(50, coalesce(p_distance,0)*0.02)
   limit 1;
  if v_id is not null then return v_id; end if;

  v_place := public.place_for_activity(p_lat, p_lng, p_type, p_name);
  insert into public.activities
    (strava_id, type, name, distance, moving_time, start_date, lat, lng, geom,
     place_id, summary_polyline, source, owner_profile)
  values
    (null, p_type, p_name, coalesce(p_distance, 0), p_moving, p_date, p_lat, p_lng,
     st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, v_place, p_polyline, 'file', v_me)
  returning id into v_id;
  if v_place is not null then
    perform public.recompute_place_stats(v_place);
    perform public.rebuild_place_visits(v_place);
  end if;
  return v_id;
end $$;
grant execute on function import_file_activity(text,text,text,double precision,integer,double precision,double precision,timestamptz) to authenticated;
