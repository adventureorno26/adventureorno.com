-- 0066_city_boundary_rebuilds.sql — Phase C (city/region UI). Setting or
-- clearing a city/region boundary changes which leaves roll up into it, so the
-- container's visit islands must be rebuilt. Bake that into the RPCs (Phase D:
-- rules live in functions) so the UI just calls one thing. Also rebuild each
-- affected leaf so a leaf that was standing alone now shows under its city.

create or replace function public.set_city_boundary(
  p_place uuid, p_geojson text, p_kind text default 'city'
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  update public.places set
    boundary = st_multi(st_setsrid(st_geomfromgeojson(p_geojson), 4326))::geometry(MultiPolygon,4326),
    categories = array[case when p_kind = 'region' then 'region' else 'city' end],
    saved = true
  where id = p_place;
  perform public.rebuild_place_visits(p_place);
end $$;

create or replace function public.clear_city(p_place uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  -- Null category too: sync_place_category keeps a non-null category, so without
  -- this the place stays 'city' (holds_children=true) with an empty boundary.
  -- Nulling it lets the trigger re-derive to a plain leaf.
  update public.places set boundary = null, categories = '{}', category = null
  where id = p_place;
  perform public.rebuild_place_visits(p_place);
end $$;
