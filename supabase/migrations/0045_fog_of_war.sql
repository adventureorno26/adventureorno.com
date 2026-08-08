-- Fog of war: a single-row union of everywhere we've actually been. Buffered 10km
-- around every photo, location ping, and activity start point, simplified before
-- storing. The client draws the INVERSE (world minus this) as fog.

create table if not exists revealed_area (
  id int primary key default 1,
  geom geography(MultiPolygon, 4326),
  updated_at timestamptz default now(),
  constraint revealed_area_single check (id = 1)
);

-- Idempotent rebuild — recomputes the whole union from scratch.
create or replace function rebuild_revealed_area()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g geometry;
  started timestamptz := now();
begin
  select ST_Union(b) into g
  from (
    select ST_Buffer(pt::geography, 10000)::geometry as b
    from (
      select geom::geometry as pt from photos where geom is not null
      union all
      select geom::geometry from location_pings where geom is not null
      union all
      select ST_SetSRID(ST_MakePoint(lng, lat), 4326)
        from activities where lat is not null and lng is not null
      -- TODO (later phase): buffer activity route LINES (summary_polyline), not
      -- just their start points, so long routes reveal their whole corridor.
    ) s
  ) u;

  if g is not null then
    g := ST_SimplifyPreserveTopology(g, 0.01);
  end if;

  insert into revealed_area (id, geom, updated_at)
  values (
    1,
    ST_Multi(coalesce(g, ST_GeomFromText('MULTIPOLYGON EMPTY', 4326)))::geography,
    now()
  )
  on conflict (id) do update set geom = excluded.geom, updated_at = excluded.updated_at;

  insert into job_runs (job, started_at, finished_at, summary)
  values (
    'rebuild_revealed_area',
    started,
    now(),
    jsonb_build_object('polys', coalesce(ST_NumGeometries(g), 0))
  );
end;
$$;

-- Rebuild fog at the end of the on-demand clustering (owner "Cluster now").
create or replace function cluster_now()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  if not public.is_owner() then
    raise exception 'owner role required';
  end if;
  r := public.cluster_unassigned();
  perform public.rebuild_revealed_area();
  return r;
end;
$$;

-- Nightly at 07:10 UTC, after clustering (07:00) and geocode.
select cron.schedule('rebuild-revealed-area', '10 7 * * *', $$ select public.rebuild_revealed_area(); $$);
