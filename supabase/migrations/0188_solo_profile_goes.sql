-- 0188 — §0.8 phase 8, step 3 finished: solo_profile goes.
--
-- `visits.solo_profile` and `activities.solo_profile` are a uuid that is NULL to mean
-- "everybody". That has exactly two states, which is enough for a household of two by
-- accident and cannot describe three at all — there is no value that means "Erica and
-- Sam but not Josh". Every statistic in this app was scoped by it, so it is the thing
-- standing between this and a third person joining.
--
-- The replacement has been live and proven for days: `visit_profiles` and
-- `activity_profiles`, backfilled in 0165 and 0173, kept in step by triggers ever since,
-- and measured repeatedly at ZERO disagreement with the column on every visit and every
-- activity. Nothing in the app has read the column since step 3e.
--
-- FOURTEEN FUNCTIONS referenced it, and each is converted here rather than dropped:
--
--   set_visit_solo / set_place_solo / set_activity_solo   write participant ROWS
--   set_visit_participants        stops mirroring into the column
--   create_experience             writes the visit's people as rows
--   add_activity_to_visit         the route inherits the VISIT's people
--   add_place_to_visit            the child's visit inherits the parent's people
--   import_file_activity          the importer's own history, or everyone's
--   rebuild_place_visits          writes the attribution it always computed, as rows
--   restore_visit / visit_detail  stop carrying the column
--   accepted_visits               rebuilt without it
--   visits_sync_participants      DROPPED — there is no column left to sync from
--   activities_sync_participants  DROPPED — likewise
--
-- The two sync triggers are the reason this is one migration and not several: they copy
-- the column into the rows, so while the column exists they would keep overwriting what
-- these functions now write directly.
--
-- ROLLBACK: this one is genuinely hard to reverse — the column is dropped and its values
-- are only recoverable from a backup. The parity that justifies it was measured on
-- production immediately before: 0 visits and 0 activities where the rows and the column
-- disagree. A fresh encrypted backup exists (§6b).

begin;

