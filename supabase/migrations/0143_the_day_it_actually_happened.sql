-- Record the day something actually happened, not the day it was in UTC.
--
-- Everything buckets on `start_date::date` / `taken_at::date`, which is UTC. Any
-- evening outing after ~20:00 Eastern (17:00 Pacific) is therefore filed on the NEXT
-- day. Erica found it herself: "on the 13th I only did a 4.1 and 4.7 walk" — the
-- third San Diego walk started 00:25 UTC, which is 17:25 local on 12 July.
--
-- 12 of 444 activities and 18 of 165 photos are on the wrong calendar day. It also
-- decides which VISIT a thing belongs to, so it silently reshapes visit spans, and
-- it corrupts duplicate detection in both directions: it invented a "third walk" on
-- the 13th and it hid a genuine duplicate on 2018-08-13 whose two records straddled
-- midnight UTC and landed at two different places.
--
-- Strava sends `start_date_local` and we never stored it. Going forward we will;
-- for everything already here, the local time is reconstructed from the location.

begin;

-- 1. WHICH TIMEZONE. Longitude bands alone are wrong at state lines — Utah is west
--    of -112.5 but Mountain, Nevada is east of -114 but Pacific — so a known state
--    or country wins, and longitude is only the fallback. States that genuinely
--    straddle two zones (Florida, Texas, Idaho, Oregon, Michigan, Kentucky,
--    Tennessee, Indiana, the Dakotas, Kansas, Nebraska) deliberately fall through to
--    the longitude bands.
--
--    Postgres owns the DST rules, so `AT TIME ZONE 'America/New_York'` is exact for
--    every date in history; we only have to name the zone.
create or replace function public.local_zone(
  p_lat double precision,
  p_lng double precision,
  p_country text default null,
  p_admin1 text default null
) returns text
language sql
immutable
as $function$
  select coalesce(
    case lower(coalesce(p_admin1, ''))
      when 'virginia' then 'America/New_York'
      when 'maryland' then 'America/New_York'
      when 'west virginia' then 'America/New_York'
      when 'district of columbia' then 'America/New_York'
      when 'delaware' then 'America/New_York'
      when 'new york' then 'America/New_York'
      when 'new jersey' then 'America/New_York'
      when 'pennsylvania' then 'America/New_York'
      when 'connecticut' then 'America/New_York'
      when 'massachusetts' then 'America/New_York'
      when 'rhode island' then 'America/New_York'
      when 'vermont' then 'America/New_York'
      when 'new hampshire' then 'America/New_York'
      when 'maine' then 'America/New_York'
      when 'ohio' then 'America/New_York'
      when 'north carolina' then 'America/New_York'
      when 'south carolina' then 'America/New_York'
      when 'georgia' then 'America/New_York'
      when 'illinois' then 'America/Chicago'
      when 'wisconsin' then 'America/Chicago'
      when 'minnesota' then 'America/Chicago'
      when 'iowa' then 'America/Chicago'
      when 'missouri' then 'America/Chicago'
      when 'arkansas' then 'America/Chicago'
      when 'louisiana' then 'America/Chicago'
      when 'mississippi' then 'America/Chicago'
      when 'alabama' then 'America/Chicago'
      when 'oklahoma' then 'America/Chicago'
      when 'colorado' then 'America/Denver'
      when 'wyoming' then 'America/Denver'
      when 'montana' then 'America/Denver'
      when 'utah' then 'America/Denver'
      when 'new mexico' then 'America/Denver'
      when 'arizona' then 'America/Phoenix'
      when 'nevada' then 'America/Los_Angeles'
      when 'california' then 'America/Los_Angeles'
      when 'washington' then 'America/Los_Angeles'
      when 'alaska' then 'America/Anchorage'
      when 'hawaii' then 'Pacific/Honolulu'
      else null
    end,
    case lower(coalesce(p_country, ''))
      when 'barbados' then 'America/Barbados'
      when 'france' then 'Europe/Paris'
      when 'united kingdom' then 'Europe/London'
      when 'ireland' then 'Europe/Dublin'
      when 'spain' then 'Europe/Madrid'
      when 'italy' then 'Europe/Rome'
      when 'germany' then 'Europe/Berlin'
      when 'netherlands' then 'Europe/Amsterdam'
      when 'portugal' then 'Europe/Lisbon'
      when 'mexico' then 'America/Mexico_City'
      when 'canada' then null   -- far too wide; longitude decides
      else null
    end,
    -- North America by longitude.
    case when p_lat between 15 and 72 and p_lng between -170 and -50 then
      case when p_lng >= -67.5  then 'America/Halifax'
           when p_lng >= -82.5  then 'America/New_York'
           when p_lng >= -97.5  then 'America/Chicago'
           when p_lng >= -112.5 then 'America/Denver'
           when p_lng >= -127.5 then 'America/Los_Angeles'
           else 'America/Anchorage' end
    end,
    -- Western/central Europe by longitude.
    case when p_lat between 35 and 72 and p_lng between -11 and 30 then
      case when p_lng < -1 then 'Europe/London'
           when p_lng < 16 then 'Europe/Paris'
           else 'Europe/Athens' end
    end,
    'UTC'
  );
