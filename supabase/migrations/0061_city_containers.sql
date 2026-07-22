-- 0061_city_containers.sql — §3a: cities & regions as SPATIAL containers.
-- A city/region is a Place that BOTH counts (you visited it) AND holds the leaf
-- places inside its boundary — membership is computed via ST_Contains, not stored
-- links. Trails/trips still use explicit place_membership; cities use geography.

-- city/region are valid tags (no icon — Erica's rule) and are container kinds.
insert into public.place_categories (slug,label,icon,color,review,sort_order,is_auto,is_container,is_custom) values
  ('city','City','','#8b5cf6','Notes',5,false,true,false),
  ('region','Region','','#6d28d9','Notes',6,false,true,false)
on conflict (slug) do update set is_container=true, icon='';

-- Extend the container set to include city/region (so counts_as_place stays true —
-- a city counts — while holds_children/kind mark it a container).
create or replace function public.sync_place_category() returns trigger
  language plpgsql set search_path = public as $$
begin
  NEW.category := case
    when NEW.is_trail then 'trail'
    when NEW.categories @> array['trip'] then 'trip'
    when NEW.categories @> array['city'] then 'city'
    when NEW.categories @> array['region'] then 'region'
    when NEW.category is not null then NEW.category
    when coalesce(array_length(NEW.categories,1),0) > 0 then NEW.categories[1]
    when coalesce(array_length(NEW.activity_categories,1),0) > 0 then NEW.activity_categories[1]
    else null end;
  NEW.holds_children := coalesce(NEW.category in ('trail','trip','city','region'), false);
  NEW.kind := case when NEW.holds_children then 'container' else 'leaf' end;
  return NEW;
end $$;

-- Set a city/region's boundary polygon from a GeoJSON string (fetched client-side
-- from Nominatim) and mark it a city/region container.
create or replace function public.set_city_boundary(
  p_place uuid, p_geojson text, p_kind text default 'city'
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  update public.places set
    boundary = st_multi(st_setsrid(st_geomfromgeojson(p_geojson), 4326))::geometry(MultiPolygon,4326),
    categories = array[case when p_kind='region' then 'region' else 'city' end],
    saved = true
  where id = p_place;
end $$;
grant execute on function public.set_city_boundary(uuid,text,text) to authenticated;

-- Clear a city/region designation (back to an ordinary place).
create or replace function public.clear_city(p_place uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  update public.places set boundary = null, categories = '{}' where id = p_place;
end $$;
grant execute on function public.clear_city(uuid) to authenticated;

-- Leaf places that fall inside a container's boundary (spatial membership). Only
-- counting leaves, never the container itself or other containers.
create or replace function public.spatial_members(p_container uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id
  from public.places c
  join public.places p
    on c.boundary is not null
   and p.id <> c.id
   and not p.holds_children
   and p.counts_as_place
   and p.geom is not null
   and st_contains(c.boundary::geometry, p.geom::geometry)
  where c.id = p_container;
$$;
grant execute on function public.spatial_members(uuid) to authenticated;