-- ---------------------------------------------------------------------------
-- 1. The writers write rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_visit_solo(p_visit uuid, p_profile uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  -- Writes the ROWS now. p_profile null still means everyone, which is the same
  -- promise the column made — it just could not keep it for three people.
  perform public.set_visit_participants(
    p_visit,
    case when p_profile is not null then array[p_profile]
         else array(select id from public.profiles
                     where role in ('owner','editor')
                       and coalesce(display_name,'') !~* '(test|bot)') end);
  update public.visits set solo_override = true where id = p_visit;
end $function$

;

CREATE OR REPLACE FUNCTION public.set_place_solo(p_place uuid, p_profile uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  -- Every visit at this place, through the same door as one visit.
  perform public.set_visit_solo(v.id, p_profile) from public.visits v where v.place_id = p_place;
  update public.visits set manual = true where place_id = p_place;
end $function$

;

CREATE OR REPLACE FUNCTION public.set_activity_solo(p_activity uuid, p_profile uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pl uuid;
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  select place_id into pl from public.activities where id = p_activity;

  delete from public.activity_profiles where activity_id = p_activity;
  insert into public.activity_profiles (activity_id, profile_id)
  select p_activity, x
    from unnest(case when p_profile is not null then array[p_profile]
                     else array(select id from public.profiles
                                 where role in ('owner','editor')
                                   and coalesce(display_name,'') !~* '(test|bot)') end) x
  on conflict do nothing;
  if pl is not null then
    perform public.recompute_place_stats(pl);
    perform public.rebuild_place_visits(pl);
  end if;
end $function$

;

CREATE OR REPLACE FUNCTION public.set_visit_participants(p_visit uuid, p_profiles uuid[])
 RETURNS SETOF visit_profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.visits where id = p_visit) then
    raise exception 'no such visit';
  end if;
  if coalesce(array_length(p_profiles, 1), 0) = 0 then
    raise exception 'a visit needs at least one participant';
  end if;
  if exists (select 1 from unnest(p_profiles) x
              where not exists (select 1 from public.profiles p where p.id = x)) then
    raise exception 'unknown profile in the participant list';
  end if;

  delete from public.visit_profiles where visit_id = p_visit;
  insert into public.visit_profiles (visit_id, profile_id)
  select p_visit, x from unnest(p_profiles) x
  on conflict do nothing;

  update public.visits set solo_override = true where id = p_visit;

  return query select * from public.visit_profiles where visit_id = p_visit;
end $function$

;

-- ---------------------------------------------------------------------------
-- 2. The creators record who was there
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_experience(p_key text, p_place jsonb, p_visit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_place    uuid;
  v_visit    uuid;
  v_prior    record;
  v_name     text;
  v_lat      float8;
  v_lng      float8;
  v_start    date;
  v_end      date;
  v_who      text;
  v_solo     uuid;
  v_override boolean := false;
  v_partof   uuid[];
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_key is null or length(btrim(p_key)) = 0 then
    raise exception 'idempotency key required';
  end if;

  -- Serialize concurrent calls that share a key so the retry observes the winner.
  perform pg_advisory_xact_lock(hashtext('create_experience:' || p_key));

  -- Idempotent short-circuit: this key already produced a graph — return it as-is.
  select place_id, visit_id into v_prior
    from public.experience_requests where idempotency_key = p_key;
  if found then
    return jsonb_build_object(
      'place_id', v_prior.place_id, 'visit_id', v_prior.visit_id, 'idempotent', true);
  end if;

  -- 1) Resolve the place. An explicit id reuses an existing place (validated);
  --    otherwise create a new one (coordinates are always required by the schema).
  v_place := nullif(p_place->>'id', '')::uuid;
  if v_place is not null then
    if not exists (select 1 from public.places where id = v_place) then
      raise exception 'place % not found', v_place;
    end if;
  else
    v_name := btrim(coalesce(p_place->>'name', ''));
    v_lat  := nullif(p_place->>'lat', '')::float8;
    v_lng  := nullif(p_place->>'lng', '')::float8;
    -- Unnamed places stay an explicit opt-in, not an accident.
    if v_name = '' and not coalesce((p_place->>'allow_unnamed')::boolean, false) then
      raise exception 'a new place requires a name';
    end if;
    if v_lat is null or v_lng is null then
      raise exception 'a new place requires coordinates';
    end if;

    v_partof := coalesce(
      (select array_agg(value::uuid) from jsonb_array_elements_text(p_place->'part_of')),
      '{}'::uuid[]);
    -- A parent must exist; otherwise membership sync would silently drop it.
    if array_length(v_partof, 1) is not null then
      if exists (
        select 1 from unnest(v_partof) pid
         where not exists (select 1 from public.places where id = pid))
      then
        raise exception 'part_of references a place that does not exist';
      end if;
    end if;

    insert into public.places (
      name, lat, lng, country, admin1, city, address, categories, saved, created_by,
      is_trail, bucket, needs_geocode, website, auto, part_of, review)
    values (
      v_name, v_lat, v_lng,
      nullif(p_place->>'country', ''),
      nullif(p_place->>'admin1', ''),
      nullif(p_place->>'city', ''),
      nullif(p_place->>'address', ''),
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(p_place->'categories')),
        '{}'::text[]),
      coalesce((p_place->>'saved')::boolean, true),
      v_uid,
      coalesce((p_place->>'is_trail')::boolean, false),
      coalesce((p_place->>'bucket')::boolean, false),
      coalesce((p_place->>'needs_geocode')::boolean, false),
      nullif(p_place->>'website', ''),
      coalesce((p_place->>'auto')::boolean, false),
      v_partof,
      nullif(p_place->>'review', ''))
    returning id into v_place;
  end if;

  -- 2) Optional visit — created only when a date is supplied (some callers just
  --    create/rename a place). A single-day visit collapses start = end.
  v_start := nullif(p_visit->>'date', '')::date;
  v_end   := coalesce(nullif(p_visit->>'end_date', '')::date, v_start);
  if v_start is not null then
    -- Attribution: who = 'me' | 'both' | <profile-uuid>. Empty = leave unset.
    --
    -- 'josh' USED TO BE A VALUE HERE, resolved by matching a profile's display name. A person
    -- was hardcoded into the database: rename that profile and attribution silently
    -- stopped working, and a third member could never be named at all (§0.3). The
    -- caller now sends a profile id, which cannot mean the wrong person.
    v_who := lower(coalesce(p_visit->>'who', ''));
    if v_who = 'both' then
      v_solo := null; v_override := true;
    elsif v_who = 'me' then
      v_solo := v_uid; v_override := true;
    elsif v_who <> '' then
      begin
        v_solo := (p_visit->>'who')::uuid;
      exception when invalid_text_representation then
        raise exception 'who must be ''me'', ''both'' or a profile id, got %', p_visit->>'who';
      end;
      if not exists (select 1 from public.profiles where id = v_solo) then
        raise exception 'no such profile %', v_solo;
      end if;
      v_override := true;
    end if;

    -- is_trip is NOT set here: only a person marks a visit as a trip (0133).
    insert into public.visits (
      place_id, start_date, end_date, note,
      solo_override, manual, created_by)
    values (
      v_place, v_start, v_end,
      nullif(p_visit->>'note', ''),
      v_override, true, v_uid)
    returning id into v_visit;

    -- WHO WAS THERE, as rows, replacing the everyone-by-default the trigger wrote.
    delete from public.visit_profiles where visit_id = v_visit;
    insert into public.visit_profiles (visit_id, profile_id)
    select v_visit, x
      from unnest(case when v_solo is not null then array[v_solo]
                       else array(select id from public.profiles
                                   where role in ('owner','editor')
                                     and coalesce(display_name,'') !~* '(test|bot)') end) x
    on conflict do nothing;

    -- Non-login people (children) present on this visit.
    if p_visit ? 'person_ids' then
      insert into public.visit_people (visit_id, person_id)
      select v_visit, value::uuid
        from jsonb_array_elements_text(p_visit->'person_ids')
      on conflict do nothing;
    end if;
  end if;

  -- Sections 3 and 4 (the Trip link and the planned->completed promotion) are
  -- gone with the retired tables. A trip is a visit you marked, so there is no
  -- stop to create here. Fail loudly rather than silently ignore a caller that
  -- still passes one.
  if p_place ? 'trip' then
    raise exception 'a trip is a visit you marked — use set_visit_is_trip, not a trip link';
  end if;

  -- Rating (per-user place_ratings, mirrored to places.rating for the owner) —
  -- delegated to the canonical RPC so the rating model stays single-sourced.
  if nullif(p_visit->>'rating', '') is not null then
    perform public.set_my_rating(v_place, (p_visit->>'rating')::smallint);
  end if;

  -- Record the request so a retry is idempotent.
  insert into public.experience_requests (idempotency_key, created_by, place_id, visit_id)
  values (p_key, v_uid, v_place, v_visit);

  return jsonb_build_object('place_id', v_place, 'visit_id', v_visit, 'idempotent', false);