$function$;

-- 2. THE COLUMNS. `*_local` is the wall clock where it happened; `local_date` is
--    generated from it so no reader can forget to derive it and no backfill can
--    drift out of step.
alter table public.activities add column if not exists start_date_local timestamp;
alter table public.activities add column if not exists local_date date
  generated always as (start_date_local::date) stored;

alter table public.photos add column if not exists taken_at_local timestamp;
alter table public.photos add column if not exists local_date date
  generated always as (taken_at_local::date) stored;

-- 3. KEEP THEM TRUE. Strava's own start_date_local wins when the ingest supplies it
--    (it is authoritative); otherwise reconstruct from the location.
create or replace function public.set_activity_local_time()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_country text; v_admin1 text;
begin
  if NEW.start_date is null then
    NEW.start_date_local := null;
    return NEW;
  end if;
  -- An explicitly supplied local time is authoritative; never overwrite it.
  if NEW.start_date_local is not null
     and (TG_OP = 'INSERT' or NEW.start_date_local is distinct from OLD.start_date_local) then
    return NEW;
  end if;
  select p.country, p.admin1 into v_country, v_admin1
    from public.places p where p.id = NEW.place_id;
  NEW.start_date_local :=
    NEW.start_date at time zone public.local_zone(NEW.lat, NEW.lng, v_country, v_admin1);
  return NEW;
end $function$;

drop trigger if exists trg_activity_local_time on public.activities;
create trigger trg_activity_local_time
  before insert or update of start_date, lat, lng, place_id, start_date_local
  on public.activities
  for each row execute function public.set_activity_local_time();

create or replace function public.set_photo_local_time()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_country text; v_admin1 text; v_lat double precision; v_lng double precision;
begin
  if NEW.taken_at is null then
    NEW.taken_at_local := null;
    return NEW;
  end if;
  if NEW.taken_at_local is not null
     and (TG_OP = 'INSERT' or NEW.taken_at_local is distinct from OLD.taken_at_local) then
    return NEW;
  end if;
  select p.country, p.admin1, p.lat, p.lng into v_country, v_admin1, v_lat, v_lng
    from public.places p where p.id = NEW.place_id;
  NEW.taken_at_local :=
    NEW.taken_at at time zone
      public.local_zone(coalesce(NEW.lat, v_lat), coalesce(NEW.lng, v_lng), v_country, v_admin1);
  return NEW;
end $function$;

drop trigger if exists trg_photo_local_time on public.photos;
create trigger trg_photo_local_time
  before insert or update of taken_at, lat, lng, place_id, taken_at_local
  on public.photos
  for each row execute function public.set_photo_local_time();

-- 4. BACKFILL everything already here.
update public.activities a
   set start_date_local = a.start_date at time zone
         public.local_zone(a.lat, a.lng, p.country, p.admin1)
  from public.places p
 where p.id = a.place_id and a.start_date is not null;

update public.activities a
   set start_date_local = a.start_date at time zone public.local_zone(a.lat, a.lng, null, null)
 where a.place_id is null and a.start_date is not null;

update public.photos ph
   set taken_at_local = ph.taken_at at time zone
         public.local_zone(coalesce(ph.lat, p.lat), coalesce(ph.lng, p.lng), p.country, p.admin1)
  from public.places p
 where p.id = ph.place_id and ph.taken_at is not null;

update public.photos ph
   set taken_at_local = ph.taken_at at time zone public.local_zone(ph.lat, ph.lng, null, null)
 where ph.place_id is null and ph.taken_at is not null;

commit;
