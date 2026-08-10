-- WHERE WE ARE — last seen, honestly labelled.
--
-- Erica: "I like the OpenStreetMap and Mapbox that Snapchat uses — can we build in
-- the same kind of functionality that shows you where your friends are?"
--
-- The data already exists: `location_pings` holds 16,988 for Erica and 14 for Josh.
-- The gap between those two numbers IS the honest limit of this feature. A web app
-- cannot track in the background on iOS, so pings only arrive while the app is
-- open. This therefore reports LAST SEEN, with its age, and never pretends to be
-- live. A stale dot that looks live is worse than no dot.
--
-- Privacy, in the order it is enforced:
--   1. Members only (is_member), like everything else here.
--   2. GHOST MODE: profiles.share_location. Off means nobody else gets your
--      position — you still see your own, so the switch is legible.
--   3. Coordinates are never logged (rule 8).
--
-- The marker is a PHOTO, because every marker in this app is a photo: the person's
-- most recent one. No icons.

begin;

-- ---------------------------------------------------------------------------
-- 1. Ghost mode. Defaults to sharing — between the two of them that is the
--    point of the feature — and either person can switch themselves off.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists share_location boolean not null default true;

comment on column public.profiles.share_location is
  'Ghost mode. false = this person''s last-seen position is hidden from everyone else. They still see their own.';

-- ---------------------------------------------------------------------------
-- 2. Where each of us was last seen.
-- ---------------------------------------------------------------------------
create or replace function public.last_seen()
returns table (
  profile_id    uuid,
  display_name  text,
  lat           double precision,
  lng           double precision,
  recorded_at   timestamptz,
  age_seconds   bigint,
  photo_id      uuid,
  is_me         boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- SECURITY DEFINER bypasses RLS, so the membership check is the only thing
  -- standing between a logged-in-but-not-member session and everyone's
  -- coordinates. 0093 revoked anon EXECUTE across the board; this guard covers
  -- the mid-join-flow case that grant alone does not.
  if not public.is_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  with latest as (
    -- One row per person: their most recent ping. DISTINCT ON is the cheap way
    -- to do this against 17k rows.
    select distinct on (lp.profile_id)
      lp.profile_id, lp.lat, lp.lng, lp.recorded_at
    from public.location_pings lp
    where lp.profile_id is not null
    order by lp.profile_id, lp.recorded_at desc
  ),
  their_photo as (
    -- The marker face: that person's most recent photo. Every marker is a photo.
    select distinct on (ph.uploaded_by) ph.uploaded_by, ph.id
    from public.photos ph
    where ph.uploaded_by is not null
      and ph.deleted_at is null
    order by ph.uploaded_by, coalesce(ph.taken_at, ph.created_at) desc
  )
  select
    p.id,
    p.display_name,
    l.lat,
    l.lng,
    l.recorded_at,
    extract(epoch from (now() - l.recorded_at))::bigint as age_seconds,
    tp.id,
    (p.id = auth.uid()) as is_me
  from public.profiles p
  join latest l on l.profile_id = p.id
  left join their_photo tp on tp.uploaded_by = p.id
  -- Ghost mode: hidden from everyone but yourself.
  where p.share_location or p.id = auth.uid()
  order by l.recorded_at desc;
end $function$;

comment on function public.last_seen() is
  'Each member''s most recent location ping, with its age and their latest photo for the marker. Respects ghost mode (profiles.share_location). Member-gated.';

-- ---------------------------------------------------------------------------
-- 3. Ghost mode, set by the person it belongs to. Nobody sets anyone else''s.
-- ---------------------------------------------------------------------------
create or replace function public.set_share_location(p_share boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.profiles set share_location = coalesce(p_share, true) where id = auth.uid();
  return coalesce(p_share, true);
end $function$;

comment on function public.set_share_location(boolean) is
  'Turn your own location sharing on or off. Only ever affects the caller.';

-- ---------------------------------------------------------------------------
-- 4. Grants. anon holds nothing (0154); these are for signed-in members only.
-- ---------------------------------------------------------------------------
revoke all on function public.last_seen() from public, anon;
revoke all on function public.set_share_location(boolean) from public, anon;
grant execute on function public.last_seen() to authenticated;
grant execute on function public.set_share_location(boolean) to authenticated;

-- The lookup this leans on: newest ping per person.
create index if not exists location_pings_profile_recorded_idx
  on public.location_pings (profile_id, recorded_at desc);

commit;
