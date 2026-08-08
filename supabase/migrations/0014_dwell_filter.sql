-- 0014_dwell_filter.sql — stop creating places from drive-by GPS pings.
--
-- Before: cluster_unassigned() fed EVERY unassigned ping into the 10km cluster
-- with minpoints=1, so a single passing ping while driving spawned a place.
-- After: a ping only counts if it belongs to a DWELL — a tight spatial cluster
-- (≤150m) of ≥2 pings spanning ≥10 minutes (i.e. she actually stopped there).
-- Photos always count (a photo is deliberate presence). Everything else in the
-- function is unchanged.
create or replace function public.cluster_unassigned()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_started   timestamptz := now();
  v_home      record;
  v_eps       double precision;
  v_points    integer := 0;
  v_created   integer := 0;
  v_attached  integer := 0;
  rec         record;
  v_place_id  uuid;
  v_touched   uuid[] := '{}';
  v_summary   jsonb;
begin
  select (value->>'lat')::float8   as lat,
         (value->>'lng')::float8   as lng,
         (value->>'radius_m')::float8 as radius_m
    into v_home
    from public.settings where key = 'home_zone';

  v_eps := 10000.0 / 111320.0;

  drop table if exists _pts;
  drop table if exists _clustered;
  drop table if exists _dwell;

  -- Dwell detection: cluster recent unassigned pings at ~150m; keep only clusters
  -- that look like a stop (≥2 pings spanning ≥10 min). Drive-by pings are sparse
  -- in any 150m cell and never span 10 min there, so they drop out as noise.
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

  -- Candidate points: all unassigned photos + only dwell pings.
  create temp table _pts on commit drop as
    select 'photo'::text as kind, id, lng, lat,
           st_setsrid(st_makepoint(lng, lat), 4326) as g
      from public.photos where place_id is null
    union all
    select 'ping', id, lng, lat, st_setsrid(st_makepoint(lng, lat), 4326)
      from _dwell;

  if v_home.radius_m is not null then
    delete from _pts p
     where st_dwithin(
       p.g::geography,
       st_setsrid(st_makepoint(v_home.lng, v_home.lat), 4326)::geography,
       v_home.radius_m);
  end if;

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