end
$function$

;

CREATE OR REPLACE FUNCTION public.add_activity_to_visit(p_visit uuid, p_option text, p_name text DEFAULT NULL::text, p_distance_m double precision DEFAULT NULL::double precision, p_client_key text DEFAULT NULL::text, p_day date DEFAULT NULL::date)
 RETURNS activities
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_day date;
  v_opt   public.activity_options;
  v_visit public.visits;
  v_row   public.activities;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_opt from public.activity_options where slug = p_option and active;
  if v_opt.slug is null then raise exception 'unknown activity option: %', p_option; end if;
  if v_opt.kind <> 'route' then
    raise exception 'option % creates a place — call add_place_to_visit', p_option;
  end if;

  select * into v_visit from public.visits where id = p_visit;
  if v_visit.id is null then raise exception 'no such visit'; end if;

  -- WHICH DAY. The card asks for it, so it has to mean something: on a week away, the
  -- run was on the Tuesday, not on the day the trip started. Defaults to the visit's
  -- first day and must fall inside it.
  v_day := coalesce(p_day, v_visit.start_date);
  if v_day < v_visit.start_date or v_day > coalesce(v_visit.end_date, v_visit.start_date) then
    raise exception 'that day is outside this visit (% to %)',
      v_visit.start_date, coalesce(v_visit.end_date, v_visit.start_date);
  end if;

  -- Idempotent retry: same key, same visit, same activity.
  if p_client_key is not null then
    -- source_id is the table's EXISTING external-identity column (Strava and imports
    -- already use it). Reusing it beats adding a second idempotency key that half the
    -- writers would forget.
    select * into v_row from public.activities
     where visit_id = p_visit and source_id = p_client_key limit 1;
    if v_row.id is not null then return v_row; end if;
  end if;

  -- local_date is GENERATED from start_date (0143) — it cannot be written, and the
  -- generated value is the one that is correct west of Greenwich anyway.
  insert into public.activities (place_id, visit_id, type, name, distance, start_date,
                                 source, source_id)
  values (v_visit.place_id, p_visit, v_opt.activity_type,
          coalesce(p_name, v_opt.label), coalesce(p_distance_m, 0),
          v_day::timestamptz,
          'manual', p_client_key)
  returning * into v_row;

  -- Whoever was on the visit did it, until someone says otherwise. Copied as ROWS,
  -- replacing the everyone-by-default rows the insert trigger just wrote.
  delete from public.activity_profiles where activity_id = v_row.id;
  insert into public.activity_profiles (activity_id, profile_id)
  select v_row.id, vp.profile_id from public.visit_profiles vp where vp.visit_id = p_visit
  on conflict do nothing;

  return v_row;
end $function$

;

