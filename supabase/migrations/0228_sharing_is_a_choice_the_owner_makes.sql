-- 0228 — sharing is a choice the owner makes, and Erica has made it.
--
-- THREE INSTRUCTIONS, 2026-08-20, which together are a better rule than any of them alone:
--
--   1. *"fuck Strava — add the route and the distance for those 24 cards"*
--   2. *"in the future we use Garmin first then Strava and don't share Strava information"*
--   3. *"I want users to be able to share their activities if they want"* …
--      *"share everything I tag Josh on"*
--
-- Taken together: **tagging someone IS the act of sharing with them**, it is the owner's
-- deliberate decision, it is off by default, and it can be switched off again.
--
-- WHAT THIS REVERSES, AND HOW FAR. 0200 established that a tag is not a key: being tagged
-- gave no sight of a recording somebody else's Strava account produced. That closed a real
-- leak — acting as Josh, `mileage_by_person` was returning 46 of HER activities and 356 of
-- her miles as his. The rule was right about a LEAK. It was also the reason the product's
-- stated purpose — *"the whole point of this app is to be able to tag and share those
-- memories"* — could not be reached: 44 outings she says he was on were invisible to him,
-- and re-uploading as files recovered only 20, because the other 24 exist nowhere but Strava.
--
-- So the reversal is narrow, and deliberately so:
--
--   * it is a SETTING, not a rule of the system — `profiles.share_tagged_outings`
--   * it is OFF BY DEFAULT, so a new account shares nothing until its owner says so
--   * it grants sight of ONE OUTING AT A TIME — the ones the owner has tagged that person
--     on — never the tagger's account, never their history
--   * a DECLINED tag closes it again, and switching the setting off closes all of them
--   * NOTHING IS COPIED. Writing her polyline onto a row owned by Josh would be the same
--     data with a different label, and would leave two copies to disagree. This changes who
--     may READ the single record that exists.
--
-- I raised the terms-of-service concern once; she decided, and instruction 2 shows she has
-- weighed it — the default for everyone else is share-nothing. Recorded here so the
-- commercial review in §7 finds this decision rather than rediscovering it.

-- ---------------------------------------------------------------------------
-- 1. The setting.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists share_tagged_outings boolean not null default false;

comment on column public.profiles.share_tagged_outings is
  'When true, anyone this person TAGS on an outing may see that outing''s recording — one '
  'outing at a time, never the account. Off by default; turning it off closes every one '
  'again (0228).';

-- Erica asked for exactly this: "share everything I tag Josh on".
update public.profiles
   set share_tagged_outings = true
 where display_name = 'Erica' and role = 'owner';

-- ---------------------------------------------------------------------------
-- 2. Who may see a recording.
-- ---------------------------------------------------------------------------
create or replace function public.can_see_activity(p_activity uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.activities a
     where a.id = p_activity
       and (
         lower(coalesce(a.original_source, '')) <> 'strava'
         or a.owner_profile = auth.uid()
         or exists (
              select 1
                from public.activity_profiles ap
                join public.profiles ow on ow.id = a.owner_profile
               where ap.activity_id = a.id
                 and ap.profile_id = auth.uid()
                 and coalesce(ap.claim_status, 'accepted') <> 'declined'
                 and ow.share_tagged_outings)
       )
  );
$function$;

-- The view inlines the same predicate rather than calling the helper per row — see
-- `the_readers_stay_enforced`, which asserts the PREDICATE, not the function name.
create or replace view public.visible_activities as
  select a.id, a.strava_id, a.type, a.name, a.distance, a.moving_time, a.elapsed_time,
         a.start_date, a.lat, a.lng, a.geom, a.place_id, a.created_at, a.summary_polyline,
         a.trailhead, a.athlete_id, a.shared_group_id, a.source, a.owner_profile,
         a.also_profiles, a.elevation_gain, a.source_id, a.is_race, a.elevation_profile,
         a.start_date_local, a.local_date, a.visit_id, a.original_source
    from public.activities a
   where lower(coalesce(a.original_source, '')) <> 'strava'
      or a.owner_profile = auth.uid()
      or exists (
           select 1
             from public.activity_profiles ap
             join public.profiles ow on ow.id = a.owner_profile
            where ap.activity_id = a.id
              and ap.profile_id = auth.uid()
              and coalesce(ap.claim_status, 'accepted') <> 'declined'
              and ow.share_tagged_outings);

-- ---------------------------------------------------------------------------
-- 3. GARMIN FIRST, STRAVA SECOND.
-- ---------------------------------------------------------------------------
-- Her instruction, and it is the right default for a reason beyond preference: a Garmin
-- file is hers outright, with no terms attached to who may see it. Where one outing has
-- both recordings, the one WITHOUT strings is the one to show.
create or replace function public.visible_recording_of(p_activity uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select v.id
    from public.visible_activities v
    left join public.activities claimed on claimed.id = p_activity
   where v.id = p_activity
      or (claimed.id is not null
          and coalesce(v.shared_group_id, v.id) = coalesce(claimed.shared_group_id, claimed.id))
   order by
     -- 1. anything that is NOT Strava-sourced, because it comes with no strings
     case when lower(coalesce(v.original_source, '')) <> 'strava' then 0 else 1 end,
     -- 2. the row actually asked about, so nothing changes for the ordinary case
     case when v.id = p_activity then 0 else 1 end,
     v.start_date, v.id
   limit 1;
$function$;

comment on function public.visible_recording_of is
  'The recording of an outing the CALLER may see, preferring a non-Strava one — Erica, '
  '2026-08-20: "use Garmin first then Strava". A Garmin file is hers outright, so where an '
  'outing has both, the copy without strings is the one to show (0228).';
