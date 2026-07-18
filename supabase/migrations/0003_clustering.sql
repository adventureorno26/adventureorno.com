-- 0003_clustering.sql — Phase 3: passive-GPS ingest + nightly clustering
-- Numbered migration; NEVER edit after merge.
--
-- The map builds itself: Overland pings + unassigned photos get clustered nightly
-- into named places. This migration adds the metadata + the SQL job. Reverse
-- geocoding (naming) is done by the `geocode-new-places` Edge Function, since SQL
-- can't call MapTiler; the job just flags new places `needs_geocode`.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------

-- Clustering-created places wear an "auto" badge until first edited, and start
-- life needing a reverse-geocoded name.
alter table public.places add column if not exists auto boolean not null default false;
alter table public.places add column if not exists needs_geocode boolean not null default false;
alter table public.places add column if not exists geocoded_at timestamptz;
-- visit_count = number of distinct calendar days with any photo/ping at the place
-- (deterministic + idempotent — a re-run recomputes the same number).
alter table public.places add column if not exists visit_count integer not null default 0;

-- Overland reports horizontal accuracy; keep it so we can audit the >200 m drop.
alter table public.location_pings add column if not exists accuracy double precision;

-- One row per clustering run for observability (Phase 3 task 2).
create table if not exists public.job_runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  summary     jsonb,
  created_at  timestamptz not null default now()
);
alter table public.job_runs enable row level security;
create policy job_runs_select on public.job_runs for select using (public.is_member());
-- Writes happen inside SECURITY DEFINER functions / service_role only.

-- ---------------------------------------------------------------------------
-- cluster_unassigned(): the nightly job. Idempotent, safe to re-run.
--   * Inputs: photos with place_id NULL + pings (last 14 days) with place_id NULL.
--   * ST_ClusterDBSCAN(eps ≈ 10 km, minpoints = 1) — every point seeds/extends a
--     cluster (so pings-only clusters still create places: being there counts).
--   * Per cluster: attach to nearest existing place within 10 km, else create one
--     at the centroid (auto = true, needs_geocode = true).
--   * Recompute first/last visit, visit_count, and cover photo for touched places
--     from ALL their children (that's what makes re-runs a no-op).
-- ---------------------------------------------------------------------------
create or replace function public.cluster_unassigned()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  -- ~10 km expressed in degrees. Cities are far apart, so the small latitude
  -- distortion doesn't change which points cluster together; the nearest-place
  -- attach below uses exact geography distance.
  v_eps := 10000.0 / 111320.0;

  -- Defensively drop temps in case two runs share one transaction (the nightly
  -- cron runs each in its own txn, but manual double-invocations don't commit
  -- between calls, so `on commit drop` wouldn't fire).
  drop table if exists _pts;
  drop table if exists _clustered;

  -- Candidate points (photos + recent pings) not yet assigned to a place.
  create temp table _pts on commit drop as
    select 'photo'::text as kind, id, lng, lat,
           st_setsrid(st_makepoint(lng, lat), 4326) as g
      from public.photos where place_id is null
    union all
    select 'ping', id, lng, lat, st_setsrid(st_makepoint(lng, lat), 4326)
      from public.location_pings
      where place_id is null and recorded_at > now() - interval '14 days';

  -- Defensive home-zone drop (ingest already rejects, but re-runs stay clean).
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

  -- Recompute visit stats + cover photo for every touched place (idempotent).
  perform public.recompute_place_stats(pid) from unnest(v_touched) as pid;

  v_summary := jsonb_build_object(
    'points', v_points, 'clusters_created', v_created,
    'clusters_attached', v_attached, 'places_touched', coalesce(array_length(v_touched, 1), 0));

  insert into public.job_runs (job, started_at, finished_at, summary)
  values ('cluster_unassigned', v_started, now(), v_summary);

  return v_summary;
end;
$$;

-- Recompute a place's first/last visit, visit_count, and cover photo from its
-- current children. Split out so merge_places() reuses it.
create or replace function public.recompute_place_stats(p_place uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first date;
  v_last  date;
  v_count integer;
  v_cover uuid;
begin
  with days as (
    select taken_at::date as d from public.photos
      where place_id = p_place and taken_at is not null
    union
    select recorded_at::date from public.location_pings where place_id = p_place
    union
    select start_date::date from public.activities where place_id = p_place and start_date is not null
  )
  select min(d), max(d), count(*) into v_first, v_last, v_count from days;

  select id into v_cover
    from public.photos
   where place_id = p_place and is_landscape
   order by taken_at desc nulls last
   limit 1;
  if v_cover is null then
    select id into v_cover from public.photos
      where place_id = p_place order by taken_at desc nulls last limit 1;
  end if;

  update public.places
     set first_visit = coalesce(v_first, first_visit),
         last_visit  = coalesce(v_last, last_visit),
         visit_count = coalesce(v_count, 0),
         cover_photo_id = v_cover
   where id = p_place;
end;
$$;

-- ---------------------------------------------------------------------------
-- merge_places(loser, winner): move all children to winner, combine visit
-- history, delete loser. Editor/owner callable.
-- ---------------------------------------------------------------------------
create or replace function public.merge_places(p_loser uuid, p_winner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized';
  end if;
  if p_loser = p_winner then
    raise exception 'cannot merge a place into itself';
  end if;

  update public.photos         set place_id = p_winner where place_id = p_loser;
  update public.entries        set place_id = p_winner where place_id = p_loser;
  update public.activities     set place_id = p_winner where place_id = p_loser;
  update public.location_pings set place_id = p_winner where place_id = p_loser;

  -- Deleting the loser NULLs any places.cover_photo_id that pointed at it (FK is
  -- ON DELETE SET NULL); recompute below re-derives the winner's cover.
  delete from public.places where id = p_loser;
  perform public.recompute_place_stats(p_winner);
end;
$$;

revoke all on function public.cluster_unassigned() from public;
revoke all on function public.merge_places(uuid, uuid) from public;
grant execute on function public.merge_places(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Nightly schedule. 07:00 UTC ≈ 03:00 America/New_York. The geocode follow-up
-- (which needs the service key) is scheduled at deploy time, not here, to keep
-- secrets out of committed SQL.
-- ---------------------------------------------------------------------------
select cron.unschedule('cluster-nightly')
  where exists (select 1 from cron.job where jobname = 'cluster-nightly');
select cron.schedule('cluster-nightly', '0 7 * * *', $$select public.cluster_unassigned()$$);