CREATE OR REPLACE FUNCTION public.add_place_to_visit(p_visit uuid, p_option text, p_name text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_client_key text DEFAULT NULL::text, p_day date DEFAULT NULL::date)
 RETURNS places
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_day date;
  v_opt    public.activity_options;
  v_visit  public.visits;
  v_parent public.places;
  v_place  public.places;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'a place needs a name'; end if;

  select * into v_opt from public.activity_options where slug = p_option and active;
  if v_opt.slug is null then raise exception 'unknown activity option: %', p_option; end if;
  if v_opt.kind <> 'place' then
    raise exception 'option % creates a route — call add_activity_to_visit', p_option;
  end if;

  select * into v_visit from public.visits where id = p_visit;
  if v_visit.id is null then raise exception 'no such visit'; end if;

  -- The restaurant was on ONE day of the trip, not for the whole week. It used to
  -- inherit the parent's entire range, so a dinner on the Tuesday of a San Diego week
  -- read as a six-day visit to the restaurant.
  v_day := coalesce(p_day, v_visit.start_date);
  if v_day < v_visit.start_date or v_day > coalesce(v_visit.end_date, v_visit.start_date) then
    raise exception 'that day is outside this visit (% to %)',
      v_visit.start_date, coalesce(v_visit.end_date, v_visit.start_date);
  end if;
  select * into v_parent from public.places where id = v_visit.place_id;

  -- Reuse an existing child of the same name before creating another one.
  select p.* into v_place
    from public.places p
    join public.place_membership m on m.child_id = p.id and m.parent_id = v_parent.id
   where lower(btrim(p.name)) = lower(btrim(p_name)) and p.deleted_at is null
   limit 1;

  if v_place.id is null then
    insert into public.places (name, lat, lng, saved, categories, created_by)
    values (btrim(p_name),
            coalesce(p_lat, v_parent.lat), coalesce(p_lng, v_parent.lng),
            true, array[v_opt.place_category], auth.uid())
    returning * into v_place;

    -- A place that now holds a child IS a container. The existing membership guard
    -- refuses a parent without holds_children, and it is right to: this is the flag
    -- that says the parent can hold things. Setting it here keeps the flag TRUE to
    -- the fact instead of leaving it to drift — the derived-vs-source bug that has
    -- bitten this project repeatedly (§8).
    update public.places set holds_children = true
     where id = v_parent.id and not coalesce(holds_children, false);

    -- WRITE part_of, NOT place_membership. I had this backwards in 0164, and the
    -- comment there confidently said the opposite: `places.part_of` is the RECORD of
    -- membership, and `places_sync_membership` REBUILDS place_membership from that
    -- array whenever part_of changes. A row inserted straight into the mirror looks
    -- right until anyone edits that place's containers, at which point the trigger
    -- deletes it for not being in the array — silently.
    update public.places
       set part_of = (select array_agg(distinct x)
                        from unnest(coalesce(part_of, '{}'::uuid[]) || v_parent.id) x)
     where id = v_place.id
       and v_parent.id <> all (coalesce(part_of, '{}'::uuid[]));
  end if;

  -- Its dates are visits to it — Erica's words. Same day as the parent visit.
  insert into public.visits (place_id, start_date, end_date, status, manual, source,
                             accepted_at, accepted_by, parent_visit_id)
  select v_place.id, v_day, v_day, 'taken', true, 'manual',
         now(), auth.uid(),
         case when public.counts_as_trip(v_visit.*) then v_visit.id else null end
  where not exists (
    select 1 from public.visits x
     where x.place_id = v_place.id and x.start_date = v_day
  );

  -- The people who were on the parent visit were at the restaurant too. As ROWS, so
  -- 0170's check (everyone on a child was on the trip) can see them. This REPLACES the
  -- everyone-by-default rows the insert trigger just wrote.
  delete from public.visit_profiles vp
   using public.visits c
   where vp.visit_id = c.id and c.place_id = v_place.id and c.start_date = v_day;
  insert into public.visit_profiles (visit_id, profile_id)
  select c.id, vp.profile_id
    from public.visits c
    join public.visit_profiles vp on vp.visit_id = p_visit
   where c.place_id = v_place.id and c.start_date = v_day
  on conflict do nothing;

  return v_place;
end $function$

;

