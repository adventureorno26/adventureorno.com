-- 0007_place_reviews.sql — Phase 7: overall place rating/review + per-day visits
-- Numbered migration; NEVER edit after merge.

-- A place gets its own overall rating + review (distinct from per-entry ratings,
-- which live on individual restaurants/stays/etc.).
alter table public.places add column if not exists rating smallint
  check (rating between 1 and 5);
alter table public.places add column if not exists review text;

-- The single "home" place. Everything inside the 15-mile home zone (local
-- Hike/Walk/Run activities, which are exempt from exclusion per rule #2) rolls
-- up into ONE card at Leesburg instead of scattering into many auto places.
alter table public.places add column if not exists is_home boolean not null default false;

-- ---------------------------------------------------------------------------
-- Route in-zone activities to the home place; keep the 30 km behaviour outside.
-- (Overrides the 0004 definition.)
-- ---------------------------------------------------------------------------
create or replace function public.assign_activity_place(p_lat float8, p_lng float8)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_home  record;
  v_place uuid;
begin
  select (value->>'lat')::float8 as lat, (value->>'lng')::float8 as lng,
         (value->>'radius_m')::float8 as radius_m
    into v_home from public.settings where key = 'home_zone';

  -- Inside the home zone → the single home place (create it once).
  if v_home.radius_m is not null
     and st_dwithin(st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
                    st_setsrid(st_makepoint(v_home.lng, v_home.lat), 4326)::geography,
                    v_home.radius_m) then
    select id into v_place from public.places where is_home limit 1;
    if v_place is null then
      insert into public.places (name, admin1, country, lat, lng, is_home, auto, needs_geocode)
      values ('Leesburg, VA', 'Virginia', 'United States',
              v_home.lat, v_home.lng, true, false, false)
      returning id into v_place;
    end if;
    return v_place;
  end if;

  -- Outside → nearest existing place within 30 km, else create one.
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

-- place_days(): the distinct dates you were at a place, with what happened each
-- day. Powers the "Visits" list on the place card; each row links to a day view.
-- Combines Strava activities (routes), entries (restaurants/hotels/notes), and
-- photos. OwnTracks/Overland pings also contribute dates so a day you only
-- passed through still shows.
create or replace function public.place_days(p_place uuid)
returns table(day date, activities integer, entries integer, photos integer, pings integer)
language sql
stable
security definer
set search_path = public
as $$
  with d as (
    select start_date::date as day, 'a' as kind
      from public.activities where place_id = p_place and start_date is not null
    union all
    select date, 'e' from public.entries where place_id = p_place and date is not null
    union all
    select taken_at::date, 'p' from public.photos where place_id = p_place and taken_at is not null
    union all
    select recorded_at::date, 'g'
      from public.location_pings where place_id = p_place
  )
  select
    day,
    count(*) filter (where kind = 'a')::int as activities,
    count(*) filter (where kind = 'e')::int as entries,
    count(*) filter (where kind = 'p')::int as photos,
    count(*) filter (where kind = 'g')::int as pings
  from d
  group by day
  order by day desc;
$$;

revoke all on function public.place_days(uuid) from public;
grant execute on function public.place_days(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- One-time consolidation of existing data into a single home place. Idempotent.
-- ---------------------------------------------------------------------------
do $$
declare
  v_home record;
  v_place uuid;
begin
  select (value->>'lat')::float8 as lat, (value->>'lng')::float8 as lng,
         (value->>'radius_m')::float8 as radius_m
    into v_home from public.settings where key = 'home_zone';
  if v_home.radius_m is null then return; end if;

  select id into v_place from public.places where is_home limit 1;
  if v_place is null then
    insert into public.places (name, admin1, country, lat, lng, is_home, auto, needs_geocode)
    values ('Leesburg, VA', 'Virginia', 'United States',
            v_home.lat, v_home.lng, true, false, false)
    returning id into v_place;
  end if;

  -- Pull every in-zone child onto the home place.
  update public.activities set place_id = v_place
    where st_dwithin(geom, st_setsrid(st_makepoint(v_home.lng, v_home.lat), 4326)::geography, v_home.radius_m)
      and place_id is distinct from v_place;
  update public.photos set place_id = v_place
    where st_dwithin(geom, st_setsrid(st_makepoint(v_home.lng, v_home.lat), 4326)::geography, v_home.radius_m)
      and place_id is distinct from v_place;

  -- Delete now-empty auto places inside the zone (never the home place).
  delete from public.places p
   where not p.is_home and p.auto
     and st_dwithin(p.geom, st_setsrid(st_makepoint(v_home.lng, v_home.lat), 4326)::geography, v_home.radius_m)
     and not exists (select 1 from public.activities a where a.place_id = p.id)
     and not exists (select 1 from public.photos ph where ph.place_id = p.id)
     and not exists (select 1 from public.entries e where e.place_id = p.id)
     and not exists (select 1 from public.location_pings lp where lp.place_id = p.id);

  perform public.recompute_place_stats(v_place);
end $$;
