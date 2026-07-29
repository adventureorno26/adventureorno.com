-- 0102 — Remove the home-exclusion zone everywhere in the database.
--
-- The 15-mile "home zone" around Leesburg is gone: nothing near home is dropped at
-- ingest, nothing is rolled into a single "home" place, and the setting is deleted.
-- Client, Worker, and edge-function enforcement are removed in the same change.
--
-- This migration:
--   1. Deletes the `home_zone` settings row.
--   2. Redefines cluster_unassigned() with the in-zone exclusion filter removed
--      (identical to 0014 otherwise).
--   3. Redefines assign_activity_place() to place every activity normally (drops the
--      "inside the zone -> single home place" branch; keeps nearest-within-30km).
--   4. Dissolves the existing single "home" place: re-scatters its activities to
--      their own places (so every local run/walk/hike is counted + visible), then
--      clears is_home and deletes the place if nothing remains on it.
--
-- ROLLBACK: re-seed settings ('home_zone', {lat,lng,radius_m:24140}) and re-apply the
-- 0014 / 0007 function bodies. The re-scattered activities are not automatically
-- re-collapsed. No rows are deleted except an emptied home place.

-- 1) Delete the setting so no code path can read a radius again.
delete from public.settings where key = 'home_zone';

-- 2) cluster_unassigned() without the home-zone exclusion.
create or replace function public.cluster_unassigned()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_started   timestamptz := now();
  v_eps       double precision;
  v_points    integer := 0;
  v_created   integer := 0;
  v_attached  integer := 0;
  rec         record;
  v_place_id  uuid;
  v_touched   uuid[] := '{}';
  v_summary   jsonb;
begin
  v_eps := 10000.0 / 111320.0;

  drop table if exists _pts;
  drop table if exists _clustered;
  drop table if exists _dwell;

  -- Dwell detection: cluster recent unassigned pings at ~150m; keep only clusters
  -- that look like a stop (≥2 pings spanning ≥10 min). Drive-by pings drop out.
  create temp table _dwell on commit drop as
  with recent as (
    select id, lng, lat, recorded_at,
           st_setsrid(st_makepoint(lng, lat), 4326) as g
      from public.location_pings
     where place_id is null and recorded_at > now() - interval '14 days'
  ),
  clustered as (
    select id, lng, lat, recorded_at,
           st_clusterdbscan(g, eps := 150.0 / 111320.0, minpoints := 2) over () as pc
      from recent
  ),
  keep as (
    select pc
      from clustered
     where pc is not null
     group by pc
    having count(*) >= 2
       and max(recorded_at) - min(recorded_at) >= interval '10 minutes'
  )
  select c.id, c.lng, c.lat
    from clustered c
    join keep k on k.pc = c.pc;

  -- Candidate points: all unassigned photos + only dwell pings. No location filter.
  create temp table _pts on commit drop as
    select 'photo'::text as kind, id, lng, lat,
           st_setsrid(st_makepoint(lng, lat), 4326) as g
      from public.photos where place_id is null
    union all
    select 'ping', id, lng, lat, st_setsrid(st_makepoint(lng, lat), 4326)
      from _dwell;

  select count(*) into v_points from _pts;

  create temp table _clustered on commit drop as
    select kind, id, lng, lat,
           st_clusterdbscan(g, eps := v_eps, minpoints := 1) over () as cid
      from _pts;

  for rec in
    select cid, avg(lat) as clat, avg(lng) as clng
      from _clustered
     group by cid
  loop
    select id into v_place_id
      from public.places
     where st_dwithin(geom,
             st_setsrid(st_makepoint(rec.clng, rec.clat), 4326)::geography, 10000)
     order by st_distance(geom,
             st_setsrid(st_makepoint(rec.clng, rec.clat), 4326)::geography)
     limit 1;

    if v_place_id is null then
      insert into public.places (name, lat, lng, auto, needs_geocode)
      values ('Unnamed place', rec.clat, rec.clng, true, true)
      returning id into v_place_id;
      v_created := v_created + 1;
    else
      v_attached := v_attached + 1;
    end if;

    update public.photos set place_id = v_place_id
      where id in (select id from _clustered where cid = rec.cid and kind = 'photo');
    update public.location_pings set place_id = v_place_id
      where id in (select id from _clustered where cid = rec.cid and kind = 'ping');

    v_touched := array_append(v_touched, v_place_id);
  end loop;

  perform public.recompute_place_stats(pid) from unnest(v_touched) as pid;

  v_summary := jsonb_build_object(
    'points', v_points, 'clusters_created', v_created,
    'clusters_attached', v_attached, 'places_touched', coalesce(array_length(v_touched, 1), 0));

  insert into public.job_runs (job, started_at, finished_at, summary)
  values ('cluster_unassigned', v_started, now(), v_summary);

  return v_summary;
end;
$function$;

-- 3) assign_activity_place() — place every activity normally (no home rollup).
create or replace function public.assign_activity_place(p_lat float8, p_lng float8)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_place uuid;
begin
  -- Nearest existing place within 30 km, else create one. No home-zone special case.
  select id into v_place
    from public.places
   where st_dwithin(geom, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, 30000)
   order by st_distance(geom, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)
   limit 1;
  if v_place is null then
    insert into public.places (name, lat, lng, auto, needs_geocode)
    values ('Unnamed place', p_lat, p_lng, true, true)
    returning id into v_place;
  end if;
  return v_place;
end;
$$;

-- 4) Dissolve the single "home" place so local runs/walks/hikes stand on their own.
do $$
declare
  r        record;
  v_home   uuid;
  v_new    uuid;
  v_touched uuid[] := '{}';
begin
  for v_home in select id from public.places where is_home loop
    -- Give each activity its own leaf place (type-aware placement, home-agnostic now).
    for r in select id, lat, lng, type, name from public.activities where place_id = v_home loop
      v_new := public.place_for_activity(r.lat, r.lng, r.type, r.name);
      if v_new is not null and v_new <> v_home then
        update public.activities set place_id = v_new where id = r.id;
        v_touched := array_append(v_touched, v_new);
      end if;
    end loop;
    v_touched := array_append(v_touched, v_home);
  end loop;

  perform public.recompute_place_stats(pid) from unnest(v_touched) as pid
    where exists (select 1 from public.places where id = pid);
  perform public.rebuild_place_visits(pid) from unnest(v_touched) as pid
    where exists (select 1 from public.places where id = pid);

  -- Keep (un-flag) any home place that still holds photos/pings/visits/activities;
  -- delete the ones left empty by the re-scatter.
  update public.places set is_home = false
   where is_home
     and (exists (select 1 from public.activities a where a.place_id = places.id)
       or exists (select 1 from public.photos ph where ph.place_id = places.id)
       or exists (select 1 from public.location_pings lp where lp.place_id = places.id)
       or exists (select 1 from public.visits v where v.place_id = places.id));
  delete from public.places where is_home;
end $$;
