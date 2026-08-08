-- 0080_park_badges.sql — National Park / public-land badges. `parks` holds a
-- boundary polygon per park (populated from OSM/Nominatim by a one-off script);
-- places.park names the park a place falls inside. A trigger keeps it current so
-- any new or moved place auto-tags its park (spatial ST_Contains, smallest park
-- wins when nested). The card shows "In <park>".

create table if not exists public.parks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  boundary geometry(MultiPolygon, 4326) not null,
  created_at timestamptz not null default now()
);
alter table public.parks enable row level security;
drop policy if exists parks_select on public.parks;
create policy parks_select on public.parks for select using (public.is_member());

alter table public.places add column if not exists park text;

create or replace function public.set_place_park()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.lat is not null and new.lng is not null then
    new.park := (
      select pk.name from public.parks pk
      where st_contains(pk.boundary, st_setsrid(st_makepoint(new.lng, new.lat), 4326))
      order by st_area(pk.boundary) asc limit 1
    );
  else
    new.park := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_place_park on public.places;
create trigger trg_place_park
  before insert or update of lat, lng on public.places
  for each row execute function public.set_place_park();
