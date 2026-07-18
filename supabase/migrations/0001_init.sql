-- 0001_init.sql — adventureorno.com foundational schema
-- Numbered migration; NEVER edit after merge (add a new migration instead).
--
-- Design notes:
--  * Geometry is stored as a generated geography(Point,4326) column derived from
--    plain lat/lng doubles. The client only ever reads/writes lat/lng (avoids
--    PostGIS wire-format pain); spatial queries use `geom`.
--  * RLS is on for every table. Baseline: you must have a `profiles` row to read
--    anything. Writes are gated by role. `settings`, `ingest_tokens`,
--    `deleted_hashes`, `invites` are owner-only. Ingest paths (pings, activities)
--    are written by Edge Functions using the service_role key, which bypasses RLS.

create extension if not exists postgis;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         text not null check (role in ('owner', 'editor')),
  display_name text,
  created_at   timestamptz not null default now()
);

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  role        text not null check (role in ('owner', 'editor')),
  invited_by  uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days'
);
create index invites_email_idx on public.invites (lower(email));

create table public.places (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  country     text,
  admin1      text, -- state / province / region
  lat         double precision not null,
  lng         double precision not null,
  geom        geography(Point, 4326)
                generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  first_visit date,
  last_visit  date,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index places_geom_idx on public.places using gist (geom);

create table public.entries (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references public.places (id) on delete cascade,
  kind       text not null check (kind in ('restaurant', 'activity', 'stay', 'note')),
  title      text not null,
  body       text, -- markdown
  rating     smallint check (rating between 1 and 5),
  url        text,
  date       date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index entries_place_idx on public.entries (place_id);

create table public.photos (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid references public.places (id) on delete set null,
  lat         double precision not null,
  lng         double precision not null,
  geom        geography(Point, 4326)
                generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  taken_at    timestamptz,
  r2_key      text not null, -- 2400px web version
  thumb_key   text not null, -- 400px thumbnail
  width       integer,
  height      integer,
  sha256      text not null, -- content hash of the original (pre-resize)
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index photos_geom_idx on public.photos using gist (geom);
create index photos_place_idx on public.photos (place_id);
create index photos_sha_idx on public.photos (sha256);

create table public.location_pings (
  id           uuid primary key default gen_random_uuid(),
  lat          double precision not null,
  lng          double precision not null,
  geom         geography(Point, 4326)
                 generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  recorded_at  timestamptz not null,
  source       text, -- e.g. 'overland'
  place_id     uuid references public.places (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index pings_geom_idx on public.location_pings using gist (geom);
create index pings_recorded_idx on public.location_pings (recorded_at);

create table public.activities (
  id           uuid primary key default gen_random_uuid(),
  strava_id    bigint unique,
  type         text not null, -- Hike / Walk / Run / Ride / ...
  name         text,
  distance     double precision not null default 0, -- meters
  moving_time  integer, -- seconds
  elapsed_time integer, -- seconds
  start_date   timestamptz,
  lat          double precision not null,
  lng          double precision not null,
  geom         geography(Point, 4326)
                 generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  place_id     uuid references public.places (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index activities_geom_idx on public.activities using gist (geom);
create index activities_type_idx on public.activities (type);

create table public.trips (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  start_date date,
  end_date   date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Permanent, sticky deletion blocklist (rule 6). The upload Worker rejects any
-- upload whose content hash appears here.
create table public.deleted_hashes (
  sha256     text primary key,
  deleted_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz not null default now()
);

-- Key/value config. Home-exclusion zone lives here, never hardcoded in logic.
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Device ingest tokens (rule 7: exactly one, Erica's; owner-only).
create table public.ingest_tokens (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  token_hash   text not null unique, -- sha256 of the bearer token; raw shown once
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies can consult `profiles`
-- without triggering RLS recursion). Defined after the tables they read.
-- ---------------------------------------------------------------------------
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner');
$$;

create or replace function public.is_editor_or_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role in ('owner', 'editor')
  );
$$;

-- ---------------------------------------------------------------------------
-- Seed: home-exclusion zone — 15 statute miles (24140 m) around Leesburg, VA.
-- ---------------------------------------------------------------------------
insert into public.settings (key, value)
values (
  'home_zone',
  jsonb_build_object('lat', 39.1157, 'lng', -77.5636, 'radius_m', 24140)
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- claim_invite(): promote a signed-in user with a pending invite into a
-- profile on first login. Idempotent. Called by the SPA via supabase.rpc.
-- ---------------------------------------------------------------------------
create or replace function public.claim_invite()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  uemail    text := lower(auth.jwt() ->> 'email');
  existing  public.profiles;
  inv       public.invites;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select * into existing from public.profiles where id = uid;
  if found then
    return existing;
  end if;

  select * into inv
  from public.invites
  where lower(email) = uemail
    and accepted_at is null
    and expires_at > now()
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'no pending invite for %', uemail;
  end if;

  insert into public.profiles (id, role, display_name)
  values (uid, inv.role, split_part(uemail, '@', 1))
  returning * into existing;

  update public.invites set accepted_at = now() where id = inv.id;

  return existing;
end;
$$;

revoke all on function public.claim_invite() from public;
grant execute on function public.claim_invite() to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.invites        enable row level security;
alter table public.places         enable row level security;
alter table public.entries        enable row level security;
alter table public.photos         enable row level security;
alter table public.location_pings enable row level security;
alter table public.activities     enable row level security;
alter table public.trips          enable row level security;
alter table public.deleted_hashes enable row level security;
alter table public.settings       enable row level security;
alter table public.ingest_tokens  enable row level security;

-- profiles: members can see all profiles; owner manages them. Profile creation
-- happens through claim_invite() (security definer), so no INSERT policy for
-- ordinary users.
create policy profiles_select on public.profiles
  for select using (public.is_member());
create policy profiles_owner_write on public.profiles
  for all using (public.is_owner()) with check (public.is_owner());

-- invites: owner only.
create policy invites_owner_all on public.invites
  for all using (public.is_owner()) with check (public.is_owner());

-- places: members read; owner/editor write.
create policy places_select on public.places
  for select using (public.is_member());
create policy places_write on public.places
  for all using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());

-- entries: members read; owner/editor write.
create policy entries_select on public.entries
  for select using (public.is_member());
create policy entries_write on public.entries
  for all using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());

-- photos: members read; owner/editor insert & update. Delete: owner any,
-- editor only their own uploads (rule 6).
create policy photos_select on public.photos
  for select using (public.is_member());
create policy photos_insert on public.photos
  for insert with check (public.is_editor_or_owner());
create policy photos_update on public.photos
  for update using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());
create policy photos_delete on public.photos
  for delete using (public.is_owner() or uploaded_by = auth.uid());

-- location_pings: members read; writes only via service_role (bypasses RLS).
create policy pings_select on public.location_pings
  for select using (public.is_member());

-- activities: members read; writes only via service_role.
create policy activities_select on public.activities
  for select using (public.is_member());

-- trips: members read; owner/editor write.
create policy trips_select on public.trips
  for select using (public.is_member());
create policy trips_write on public.trips
  for all using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());

-- deleted_hashes: members read (upload UI may check); owner-only client writes
-- (Worker uses service_role).
create policy deleted_hashes_select on public.deleted_hashes
  for select using (public.is_member());
create policy deleted_hashes_owner_write on public.deleted_hashes
  for all using (public.is_owner()) with check (public.is_owner());

-- settings: members read; owner-only writes.
create policy settings_select on public.settings
  for select using (public.is_member());
create policy settings_owner_write on public.settings
  for all using (public.is_owner()) with check (public.is_owner());

-- ingest_tokens: owner only, both read and write (never exposed to editors).
create policy ingest_tokens_owner_all on public.ingest_tokens
  for all using (public.is_owner()) with check (public.is_owner());
