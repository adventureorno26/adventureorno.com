-- 0200 — Strava visibility follows the SOURCE OWNER, not a tag.
--
-- Measured on production 2026-08-17, acting as Josh by setting request.jwt.claims:
-- `mileage_by_person(josh)` returned 124 activities and 992.5 miles, of which **46
-- activities and 356.1 miles were Erica's Strava runs**. His own stats screen was showing
-- him her mileage.
--
-- THE GUARD WAS NOT THE PROBLEM. 0193 built `can_see_activity`, 0196 moved fifteen readers
-- onto `visible_activities`, and both are correct. They ask *"does the caller have an
-- `activity_profiles` row?"* — and a tag is something anyone can be given. 0039 gave Josh
-- 44 of them in one `UPDATE`, by date, and pressing **Together** gives more.
--
-- A TAG IS A TRUE STATEMENT ABOUT AN OUTING. IT IS NOT A KEY TO STRAVA'S COPY OF IT.
-- Strava's terms are about whose ACCOUNT the data came from. "Josh was there too" can be
-- perfectly true and still not entitle him to Strava's record of it. Separating those two
-- ideas is the whole of this migration, and it is what lets Erica KEEP the co-attribution
-- she deliberately backfilled (she confirmed 2026-08-17 that it was meant) while the
-- Strava rule still holds.
--
-- WHY `owner_profile` AND NOT A JOIN TO `strava_accounts`. The first draft of this plan
-- routed visibility through `athlete_id → strava_accounts.profile_id`. A review caught
-- that `strava_accounts.profile_id` is `ON DELETE SET NULL`, so a disconnect or a
-- reconnection would move access to HISTORICAL data — authorization hanging off a
-- mutable credential row. The reviewer proposed a new `source_profile_id` column.
-- Checking found neither is needed: **`owner_profile` is already that snapshot.**
-- `set_activity_owner` resolves it from the athlete at INSERT and stores it; all 180
-- Strava rows match their athlete's profile with none null; and all three functions that
-- touch it — `set_activity_owner`, `import_file_activity`, `match_photo` — only ever set
-- it on INSERT. So it is already immutable in practice. Below it becomes immutable by
-- construction.

-- ---------------------------------------------------------------------------
-- 1. The source owner cannot be reassigned.
-- ---------------------------------------------------------------------------
-- NULL → a value is still allowed: that is a backfill filling in something unknown.
-- A value → a DIFFERENT value is refused, because that is a change of whose data it is,
-- and this column is now load-bearing for a privacy rule.
create or replace function public.owner_profile_is_immutable()
returns trigger
language plpgsql
as $function$
begin
  if old.owner_profile is not null
     and new.owner_profile is distinct from old.owner_profile then
    raise exception
      'owner_profile is the source owner of activity % and cannot be reassigned (was %, tried %)',
      old.id, old.owner_profile, new.owner_profile
      using errcode = '42501';
  end if;
  return new;
end $function$;

drop trigger if exists trg_owner_profile_immutable on public.activities;
create trigger trg_owner_profile_immutable
  before update on public.activities
  for each row execute function public.owner_profile_is_immutable();

-- ---------------------------------------------------------------------------
-- 2. The helper, the view and the POLICY — all three, or the leak stays open.
-- ---------------------------------------------------------------------------
-- The RLS policy carried its own copy of the tag predicate. Fixing the view alone would
-- have left `select * from activities` answering differently from the readers, which is
-- the "two tools disagreeing about the same question" shape this file already has a scar
-- from.
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
       and (lower(coalesce(a.original_source, '')) <> 'strava'
            or a.owner_profile = auth.uid())
  );
$function$;

comment on function public.can_see_activity(uuid) is
  'Strava-origin activities are visible ONLY to the profile that owns the Strava account '
  'they came from (activities.owner_profile, an immutable snapshot). Being tagged as a '
  'participant does NOT grant access: a true "we were both there" is a fact about the '
  'outing, not permission to see Strava''s copy of it.';

-- Same 28 columns in the same order, so every reader 0196 moved onto this keeps working.
create or replace view public.visible_activities as
  select a.*
    from public.activities a
   where lower(coalesce(a.original_source, '')) <> 'strava'
      or a.owner_profile = auth.uid();