CREATE OR REPLACE FUNCTION public.import_file_activity(p_name text, p_type text, p_polyline text, p_distance double precision, p_moving integer, p_lat double precision, p_lng double precision, p_date timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_place uuid;
  v_id uuid;
  v_cutoff constant date := '2025-12-21';
  v_pt geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select id into v_id from public.activities
   where owner_profile = v_me
     and abs(extract(epoch from (start_date - p_date))) < 600
     and (type = p_type
          or abs(coalesce(distance,0) - coalesce(p_distance,0)) < greatest(80, coalesce(p_distance,0)*0.06))
   limit 1;
  if v_id is not null then return v_id; end if;

  if p_lat is not null and p_lng is not null then
    select id into v_id from public.activities a
     where a.owner_profile is not null and a.owner_profile <> v_me
       and a.type = p_type
       and a.start_date::date = p_date::date
       and a.geom is not null and st_dwithin(a.geom, v_pt, 800)
       and abs(coalesce(a.distance,0) - coalesce(p_distance,0)) <= 804
     limit 1;
    if v_id is not null then
      -- A re-import of the same outing is everyone's again, as it was.
      delete from public.activity_profiles where activity_id = v_id;
      insert into public.activity_profiles (activity_id, profile_id)
      select v_id, id from public.profiles
       where role in ('owner','editor') and coalesce(display_name,'') !~* '(test|bot)'
      on conflict do nothing;
      perform public.recompute_place_stats(place_id), public.rebuild_place_visits(place_id)
        from public.activities where id = v_id;
      return v_id;
    end if;
  end if;

  v_place := public.place_for_activity(p_lat, p_lng, p_type, p_name);
  insert into public.activities
    (strava_id, type, name, distance, moving_time, start_date, lat, lng,
     place_id, summary_polyline, source, owner_profile)
  values
    (null, p_type,
     -- CHANGED: was p_name. A clock reading is not a name — use the place.
     public.activity_display_name(p_name, v_place, p_type),
     coalesce(p_distance, 0), p_moving, p_date, p_lat, p_lng,
     v_place, p_polyline, 'file', v_me)
  returning id into v_id;

  -- Before the cutoff it is the importer's own history; after it, it is everyone's.
  delete from public.activity_profiles where activity_id = v_id;
  insert into public.activity_profiles (activity_id, profile_id)
  select v_id, x
    from unnest(case when p_date < v_cutoff then array[v_me]
                     else array(select id from public.profiles
                                 where role in ('owner','editor')
                                   and coalesce(display_name,'') !~* '(test|bot)') end) x
  on conflict do nothing;
  if v_place is not null then
    perform public.recompute_place_stats(v_place);
    perform public.rebuild_place_visits(v_place);
  end if;
  return v_id;
end
$function$

;

-- ---------------------------------------------------------------------------
-- 3. The derivation writes its attribution as rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rebuild_place_visits(p_place uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_erica uuid := (select id from public.profiles where role = 'owner'
                   and coalesce(display_name,'') !~* '(test|bot)' limit 1);
  v_cutoff constant date := '2025-12-21';
  -- Never trust a trip window longer than this many days (see the note above).
  v_max_trip_days constant int := 30;
begin
  -- 0161: this is HOUSEKEEPING, not a person's decision. visits_mark_decided()
  -- stands down while this is set, so a rebuild running inside a signed-in
  -- request stops marking every visit it touches as manual.
  perform set_config('aon.rebuilding', 'on', true);
  if p_place is null then return; end if;

  create temp table _isl_raw on commit drop as
  with days as (
    select coalesce(local_date, coalesce(taken_at, created_at)::date) d from public.photos
      where place_id = p_place and deleted_at is null and coalesce(taken_at, created_at) is not null
        and visit_id is null
    union select coalesce(local_date, start_date::date) from public.activities
      where place_id = p_place and start_date is not null
    union select recorded_at::date from public.location_pings where place_id = p_place
    union select date::date from public.entries
      where place_id = p_place and date is not null
    union select coalesce(a.local_date, a.start_date::date) from public.activities a
      join public.places mp on mp.id = a.place_id
      where a.start_date is not null and mp.id <> p_place and (
        p_place = any(mp.part_of)
        or exists (select 1 from public.places c where c.id = p_place
                   and c.boundary is not null and mp.geom is not null
                   and st_contains(c.boundary::geometry, mp.geom::geometry)))
    union select coalesce(ph.local_date, coalesce(ph.taken_at, ph.created_at)::date) from public.photos ph
      join public.places mp on mp.id = ph.place_id
      where ph.deleted_at is null and coalesce(ph.taken_at, ph.created_at) is not null and mp.id <> p_place and (
        p_place = any(mp.part_of)
        or exists (select 1 from public.places c where c.id = p_place
                   and c.boundary is not null and mp.geom is not null
                   and st_contains(c.boundary::geometry, mp.geom::geometry)))
    union select e.date::date from public.entries e
      join public.places mp on mp.id = e.place_id
      where e.date is not null and mp.id <> p_place and p_place = any(mp.part_of)
  ),
  dd  as (select distinct d from days),
  grp as (select d, d - (row_number() over (order by d))::int as isl from dd)
  select min(d) as s, max(d) as e from grp group by isl;

  -- Fuse islands that fall inside the same confirmed trip window.
  create temp table _isl on commit drop as
  with usable_trips as (
    -- A trip is a VISIT somebody marked (docs/SCHEMA.md), so the window comes
    -- from visits.is_trip now that the old table is gone. Windows stay GLOBAL
    -- rather than per-place, exactly as before: the Cape Cod trip is what fuses
    -- the separate days at Linnell Landing into one stay.
    select v.id, v.start_date, v.end_date
      from public.visits v
     where v.is_trip
       and v.status = 'taken'
       and v.start_date is not null
       and v.end_date is not null
       and (v.end_date - v.start_date) <= v_max_trip_days
  ),
  mapped as (
    select i.s, i.e,
           (select t.id from usable_trips t
             where t.start_date <= i.e and t.end_date >= i.s
             order by t.start_date, t.id
             limit 1) as trip_id
      from _isl_raw i
  )
  select min(s) as s, max(e) as e
    from mapped
   -- islands sharing a trip collapse into one; untripped islands keep their own key
   group by coalesce(trip_id::text, s::text || '|' || e::text);

  -- An island already covered by a MANUAL visit does not need a derived twin.
  -- Cape Cod is the case: photos on Aug 2-6 sit entirely inside the marked trip
  -- Aug 2-7, and rebuilding produced a second "Aug 2-7" visit beside the trip.
  -- Manual visits are protected from the delete below, so without this the two
  -- accumulate. Partial overlaps still get their own visit — those days really are
  -- outside the marked span.
  delete from _isl i
   where exists (select 1 from public.visits v
                  where v.place_id = p_place and v.manual
                    and i.s >= v.start_date and i.e <= v.end_date);

  create temp table _isln on commit drop as
  select i.s, i.e,
    (select string_agg(v.note, ' / ' order by v.start_date) from public.visits v
       where v.place_id = p_place and not v.manual and v.note is not null
         and v.start_date <= i.e and v.end_date >= i.s) as note,
    exists (select 1 from public.visits v
       where v.place_id = p_place and not v.manual and v.solo_override
         and v.start_date <= i.e and v.end_date >= i.s) as ovr,
    -- The overriding visit's own attribution, from its PARTICIPANT ROWS: exactly one
    -- person means that person, anything else means everyone (null).
    (select case when count(*) = 1 then min(vp.profile_id::text)::uuid end
       from public.visit_profiles vp
      where vp.visit_id = (select v.id from public.visits v
                            where v.place_id = p_place and not v.manual and v.solo_override
                              and v.start_date <= i.e and v.end_date >= i.s
                            order by v.start_date limit 1)) as ovr_profile,
    (with a as (
        select count(*) n,
               array_agg(distinct owner_profile) filter (where owner_profile is not null) owners
        from public.activities
          where place_id = p_place and coalesce(local_date, start_date::date) between i.s and i.e)
     select case
       -- Every activity in the window recorded by ONE person, and not the account
       -- owner: that window is theirs. This used to name that person literally.
       when a.n > 0 and array_length(a.owners, 1) = 1 and a.owners[1] <> v_erica
         then a.owners[1]
       when i.s < v_cutoff then v_erica
       else null end
     from a) as inferred
  from _isl i;

  create temp table _match on commit drop as
  select n.s, n.e, n.note, n.ovr, n.ovr_profile, n.inferred,
    (select v.id from public.visits v
       where v.place_id = p_place and not v.manual
         and v.start_date <= n.e and v.end_date >= n.s
       order by (least(v.end_date, n.e) - greatest(v.start_date, n.s)) desc, v.start_date, v.id
       limit 1) as reuse_id
  from _isln n;
  update _match m set reuse_id = null
   where reuse_id is not null
     and exists (select 1 from _match m2 where m2.reuse_id = m.reuse_id and (m2.s, m2.e) < (m.s, m.e));

  update public.visits v
     set start_date = m.s, end_date = m.e, note = m.note,
         solo_override = m.ovr
  from _match m where v.id = m.reuse_id;

  delete from public.visits v
   where v.place_id = p_place and not v.manual
     and not exists (select 1 from _match m where m.reuse_id = v.id)
     -- A photo pinned to this visit IS a decision, even when the visit itself
     -- was never marked manual. The FK is ON DELETE SET NULL, so deleting the
     -- visit would silently unpin her photos — which is exactly how this kept
     -- undoing her work.
     and not exists (select 1 from public.photos ph
                     where ph.visit_id = v.id and ph.deleted_at is null);

  insert into public.visits (place_id, start_date, end_date, note, solo_override)
    select p_place, m.s, m.e, m.note, m.ovr
    from _match m where m.reuse_id is null;

  -- WHO WAS ON EACH DERIVED VISIT, as rows. The attribution is the same one this
  -- function has always computed — the override if there is one, otherwise inferred
  -- from who recorded the activities — it is simply written where everything now
  -- reads it. A null attribution means everyone, exactly as the column's null did.
  delete from public.visit_profiles vp
   using public.visits v, _match m
   where vp.visit_id = v.id and v.place_id = p_place and not v.manual
     and v.start_date = m.s and v.end_date = m.e;

  insert into public.visit_profiles (visit_id, profile_id)
  select v.id, x
    from _match m
    join public.visits v
      on v.place_id = p_place and not v.manual and v.start_date = m.s and v.end_date = m.e
    cross join lateral unnest(
      case when coalesce(case when m.ovr then m.ovr_profile else m.inferred end, null) is not null
           then array[case when m.ovr then m.ovr_profile else m.inferred end]
           else array(select id from public.profiles
                       where role in ('owner','editor')
                         and coalesce(display_name,'') !~* '(test|bot)') end) x
  on conflict do nothing;

  drop table if exists _isl_raw;
  drop table if exists _isl;
  drop table if exists _isln;
  drop table if exists _match;

  perform set_config('aon.rebuilding', 'off', true);
end $function$

;

-- ---------------------------------------------------------------------------
-- 4. The rest stop carrying the column
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_visit(p_snapshot jsonb)
 RETURNS visits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_in    public.visits;
  v_row   public.visits;
  v_profs uuid[];
  v_kids  uuid[];
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_snapshot is null or p_snapshot->'visit' is null then
    raise exception 'restore_visit needs the snapshot delete_visit returned';
  end if;

  v_in := jsonb_populate_record(null::public.visits, p_snapshot->'visit');
  if v_in.place_id is null then raise exception 'the snapshot has no place'; end if;

  -- Reuse the original id when it is still free, so anything that kept a reference
  -- (a photo, an activity, a link someone copied) points at the restored visit.
  if exists (select 1 from public.visits where id = v_in.id) then
    v_in.id := gen_random_uuid();
  end if;

  insert into public.visits (id, place_id, start_date, end_date, note, status, manual,
                             trip_marked, solo_override, source, client_key)
  values (v_in.id, v_in.place_id, v_in.start_date, v_in.end_date, v_in.note,
          coalesce(v_in.status,'taken'), true, coalesce(v_in.trip_marked,false),
          v_in.solo_override, v_in.source, null)
  returning * into v_row;

  select coalesce(array_agg((x)::uuid), '{}') into v_profs
    from jsonb_array_elements_text(coalesce(p_snapshot->'profiles','[]'::jsonb)) x;
  if array_length(v_profs,1) > 0 then
    perform public.set_visit_participants(v_row.id, v_profs);
  end if;

  insert into public.visit_people (visit_id, person_id)
  select v_row.id, (x)::uuid
    from jsonb_array_elements_text(coalesce(p_snapshot->'people','[]'::jsonb)) x
  on conflict do nothing;

  insert into public.visit_evidence (visit_id, evidence_type, evidence_id, evidence_date, source_key)
  select v_row.id, e->>'evidence_type', (e->>'evidence_id')::uuid,
         (e->>'evidence_date')::date, e->>'source_key'
    from jsonb_array_elements(coalesce(p_snapshot->'evidence','[]'::jsonb)) e
  on conflict do nothing;

  -- Put back what was inside it, and its own place in a larger trip.
  select coalesce(array_agg((x)::uuid), '{}') into v_kids
    from jsonb_array_elements_text(coalesce(p_snapshot->'children','[]'::jsonb)) x;
  if array_length(v_kids,1) > 0 and public.counts_as_trip(v_row.*) then
    perform public.attach_child_visit(k, v_row.id)
       from unnest(v_kids) k
      where exists (select 1 from public.visits where id = k);
  end if;

  if v_in.parent_visit_id is not null
     and exists (select 1 from public.visits where id = v_in.parent_visit_id) then
    perform public.attach_child_visit(v_row.id, v_in.parent_visit_id);
    select * into v_row from public.visits where id = v_row.id;
  end if;

  return v_row;
end $function$

;

CREATE OR REPLACE FUNCTION public.visit_detail(p_visit uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.assert_member();

  select jsonb_build_object(
    'visit', to_jsonb(v) - 'geom',
    -- WHO WAS THERE, as rows. The page read `visit.solo_profile`, which can say one
    -- person or everybody and nothing in between (§0.3).
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.display_name)
                                         order by pr.display_name)
                          from public.visit_profiles vp
                          join public.profiles pr on pr.id = vp.profile_id
                         where vp.visit_id = v.id), '[]'::jsonb),
    'place', jsonb_build_object(
        'id', p.id, 'name', p.name, 'admin1', p.admin1, 'country', p.country,
        'address', p.address, 'lat', p.lat, 'lng', p.lng, 'is_trail', p.is_trail),
    -- The activities OF THIS VISIT. activities.visit_id has held the answer since 0164;
    -- this used to re-derive it from dates and the place, and got it wrong whenever two
    -- visits to one place shared a day.
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'name', a.name, 'type', a.type, 'distance', a.distance,
               'elevation_gain', a.elevation_gain, 'moving_time', a.moving_time,
               'local_date', a.local_date, 'start_date', a.start_date,
               'place_id', a.place_id,
               'people', coalesce((select jsonb_agg(pr.display_name order by pr.display_name)
                                     from public.activity_profiles ap
                                     join public.profiles pr on pr.id = ap.profile_id
                                    where ap.activity_id = a.id), '[]'::jsonb))
               order by a.start_date)
        from public.activities a
       where a.visit_id = v.id
         -- one row per outing: a duplicate recorded twice is still one thing you did
         and a.id = (select a2.id from public.activities a2
                      where coalesce(a2.shared_group_id, a2.id) = coalesce(a.shared_group_id, a.id)
                      order by (a2.summary_polyline is not null) desc,
                               (a2.source = 'strava') desc, a2.id
                      limit 1)), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ph.id, 'taken_at', ph.taken_at, 'local_date', ph.local_date,
               'caption', ph.caption, 'pinned', coalesce(ph.visit_id = v.id, false))
               order by ph.taken_at)
        from public.photos ph
       where ph.deleted_at is null
         and (ph.visit_id = v.id
              or (ph.visit_id is null and ph.place_id = v.place_id
                  and coalesce(ph.local_date, ph.taken_at::date)
                      between v.start_date and v.end_date))), '[]'::jsonb),
    -- What is inside this trip. `counts_as_trip`, not raw is_trip: a multi-day visit is
    -- a trip whether or not anyone marked it (§0.4), and its contents should show.
    'contents', case when public.counts_as_trip(v.*) then coalesce((
      select jsonb_agg(jsonb_build_object(
               'place_id', c.place_id, 'place_name', c.place_name,
               'visit_id', c.visit_id, 'start_date', c.start_date, 'end_date', c.end_date)
               order by c.start_date)
        from public.trip_contents(v.id) c), '[]'::jsonb) else '[]'::jsonb end
  )
  from public.visits v
  join public.places p on p.id = v.place_id
  where v.id = p_visit;
