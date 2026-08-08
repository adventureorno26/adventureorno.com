-- Coordinate-less photos. A photo with no GPS (very common from Google Photos)
-- should be storable WITHOUT fabricating coordinates — it lands unassigned in the
-- Sorter inbox and is matched by capture time instead. Make lat/lng nullable; the
-- generated geom column becomes NULL for such rows (st_makepoint(null,null) → NULL),
-- which simply excludes them from spatial queries until they're placed.

alter table public.photos alter column lat drop not null;
alter table public.photos alter column lng drop not null;
