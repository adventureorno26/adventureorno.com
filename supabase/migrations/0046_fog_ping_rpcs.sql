-- Member-read RPCs for the fog + heat map layers, and the revealed_area RLS.

alter table revealed_area enable row level security;
drop policy if exists revealed_area_read on revealed_area;
create policy revealed_area_read on revealed_area for select using (is_member());

-- Fog geometry: crisp (stored 10km) + a soft 25km edge (buffered on read).
create or replace function revealed_area_geojson()
returns jsonb
language sql
security invoker
stable
set search_path = public
as $$
  select jsonb_build_object(
    'crisp', ST_AsGeoJSON(geom::geometry)::jsonb,
    'soft', ST_AsGeoJSON(ST_Buffer(geom, 15000)::geometry)::jsonb
  )
  from revealed_area
  where id = 1;
$$;

-- Never ship raw pings: return ~0.005° grid cells with a weight count, capped.
create or replace function pings_overview()
returns table(lng double precision, lat double precision, weight bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select ST_X(c) as lng, ST_Y(c) as lat, count(*)::bigint as weight
  from (
    select ST_SnapToGrid(geom::geometry, 0.005) as c
    from location_pings
    where geom is not null
  ) s
  group by c
  order by weight desc
  limit 20000;
$$;