comment on view public.visible_activities is
  'Activities the caller may see. Non-Strava: any member. Strava-origin: only the account '
  'owner, by owner_profile — never by tag (0200).';

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities
  for select
  using (
    public.is_member()
    and (lower(coalesce(original_source, '')) <> 'strava'
         or owner_profile = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 3. The blanket rule loses its future tense.
-- ---------------------------------------------------------------------------
-- Erica, 2026-08-17: "the blanket rule should not apply to future ingests, it was just
-- meant for the specific timeline when I initially added activities."
--
-- So the history STAYS — see part 4 — and only the forward branch goes. `import_file_activity`
-- credited every owner/editor for any file dated on or after 2025-12-21. From here an
-- import is the importer's own, whatever its date, and a joint outing has to be earned:
-- either the other person imports their own recording of it, or they are tagged and (per
-- §A) accept it.
--
-- NOTE: `rebuild_place_visits` carries the same fallback for VISITS and is deliberately
-- NOT touched here. It rewrites participants for 65 non-manual visits (121 rows), which
-- is Erica's visible data, so it is a separate change with her approval rather than a
-- side effect of this one.
create or replace function public.import_file_activity(
  p_name text, p_type text, p_polyline text, p_distance double precision,
  p_moving integer, p_lat double precision, p_lng double precision,
  p_date timestamp with time zone)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_place uuid;
  v_id uuid;
  v_pt geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Already mine? Same outing, re-imported.
  select id into v_id from public.activities
   where owner_profile = v_me
     and abs(extract(epoch from (start_date - p_date))) < 600
     and (type = p_type
          or abs(coalesce(distance,0) - coalesce(p_distance,0)) < greatest(80, coalesce(p_distance,0)*0.06))
   limit 1;
  if v_id is not null then return v_id; end if;

  -- SOMEONE ELSE'S RECORDING OF THE SAME OUTING IS *THEIRS*, NOT EVERYONE'S.
  --
  -- This branch used to delete every `activity_profiles` row and re-credit the activity to
  -- all owners and editors. That is how one person's file import silently rewrote whose
  -- outing it was — and, because `visible_activities` trusted those rows, how it handed
  -- out Strava data. It no longer changes attribution at all. Phase 7a replaces the whole
  -- path with an evidence model, where a second person's recording becomes a SOURCE and a
  -- linked joint outing instead of a rewrite; until then, doing nothing is correct.
  if p_lat is not null and p_lng is not null then
    select id into v_id from public.activities a
     where a.owner_profile is not null and a.owner_profile <> v_me
       and a.type = p_type
       and a.start_date::date = p_date::date
       and a.geom is not null and st_dwithin(a.geom, v_pt, 800)
       and abs(coalesce(a.distance,0) - coalesce(p_distance,0)) <= 804
     limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  v_place := public.place_for_activity(p_lat, p_lng, p_type, p_name);
  insert into public.activities
    (strava_id, type, name, distance, moving_time, start_date, lat, lng,
     place_id, summary_polyline, source, owner_profile)
  values
    (null, p_type,
     public.activity_display_name(p_name, v_place, p_type),
     coalesce(p_distance, 0), p_moving, p_date, p_lat, p_lng,
     v_place, p_polyline, 'file', v_me)
  returning id into v_id;

  -- THE IMPORTER'S OWN, whatever the date. No cutoff, no co-attribution.
  delete from public.activity_profiles where activity_id = v_id;
  insert into public.activity_profiles (activity_id, profile_id)
  values (v_id, v_me)
  on conflict do nothing;

  if v_place is not null then
    perform public.recompute_place_stats(v_place);
    perform public.rebuild_place_visits(v_place);
  end if;
  return v_id;
end $function$;

-- ---------------------------------------------------------------------------
-- 4. The history stays, and says how it got here.
-- ---------------------------------------------------------------------------
-- "44 of them carry the fingerprint" describes how the rows were WRITTEN. It is not
-- independent proof that each outing was shared. Recording that distinction costs three
-- columns and stops a later reader treating a date-driven backfill as evidence.
--
-- `unknown` is a valid, explicit state and is the default. Nothing here guesses.
alter table public.activity_profiles
  add column if not exists claim_status text not null default 'accepted',
  add column if not exists evidence     text not null default 'unknown',
  add column if not exists created_by   text not null default 'unknown';

alter table public.activity_profiles
  drop constraint if exists activity_profiles_claim_status_ck;
alter table public.activity_profiles
  add constraint activity_profiles_claim_status_ck
  check (claim_status in ('accepted', 'accepted_legacy', 'proposed', 'rejected'));

comment on column public.activity_profiles.evidence is
  'How this participation came to be believed: owner_asserted_date_backfill (0039''s '
  'blanket rule), import (the person imported their own recording), tagged (a person said '
  'so), or unknown. It is NOT a claim that the outing was independently proven shared.';

-- The 0039 backfill, labelled for what it is: Erica asserting a period, by date.
update public.activity_profiles ap
   set claim_status = 'accepted_legacy',
       evidence     = 'owner_asserted_date_backfill',
       created_by   = 'migration'
  from public.activities a
 where a.id = ap.activity_id
   and array_length(a.also_profiles, 1) is not null
   and ap.profile_id = any(a.also_profiles)
   and ap.evidence = 'unknown';
