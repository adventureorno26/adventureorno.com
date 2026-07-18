-- 0004_strava.sql — Phase 4: Strava accounts, activity polylines, mileage view
-- Numbered migration; NEVER edit after merge.

-- ---------------------------------------------------------------------------
-- strava_accounts — OAuth tokens. Service_role only: RLS on with NO policies,
-- so clients (even the owner's JWT) can't read tokens; the Edge Functions use
-- the service_role key.
-- ---------------------------------------------------------------------------
create table if not exists public.strava_accounts (
  athlete_id    bigint primary key,
  profile_id    uuid references public.profiles (id) on delete set null,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null, -- when access_token expires
  scope         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.strava_accounts enable row level security;
-- (no policies on purpose — deny-all to clients)

-- summary_polyline for the routes view (decoded client-side via @mapbox/polyline).
alter table public.activities add column if not exists summary_polyline text;

-- ---------------------------------------------------------------------------
-- assign_activity_place(lat, lng): nearest place within 30 km, else create one
-- at the start point (auto + needs_geocode, so it flows through the Phase 3
-- naming pipeline). Returns the place id. Called by the webhook/backfill.
-- ---------------------------------------------------------------------------
create or replace function public.assign_activity_place(p_lat float8, p_lng float8)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_place uuid;
begin
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

-- ---------------------------------------------------------------------------
-- Mileage aggregate (Phase 4 task 5). One row per activity type — the client
-- reads a handful of rows and sums, never thousands of activities. security
-- invoker so the members-read RLS on `activities` applies to the caller.
-- ---------------------------------------------------------------------------
create or replace view public.activity_mileage
  with (security_invoker = on) as
  select
    type,
    count(*)                         as activity_count,
    coalesce(sum(distance), 0)       as meters,
    round((coalesce(sum(distance), 0) / 1609.344)::numeric, 1) as miles
  from public.activities
  group by type;

grant select on public.activity_mileage to authenticated;

-- Per-place photo + route counts for the map hover popups ("N routes" chip).
create or replace view public.place_counts
  with (security_invoker = on) as
  select
    p.id as place_id,
    (select count(*) from public.photos ph where ph.place_id = p.id)     as photo_count,
    (select count(*) from public.activities a where a.place_id = p.id)    as route_count
  from public.places p;

grant select on public.place_counts to authenticated;

-- Clients can't read strava_accounts (deny-all), so expose just a connected bool.
create or replace function public.strava_connected()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.strava_accounts);
$$;
revoke all on function public.strava_connected() from public;
grant execute on function public.strava_connected() to authenticated;
