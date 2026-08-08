-- 0064_place_for_activity_typeaware.sql — Phase A2. An activity only earns its
-- own place when its location is the destination. Type-aware placement:
--   Hike / Bike / Jeep → its own place; reuse within 300 m, else create
--   Run                → its own place; reuse within 1.5 km (collapses neighborhood
--                        variance so "Loudoun County Running" is ONE place, not nine)
--   Walk               → NOT its own place: attach to the enclosing city/region
--                        (boundary), else nearest saved place within 2 km, else a
--                        geocoded destination (the town/park), created if needed
-- Places are NEVER named from the activity title — created needs_geocode so the
-- geocoder assigns a real location name. Called by Strava/Garmin/GPX/drawn ingest.

create or replace function public.place_for_activity(
  p_lat double precision, p_lng double precision, p_type text, p_name text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_place uuid; v_cat text; v_pt geography;
begin
  if p_lat is null or p_lng is null then return null; end if;
  v_cat := public.activity_category(p_type);
  v_pt := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;

  if v_cat = 'walking' then
    -- 1. inside a city/region container's boundary → that container
    select id into v_place from public.places
      where boundary is not null and holds_children
        and st_contains(boundary::geometry, v_pt::geometry)
      order by st_area(boundary) asc limit 1;
    if v_place is not null then return v_place; end if;
    -- 2. nearest existing SAVED place within 2 km (leaf or container)
    select id into v_place from public.places
      where saved and lat is not null and st_dwithin(geom, v_pt, 2000)
      order by st_distance(geom, v_pt) limit 1;
    if v_place is not null then return v_place; end if;
    -- 3. else fall through and create a geocoded destination place (no walk tag)

  elsif v_cat = 'running' then
    select id into v_place from public.places
      where kind = 'leaf' and not holds_children and lat is not null
        and st_dwithin(geom, v_pt, 1500)
      order by st_distance(geom, v_pt) limit 1;
    if v_place is not null then return v_place; end if;

  else -- hiking, biking, jeeping, or unknown
    select id into v_place from public.places
      where kind = 'leaf' and not holds_children and lat is not null
        and st_dwithin(geom, v_pt, 300)
      order by st_distance(geom, v_pt) limit 1;
    if v_place is not null then return v_place; end if;
  end if;

  -- Create a new leaf place. Walks create a bare geocoded destination (no
  -- category); hikes/bikes/runs carry their activity category. Never the title.
  if v_cat = 'walking' then
    insert into public.places (name, lat, lng, saved, auto, needs_geocode, kind)
    values ('New place', p_lat, p_lng, true, true, true, 'leaf')
    returning id into v_place;
  else
    insert into public.places (name, lat, lng, saved, auto, needs_geocode, kind, category, categories)
    values ('New place', p_lat, p_lng, true, true, true, 'leaf', v_cat,
            case when v_cat is null then '{}'::text[] else array[v_cat] end)
    returning id into v_place;
  end if;
  return v_place;
end $$;
grant execute on function public.place_for_activity(double precision,double precision,text,text) to authenticated, service_role;