$function$

;

-- ---------------------------------------------------------------------------
-- 5. The mirrors, the view, and the columns
-- ---------------------------------------------------------------------------
drop trigger if exists visits_sync_participants on public.visits;
drop trigger if exists activities_sync_participants on public.activities;
drop function if exists public.visits_sync_participants();
drop function if exists public.activities_sync_participants();

-- `visits_mark_decided` (0157) names the column in its UPDATE OF list, which is a hard
-- dependency on it. That trigger is what makes a person's edit permanent — "a machine
-- may only propose" — so it is recreated watching the columns that remain, NOT dropped.
-- Attribution is no longer one of them: it lives in visit_profiles, and
-- set_visit_participants marks the visit decided itself.
-- ---------------------------------------------------------------------------
-- THE DEFAULT THE NULL USED TO CARRY
-- ---------------------------------------------------------------------------
-- `solo_profile IS NULL` meant EVERYONE, and it meant it for free: a visit inserted
-- anywhere got that meaning by leaving the column alone. The sync triggers then turned
-- it into rows.
--
-- With both gone, a visit inserted by any path that does not name its participants
-- would have NOBODY on it — and `is_shared_visit` requires every real member, so that
-- visit would silently disappear from every Both statistic. `ensure_visit`, the
-- photo/activity triggers and the Strava sync all insert visits and activities without
-- naming anyone.
--
-- So the default becomes explicit: a new visit or activity is EVERYONE's until someone
-- says otherwise. Same meaning the null had, now written down. The paths that DO know
-- who was there (create_visit, add_place_to_visit, rebuild_place_visits and friends)
-- replace these rows immediately afterwards.
create or replace function public.default_participants()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_table_name = 'visits' then
    insert into public.visit_profiles (visit_id, profile_id)
    select new.id, p.id from public.profiles p
     where p.role in ('owner','editor') and coalesce(p.display_name,'') !~* '(test|bot)'
    on conflict do nothing;
  else
    insert into public.activity_profiles (activity_id, profile_id)
    select new.id, p.id from public.profiles p
     where p.role in ('owner','editor') and coalesce(p.display_name,'') !~* '(test|bot)'
    on conflict do nothing;
  end if;
  return null;
end $function$;

revoke all on function public.default_participants() from public, anon, authenticated;

drop trigger if exists visits_default_participants on public.visits;
create trigger visits_default_participants
  after insert on public.visits
  for each row execute function public.default_participants();

drop trigger if exists activities_default_participants on public.activities;
create trigger activities_default_participants
  after insert on public.activities
  for each row execute function public.default_participants();

drop trigger if exists visits_mark_decided on public.visits;
create trigger visits_mark_decided
  before update of start_date, end_date, note, is_trip, status on public.visits
  for each row execute function public.visits_mark_decided();

drop view if exists public.accepted_visits;
create view public.accepted_visits as
  select v.id, v.place_id, v.start_date, v.end_date, v.note, v.created_by, v.created_at,
         v.solo_override, v.manual, v.is_trip, v.status, v.decided_at, v.parent_visit_id,
         v.trip_marked, v.source, v.accepted_at, v.accepted_by, v.updated_at, v.client_key,
         public.counts_as_trip(v.*) as is_trip_qualified,
         v.parent_visit_id is null as is_headline
    from public.visits v
   where v.status = 'taken' and v.accepted_at is not null;

alter view public.accepted_visits set (security_invoker = true);

comment on view public.accepted_visits is
  'Accepted, taken visits — the only rows historical statistics may count (§0.4). '
  'security_invoker = true: it filters through the CALLER''s RLS, not the owner''s.';

revoke all on public.accepted_visits from public, anon;
grant select on public.accepted_visits to authenticated;

alter table public.visits     drop column solo_profile;
alter table public.activities drop column solo_profile;

comment on table public.visit_profiles is
  'Who was on a visit. THE source of attribution since 0188 — visits.solo_profile is '
  'gone, and with it the assumption that a household has exactly two people.';

commit;
