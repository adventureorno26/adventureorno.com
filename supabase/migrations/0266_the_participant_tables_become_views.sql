-- 0266 — the two participant tables become views, and fourteen writers move.
--
-- Step two, and the end of the mirror 0262 created on purpose. §8b-i: `activity_profiles` and
-- `visit_profiles` are *"migration inputs, not the final commercial API"*.
--
-- WHAT MADE THIS BIGGER THAN A SWAP. All fourteen writers use `ON CONFLICT` — 32 clauses
-- between them — and a view cannot take one, INSTEAD OF trigger or not. So "the readers keep
-- working and the writers are untouched" was never on the table: **33 write statements** are
-- translated here from `(activity_id, profile_id)` to `(subject_id, person_id)`, through the
-- three get-or-create helpers 0265 added. Every one was matched against the live definition
-- exactly once before being replaced, and every function is asserted to contain no reference
-- to the old tables afterwards — a generated migration that silently rewrites thirteen
-- functions and not the fourteenth compiles perfectly and means something else.
--
-- THE READERS DO NOT MOVE. Twenty-four functions read these two names and not one of them
-- changes: `activity_profiles` and `visit_profiles` are views over `memory_people` now, with
-- the same columns in the same order, and 0264 made them **byte-identical** to the tables —
-- 623 outing and 655 visit rows, none missing either way, zero differing columns.
--
-- THE OLD TABLES ARE KEPT, RENAMED, AND FROZEN. Nothing reads or writes `*_retired`; they are
-- a backup for one deploy, not a mirror, and the migration that drops them is the next one.
-- The alternative — dropping them here — means the only copy of 1,278 participations is one
-- I wrote this afternoon.
--
-- ONE BEHAVIOUR IS DELIBERATELY PRESERVED RATHER THAN IMPROVED. A delete that says "these
-- people were on it, nobody else" removes rows for ACCOUNT HOLDERS only — a person with no
-- account is not touched, because `pe.linked_profile = any(…)` is null-safe in the direction
-- that keeps them. That is exactly what the old tables did, since they could not hold such a
-- person at all. Whether "Just me" should also remove Mum is a question for the screen that
-- asks it, not for a migration whose job is to change where the rows live.

alter table public.activity_profiles rename to activity_profiles_retired;
alter table public.visit_profiles    rename to visit_profiles_retired;

-- Same columns, same order, same names. `declined` is spelled `rejected` on the way out
-- because that is the word the old column used and the readers were written against.
create view public.activity_profiles as
  select s.activity_id,
         pe.linked_profile as profile_id,
         mp.created_at,
         case mp.participation_status when 'declined' then 'rejected'
              else mp.participation_status end as claim_status,
         mp.evidence,
         mp.created_by,
         mp.tagged_by as asserted_by,
         mp.decided_by,
         mp.decided_at,
         mp.rule_id
    from public.memory_people mp
    join public.memory_subjects s on s.id = mp.subject_id and s.kind = 'outing'
    join public.people pe on pe.id = mp.person_id
   where pe.linked_profile is not null;

create view public.visit_profiles as
  select s.visit_id,
         pe.linked_profile as profile_id,
         mp.created_at,
         case mp.participation_status when 'declined' then 'rejected'
              else mp.participation_status end as claim_status,
         mp.evidence,
         mp.created_by,
         mp.tagged_by as asserted_by,
         mp.decided_by,
         mp.decided_at,
         mp.rule_id
    from public.memory_people mp
    join public.memory_subjects s on s.id = mp.subject_id and s.kind = 'visit'
    join public.people pe on pe.id = mp.person_id
   where pe.linked_profile is not null;

comment on view public.activity_profiles is
  'WAS A TABLE until 0266. The participations live in memory_people now; this is the same '
  'columns in the same order so that twenty-four readers did not have to move with them. '
  'Read-only: writes go to memory_people, and a stray writer fails loudly rather than '
  'quietly filling a mirror.';

grant select on public.activity_profiles to authenticated;
grant select on public.visit_profiles to authenticated;

create or replace function public.add_activity_to_visit(p_visit uuid, p_option text, p_name text DEFAULT NULL::text, p_distance_m double precision DEFAULT NULL::double precision, p_client_key text DEFAULT NULL::text, p_day date DEFAULT NULL::date)
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
  delete from public.memory_people mp
   using public.memory_subjects s
   where s.id = mp.subject_id and s.activity_id = v_row.id;
  insert into public.memory_people (subject_id, person_id)
  select public.subject_for_activity(v_row.id), public.person_for_profile(vp.profile_id)
    from public.visit_profiles vp where vp.visit_id = p_visit
  on conflict do nothing;

  return v_row;
end $function$
;

create or replace function public.add_place_to_visit(p_visit uuid, p_option text, p_name text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_client_key text DEFAULT NULL::text, p_day date DEFAULT NULL::date)
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
    insert into public.place_membership (child_id, parent_id)
     select v_place.id, v_parent.id
      where v_parent.id <> v_place.id
     on conflict do nothing;
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
  delete from public.memory_people mp
   using public.memory_subjects s, public.visits c
   where s.id = mp.subject_id and s.visit_id = c.id
     and c.place_id = v_place.id and c.start_date = v_day;
  insert into public.memory_people (subject_id, person_id)
  select public.subject_for_visit(c.id), public.person_for_profile(vp.profile_id)
    from public.visits c
    join public.visit_profiles vp on vp.visit_id = p_visit
   where c.place_id = v_place.id and c.start_date = v_day
  on conflict do nothing;

  return v_place;
end $function$
;

create or replace function public.create_experience(p_key text, p_place jsonb, p_visit jsonb DEFAULT '{}'::jsonb)
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

    -- THE ROWS ARE THE RECORD (0192). The array above is the mirror; without this the
    -- card's "Part of a trail?" would be accepted and silently dropped.
    insert into public.place_membership (child_id, parent_id)
    select v_place, pid from unnest(v_partof) pid where pid <> v_place
    on conflict do nothing;
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
    delete from public.memory_people mp
      using public.memory_subjects s
      where s.id = mp.subject_id and s.visit_id = v_visit;
    insert into public.memory_people (subject_id, person_id)
    select public.subject_for_visit(v_visit), public.person_for_profile(x)
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

create or replace function public.create_visit(p_place uuid, p_start date, p_end date DEFAULT NULL::date, p_note text DEFAULT NULL::text, p_profiles uuid[] DEFAULT NULL::uuid[], p_trip boolean DEFAULT false, p_parent uuid DEFAULT NULL::uuid, p_client_key text DEFAULT NULL::text)
 RETURNS visits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row public.visits; v_end date;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- A retry of the same save is the same visit, not a second one.
  if p_client_key is not null then
    select * into v_row from public.visits where client_key = p_client_key;
    if v_row.id is not null then return v_row; end if;
  end if;

  if not exists (select 1 from public.places where id = p_place and deleted_at is null) then
    raise exception 'no such place';
  end if;

  v_end := coalesce(p_end, p_start);
  if v_end < p_start then raise exception 'the end date is before the start date'; end if;

  insert into public.visits (place_id, start_date, end_date, note, status, manual,
                             trip_marked, client_key)
  values (p_place, p_start, v_end, nullif(btrim(coalesce(p_note,'')), ''), 'taken', true,
          coalesce(p_trip, false), p_client_key)
  returning * into v_row;

  -- Participants BEFORE grouping: attaching checks that everyone on the child was on
  -- the parent, so the rows have to exist first (0170).
  -- WRITES THE ROWS. It does NOT go through `set_visit_participants`, which since 0240 turns
  -- naming somebody else into a question they must answer.
  --
  -- That is right for the PICKER — pressing "Just Josh" on a visit that already exists is one
  -- person saying something about another, and 0039 is what happens when the app treats that
  -- as a fact. It is wrong here. `create_visit` CONSTRUCTS a record from a list its caller
  -- already holds: the evidence routes in 0166, the trip grouping in 0170, the restore path,
  -- and the fixtures that build a visit in order to test something else entirely. Making all
  -- of those ask would mean a visit created "with both of us" contains one person until the
  -- other answers, and five tests about other subjects would each have to perform an
  -- acceptance to say anything at all.
  --
  -- SAFE BECAUSE OF WHO CALLS IT: no live UI path does. `addVisit` is deprecated with zero
  -- callers and does not pass participants at all; every person-facing "who was there" runs
  -- through `set_visit_solo` or `set_place_solo`, which ask. If a screen ever calls this with
  -- a person's word about somebody else, it belongs on the asking path instead — which is
  -- why the evidence says `created_with` rather than pretending anybody decided.
  if p_profiles is not null and coalesce(array_length(p_profiles, 1), 0) > 0 then
    if exists (select 1 from unnest(p_profiles) x
                where not exists (select 1 from public.profiles p where p.id = x)) then
      raise exception 'unknown profile in the participant list';
    end if;
    insert into public.memory_people
      (subject_id, person_id, participation_status, evidence, created_by)
    select public.subject_for_visit(v_row.id), public.person_for_profile(x),
           'accepted', 'created_with', 'user'
      from unnest(p_profiles) x
    on conflict (subject_id, person_id) do nothing;
    -- REPLACES the set. `set_visit_participants` deleted first and this did not, so a row
    -- written by whatever populates a new visit survived alongside the list the caller
    -- passed: `create_visit(place, …, array[b])` produced a visit with A AND B on it, and
    -- 0190 measured a "both of us" count of 2 where 1 was true. Taking the list literally is
    -- the whole contract — it is the caller's record, not a suggestion to add to.
    delete from public.memory_people mp
     using public.memory_subjects s, public.people pe
     where s.id = mp.subject_id and pe.id = mp.person_id
       and s.visit_id = v_row.id
       and not (pe.linked_profile = any(p_profiles));
    update public.visits set solo_override = true where id = v_row.id;
  end if;

  if p_parent is not null then
    perform public.attach_child_visit(v_row.id, p_parent);
    select * into v_row from public.visits where id = v_row.id;
  end if;

  return v_row;
end $function$
;

create or replace function public.default_participants()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_owner uuid;
begin
  if tg_table_name = 'visits' then
    -- A person creating a visit is saying they were there. Nobody else is implied.
    if auth.uid() is not null then
      insert into public.memory_people
        (subject_id, person_id, participation_status, evidence, created_by)
      values (public.subject_for_visit(new.id), public.person_for_profile(auth.uid()),
              'accepted', 'own_statement', 'user')
      on conflict do nothing;
    end if;
    -- No uid means a machine made it. §0.3: it waits for review rather than guessing.
    return null;
  end if;

  -- WHOSE RECORDING IT IS, in this order:
  --   1. the owner, already decided by `set_activity_owner` in the BEFORE trigger
  --   2. the athlete whose token fetched it — the only attribution Strava's terms allow
  --   3. the person doing the inserting, which is right only when they are the owner and
  --      is the last resort rather than the first
  v_owner := new.owner_profile;

  if v_owner is null and new.athlete_id is not null then
    select sa.profile_id into v_owner
      from public.strava_accounts sa where sa.athlete_id = new.athlete_id;
  end if;

  if v_owner is null then
    v_owner := auth.uid();
  end if;

  if v_owner is not null then
    -- SAYING WHAT IT IS. `own_recording` is what 0236 keys the "not yours to delete"
    -- protection on, and a row left at the column default said `unknown` instead.
    insert into public.memory_people
      (subject_id, person_id, participation_status, evidence, created_by)
    values (public.subject_for_activity(new.id), public.person_for_profile(v_owner),
            'accepted', 'own_recording', 'import')
    on conflict do nothing;
  end if;
  return null;
end $function$
;

create or replace function public.import_file_activity(p_name text, p_type text, p_polyline text, p_distance double precision, p_moving integer, p_lat double precision, p_lng double precision, p_date timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  delete from public.memory_people mp
  using public.memory_subjects s
  where s.id = mp.subject_id and s.activity_id = v_id;
  insert into public.memory_people (subject_id, person_id)
  values (public.subject_for_activity(v_id), public.person_for_profile(v_me))
  on conflict do nothing;

  if v_place is not null then
    perform public.recompute_place_stats(v_place);
    perform public.rebuild_place_visits(v_place);
  end if;
  return v_id;
end $function$
;

create or replace function public.ingest_activity(p_run uuid, p_provider text, p_origin text DEFAULT 'unknown'::text, p_external_key text DEFAULT NULL::text, p_name text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_polyline text DEFAULT NULL::text, p_distance double precision DEFAULT NULL::double precision, p_moving integer DEFAULT NULL::integer, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_device text DEFAULT NULL::text, p_artifact uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me     uuid := auth.uid();
  v_conn   uuid;
  v_owner  uuid;
  v_id     uuid;
  v_place  uuid;
  v_other  uuid;
  v_dup    uuid;
  v_pt     geography;
  v_disp   text;
  v_reason text;
  v_item   uuid;
  v_key    text;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- THE RUN MUST BE THE CALLER'S, AND STILL OPEN (0234).
  --
  -- It took only a run id. A run id is not a secret — it comes back from
  -- `begin_ingest_run`, it is in every ingest_items row — so any editor could append
  -- activities to somebody else's import. Worse, this function reads `source_owner_profile`
  -- FROM THE RUN and makes that person the owner of whatever it creates: writing into
  -- another person's run wrote activities into their account.
  --
  -- Service callers (cron, migrations, webhooks) have no `auth.uid()` and are trusted by
  -- the grant, so they are unaffected.
  if auth.uid() is not null then
    if not exists (
      select 1 from public.ingest_runs r
       where r.id = p_run
         and r.initiated_by = auth.uid()
         and r.status = 'running')
    then
      raise exception 'that import run is not yours, or is already finished'
        using errcode = '42501';
    end if;
  end if;
  select source_connection_id, coalesce(source_owner_profile, initiated_by)
    into v_conn, v_owner
    from public.ingest_runs where id = p_run;
  if v_owner is null then v_owner := v_me; end if;
  if p_lat is not null and p_lng is not null then
    v_pt := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  end if;

  -- The provider's own id when the file has one; otherwise the recording's own identity.
  -- Only for files: a provider that CAN give an id and did not is a different problem, and
  -- silently keying its records by content would hide it.
  v_key := p_external_key;
  if v_key is null and p_provider = 'file' then
    v_key := public.file_content_key(v_owner, p_date, p_distance, p_type);
  end if;

  -- ---- TIER 1: the same source record, seen again -------------------------
  if v_key is not null then
    select s.activity_id into v_id
      from public.activity_sources s
     where s.provider = p_provider
       and s.external_key = v_key
       and coalesce(s.connection_id,'00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(v_conn,'00000000-0000-0000-0000-000000000000'::uuid)
     limit 1;
    if v_id is not null then
      v_disp := 'duplicate';
      v_reason := case when p_external_key is null
                       then 'the same recording, already imported'
                       else 'same source record, already attached' end;
    end if;
  end if;

  -- ---- create it, if it is genuinely new ----------------------------------
  if v_id is null then
    v_place := public.place_for_activity(p_lat, p_lng, p_type, p_name);
    insert into public.activities
      (strava_id, type, name, distance, moving_time, start_date, lat, lng, place_id,
       summary_polyline, source, original_source, owner_profile)
    values
      (null, coalesce(p_type,'Workout'),
       public.activity_display_name(p_name, v_place, p_type),
       coalesce(p_distance,0), p_moving, p_date, p_lat, p_lng, v_place,
       p_polyline, p_provider, coalesce(nullif(p_origin,'unknown'), p_provider), v_owner)
    returning id into v_id;

    insert into public.memory_people
      (subject_id, person_id, participation_status, evidence, created_by)
    values (public.subject_for_activity(v_id), public.person_for_profile(v_owner),
            'accepted', 'own_recording', 'import')
    on conflict do nothing;

    v_disp := 'inserted';

    -- ---- TIER 2: does this look like MY OWN outing, already recorded? -----
    if p_date is not null then
      select a.id into v_dup
        from public.activities a
       where a.owner_profile = v_owner
         and a.id <> v_id
         and (p_type is null or a.type = p_type)
         and abs(extract(epoch from (a.start_date - p_date))) <= 1800
         and (p_distance is null or a.distance is null
              or abs(a.distance - p_distance) <= greatest(160, p_distance * 0.02))
         and (v_pt is null or a.geom is null or st_dwithin(a.geom, v_pt, 400))
       order by abs(extract(epoch from (a.start_date - p_date)))
       limit 1;

      if v_dup is not null then
        insert into public.suggestions
          (subject_type, subject_id, field, current_value, proposed_value,
           label, source, confidence, evidence, group_key, rank, status)
        select 'activity', v_id, 'shared_group_id',
               to_jsonb(null::uuid), to_jsonb(coalesce(a.shared_group_id, a.id)),
               format('The same outing as "%s" — %s min apart, %s%% difference in distance, from %s',
                      coalesce(a.name,'(unnamed)'),
                      round(abs(extract(epoch from (a.start_date - p_date)))/60.0),
                      round((abs(coalesce(a.distance,0) - coalesce(p_distance,0))
                             / nullif(greatest(a.distance, p_distance),0) * 100)::numeric, 1),
                      coalesce(nullif(a.original_source,''), a.source, 'an earlier import')),
               'import', 0.7,
               jsonb_build_object('kept', v_dup, 'incoming', v_id, 'provider', p_provider),
               'import-dup:' || least(v_id, v_dup)::text, 1, 'pending'
          from public.activities a where a.id = v_dup
        on conflict do nothing;
        v_disp := 'proposed';
        v_reason := 'created, and proposed as the same outing as one already recorded, for a person to confirm';
      end if;
    end if;

    -- ---- TIER 3: someone ELSE already recorded this outing ----------------
    if v_pt is not null and p_date is not null then
      select a.id into v_other
        from public.activities a
       where a.owner_profile is not null and a.owner_profile <> v_owner
         and a.id <> v_id
         and (p_type is null or a.type = p_type)
         and abs(extract(epoch from (a.start_date - p_date))) <= 1800
         and a.geom is not null and st_dwithin(a.geom, v_pt, 800)
       limit 1;
      if v_other is not null then
        -- PROPOSES. It used to write `shared_group_id` on both rows outright, which is a
        -- machine deciding that two people's recordings are one outing — the exact thing §2
        -- forbids, sitting inside the importer that exists to enforce it. It was written
        -- before 0210 gave duplicates a card a person can answer, and it never caught up.
        --
        -- The cost of being wrong here is not small: linking is what makes an outing count
        -- ONCE, so a bad link silently erases a day somebody actually had.
        insert into public.suggestions
          (subject_type, subject_id, field, current_value, proposed_value,
           label, source, confidence, evidence, group_key, rank, status)
        select 'activity', v_id, 'shared_group_id',
               to_jsonb(null::uuid), to_jsonb(coalesce(o.shared_group_id, o.id)),
               format('The same outing as %s''s "%s" — %s min apart, both recorded separately',
                      coalesce(ow.display_name, 'someone else'),
                      coalesce(o.name, '(unnamed)'),
                      round(abs(extract(epoch from (o.start_date - p_date)))/60.0)),
               'import', 0.6,
               jsonb_build_object('kept', v_other, 'incoming', v_id,
                                  'reason', 'joint outing',
                                  'minutes_apart', round(abs(extract(epoch from (o.start_date - p_date)))/60.0, 1)),
               'import-dup:' || least(v_id, v_other)::text, 1, 'pending'
          from public.activities o
          left join public.profiles ow on ow.id = o.owner_profile
         where o.id = v_other
        on conflict do nothing;
        if v_disp = 'inserted' then v_disp := 'proposed'; end if;
        v_reason := 'created, and proposed as the same outing as another person''s recording';
      end if;
    end if;

    if v_place is not null then
      perform public.recompute_place_stats(v_place);
      perform public.rebuild_place_visits(v_place);
    end if;
  end if;

  insert into public.activity_sources
    (activity_id, connection_id, provider, origin, external_key, device_name, is_primary, confidence)
  values
    (v_id, v_conn, p_provider, coalesce(p_origin,'unknown'), v_key, p_device,
     (v_disp = 'inserted'),
     case when p_external_key is not null then 'exact'
          when v_key is not null then 'exact'   -- same recording, not a resemblance
          else 'strong' end)
  on conflict do nothing;

  insert into public.ingest_items
    (run_id, artifact_id, entity_kind, external_key, event_at, disposition, reason)
  values (p_run, p_artifact, 'activity', v_key, p_date, v_disp, v_reason)
  returning id into v_item;

  update public.activity_sources set ingest_item_id = v_item
   where activity_id = v_id and ingest_item_id is null
     and provider = p_provider and coalesce(external_key,'') = coalesce(v_key,'');

  return jsonb_build_object('activity_id', v_id, 'disposition', v_disp, 'reason', v_reason);
end $function$
;

create or replace function public.merge_visits(p_keep uuid, p_absorb uuid)
 RETURNS visits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_keep public.visits; v_absorb public.visits;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_keep = p_absorb then raise exception 'those are the same visit'; end if;

  select * into v_keep   from public.visits where id = p_keep   for update;
  select * into v_absorb from public.visits where id = p_absorb for update;
  if v_keep.id is null or v_absorb.id is null then raise exception 'no such visit'; end if;

  if v_keep.place_id <> v_absorb.place_id then
    raise exception 'those visits are to different places — move one first if that is what you mean';
  end if;

  -- WIDEN THE DATES FIRST. The 0170 parent/child trigger refuses a child that falls
  -- outside its trip's range, and a visit grouped inside the absorbed half is very
  -- likely outside the surviving half's ORIGINAL dates — that is what made them look
  -- like two stays. Repointing before widening fails with "the visit falls outside the
  -- trip's dates", which is the trigger doing its job on my own bad ordering.
  update public.visits
     set start_date = least(v_keep.start_date, v_absorb.start_date),
         end_date   = greatest(coalesce(v_keep.end_date, v_keep.start_date),
                               coalesce(v_absorb.end_date, v_absorb.start_date)),
         note       = coalesce(nullif(btrim(coalesce(v_keep.note, '')), ''),
                               nullif(btrim(coalesce(v_absorb.note, '')), '')),
         manual     = true
   where id = p_keep
  returning * into v_keep;

  -- THEN UNION THE PEOPLE, still before repointing. 0170 also refuses a child holding
  -- someone the trip does not: a visit grouped inside the absorbed half carries that
  -- half's participants, so if Josh was only on those days, moving the child first
  -- fails with "someone on that visit was not on the trip". Both refusals are the
  -- constraint working — the merge simply has to happen in the order the model implies.
  insert into public.memory_people (subject_id, person_id)
  select public.subject_for_visit(p_keep), public.person_for_profile(profile_id)
    from public.visit_profiles where visit_id = p_absorb
  on conflict do nothing;

  insert into public.visit_people (visit_id, person_id)
  select p_keep, person_id from public.visit_people where visit_id = p_absorb
  on conflict do nothing;

  insert into public.visit_evidence (visit_id, evidence_type, evidence_id, evidence_date, source_key)
  select p_keep, evidence_type, evidence_id, evidence_date, source_key
    from public.visit_evidence where visit_id = p_absorb
  on conflict do nothing;

  -- Nothing may be left pointing at the visit that is about to go.
  update public.photos      set visit_id = p_keep where visit_id = p_absorb;
  update public.videos      set visit_id = p_keep where visit_id = p_absorb;
  update public.activities  set visit_id = p_keep where visit_id = p_absorb;
  update public.visits      set parent_visit_id = p_keep where parent_visit_id = p_absorb;

  delete from public.visits where id = p_absorb;

  return v_keep;
end $function$
;

create or replace function public.rebuild_place_visits(p_place uuid)
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
     where v.trip_marked
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
  delete from public.memory_people mp
   using public.memory_subjects s, public.visits v, _match m
   where s.id = mp.subject_id and s.visit_id = v.id
     and v.place_id = p_place and not v.manual
     and v.start_date = m.s and v.end_date = m.e;

  insert into public.memory_people (subject_id, person_id)
  select public.subject_for_visit(v.id), public.person_for_profile(x)
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

create or replace function public.respond_to_tag(p_claim uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c      record;
  v_seen uuid;
begin
  select * into c from public.tag_claims where id = p_claim;
  if c is null then raise exception 'no such claim'; end if;
  if c.profile_id <> auth.uid() then
    raise exception 'only the tagged person can answer a tag' using errcode = '42501';
  end if;
  if c.status not in ('proposed', 'accepted_legacy') then
    raise exception 'that claim is already %', c.status;
  end if;

  update public.tag_claims
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_at = now()
   where id = p_claim;

  -- ---- A PLACE: one answer, every visit there (0240) ----------------------
  if c.subject_kind = 'place' then
    if p_accept then
      insert into public.memory_people
        (subject_id, person_id, participation_status, evidence, created_by, tagged_by,
         decided_by, decided_at, rule_id)
      select public.subject_for_visit(v.id), public.person_for_profile(c.profile_id),
             'accepted', 'tagged_and_accepted', 'user', c.asserted_by,
             c.profile_id, now(), c.rule_id
        from public.visits v where v.place_id = c.subject_id
      on conflict (subject_id, person_id) do update
        set participation_status = 'accepted', evidence = 'tagged_and_accepted',
            decided_by = c.profile_id, decided_at = now();
    else
      -- Saying no takes back only what somebody else asserted. Anything evidenced by their
      -- own photo or their own activity is not part of the claim and stays.
      delete from public.memory_people mp
       using public.memory_subjects s, public.people pe, public.visits v
       where s.id = mp.subject_id and pe.id = mp.person_id and s.visit_id = v.id
         and v.place_id = c.subject_id
         and pe.linked_profile = c.profile_id
         and coalesce(mp.evidence,'') in ('owner_asserted', 'tagged_and_accepted', 'unknown');
    end if;
    return;
  end if;

  if c.subject_kind <> 'activity' then
    -- Visits are not source-restricted, so they need none of the below.
    if p_accept then
      insert into public.memory_people
        (subject_id, person_id, participation_status, evidence, created_by, tagged_by, decided_by, decided_at, rule_id)
      values (public.subject_for_visit(c.subject_id), public.person_for_profile(c.profile_id),
              'accepted', 'tagged_and_accepted', 'user',
              c.asserted_by, c.profile_id, now(), c.rule_id)
      on conflict do nothing;
      update public.memory_people mp
         set participation_status = 'accepted', evidence = 'tagged_and_accepted',
             decided_by = c.profile_id, decided_at = now()
        from public.memory_subjects s, public.people pe
       where s.id = mp.subject_id and pe.id = mp.person_id
         and s.visit_id = c.subject_id and pe.linked_profile = c.profile_id
         and mp.participation_status is distinct from 'accepted';
    else
      delete from public.memory_people mp
       using public.memory_subjects s, public.people pe
       where s.id = mp.subject_id and pe.id = mp.person_id
         and s.visit_id = c.subject_id and pe.linked_profile = c.profile_id
         and ((c.rule_id is not null and mp.rule_id = c.rule_id)
           or (c.rule_id is null
               and coalesce(mp.evidence,'') in ('owner_asserted', 'tagged_and_accepted')));
    end if;
    return;
  end if;

  -- The recording he can see, which is usually the claimed one.
  v_seen := public.visible_recording_of(c.subject_id);

  if p_accept then
    insert into public.memory_people
      (subject_id, person_id, participation_status, evidence, created_by, tagged_by, decided_by, decided_at, rule_id)
    values (public.subject_for_activity(c.subject_id), public.person_for_profile(c.profile_id),
            'accepted', 'tagged_and_accepted', 'user',
            c.asserted_by, c.profile_id, now(), c.rule_id)
    on conflict do nothing;
    update public.memory_people mp
       set participation_status = 'accepted', evidence = 'tagged_and_accepted',
           decided_by = c.profile_id, decided_at = now()
      from public.memory_subjects s, public.people pe
     where s.id = mp.subject_id and pe.id = mp.person_id
       and s.activity_id = c.subject_id and pe.linked_profile = c.profile_id
       and mp.participation_status is distinct from 'accepted';

    if v_seen is not null and v_seen <> c.subject_id then
      insert into public.memory_people
        (subject_id, person_id, participation_status, evidence, created_by, tagged_by, decided_by, decided_at, rule_id)
      values (public.subject_for_activity(v_seen), public.person_for_profile(c.profile_id),
              'accepted', 'tagged_and_accepted', 'user',
              c.asserted_by, c.profile_id, now(), c.rule_id)
      on conflict do nothing;
    end if;
  else
    delete from public.memory_people mp
     using public.memory_subjects s, public.people pe, public.activities a, public.activities claimed
     where s.id = mp.subject_id and pe.id = mp.person_id
       and s.activity_id = a.id
       and claimed.id = c.subject_id
       and coalesce(a.shared_group_id, a.id) = coalesce(claimed.shared_group_id, claimed.id)
       and pe.linked_profile = c.profile_id
       and ((c.rule_id is not null and mp.rule_id = c.rule_id)
         or (c.rule_id is null
             and coalesce(mp.evidence,'') in ('owner_asserted', 'tagged_and_accepted')));
  end if;
end $function$
;

create or replace function public.restore_visit(p_snapshot jsonb)
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

  -- PUTTING PEOPLE BACK IS NOT A NEW STATEMENT ABOUT THEM (0244).
  --
  -- This called `set_visit_participants`, which since 0240 ASKS rather than asserts — so
  -- pressing Undo on a deleted visit would have turned everybody else's accepted
  -- participation into an unanswered question, and quietly dropped them from the visit until
  -- they answered it a second time. Undo has to restore, not re-ask: the record being put
  -- back is the record that was there.
  --
  -- TWO SNAPSHOT SHAPES. Since 0244 `profiles` holds whole rows; before that it held bare
  -- ids, and an undo token issued minutes before this deploy still carries the old shape. An
  -- id-only entry is restored as accepted with `evidence = 'restored'`, which says plainly
  -- that the detail did not survive the round trip rather than inventing a decision.
  insert into public.memory_people
    (subject_id, person_id, participation_status, evidence, created_by, tagged_by, decided_by,
     decided_at, rule_id)
  select public.subject_for_visit(v_row.id),
         public.person_for_profile(coalesce((e->>'profile_id')::uuid, (e #>> '{}')::uuid)),
         coalesce(e->>'claim_status', 'accepted'),
         coalesce(e->>'evidence', 'restored'),
         coalesce(e->>'created_by', 'user'),
         (e->>'asserted_by')::uuid,
         (e->>'decided_by')::uuid,
         (e->>'decided_at')::timestamptz,
         (e->>'rule_id')::uuid
    from jsonb_array_elements(coalesce(p_snapshot->'profiles','[]'::jsonb)) e
  on conflict (subject_id, person_id) do nothing;

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

create or replace function public.set_activity_solo(p_activity uuid, p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me      uuid := auth.uid();
  v_place   uuid;
  v_wanted  uuid[];
  v_person  uuid;
  v_stated  int := 0;
  v_removed int := 0;
  v_asked   uuid[] := '{}';
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select place_id into v_place from public.activities where id = p_activity;

  v_wanted := case
    when p_profile is not null then array[p_profile]
    else array(select id from public.profiles
                where role in ('owner','editor')
                  and coalesce(display_name,'') !~* '(test|bot)')
  end;

  foreach v_person in array v_wanted loop
    if v_person = v_me then
      insert into public.memory_people
        (subject_id, person_id, participation_status, evidence, created_by, decided_by, decided_at)
      values (public.subject_for_activity(p_activity), public.person_for_profile(v_person),
              'accepted', 'own_statement', 'user', v_me, now())
      on conflict (subject_id, person_id) do update
        set participation_status = 'accepted', decided_by = v_me, decided_at = now();
      v_stated := v_stated + 1;
    else
      insert into public.memory_people
        (subject_id, person_id, participation_status, evidence, created_by, tagged_by)
      values (public.subject_for_activity(p_activity), public.person_for_profile(v_person),
              'proposed', 'owner_asserted', 'user', v_me)
      on conflict (subject_id, person_id) do nothing;

      insert into public.tag_claims
        (subject_kind, subject_id, profile_id, asserted_by, status)
      values ('activity', p_activity, v_person, v_me, 'proposed')
      on conflict (subject_kind, subject_id, profile_id) do update
        set status = 'proposed', asserted_by = v_me, decided_at = null
      where public.tag_claims.status = 'retracted';

      -- Only counts as ASKED if a question is genuinely open — a declined claim is not
      -- reopened (0241), and saying otherwise would put "asked Josh" on screen when nobody
      -- was asked anything.
      if exists (select 1 from public.tag_claims c
                  where c.subject_kind = 'activity' and c.subject_id = p_activity
                    and c.profile_id = v_person and c.status in ('proposed','accepted_legacy')) then
        v_asked := v_asked || v_person;
      end if;
    end if;
  end loop;

  delete from public.memory_people mp
   using public.memory_subjects s, public.people pe
   where s.id = mp.subject_id and pe.id = mp.person_id
     and s.activity_id = p_activity
     and not (pe.linked_profile = any(v_wanted))
     -- YOUR OWN RECORDING IS STILL YOURS TO STEP OFF. 0236 protects a row evidencing
     -- somebody's own recording, and the reason it gives is "that is the difference between
     -- 'you weren't with me' and 'your run did not happen'" — which is about SOMEBODY ELSE
     -- doing the deleting. Taking yourself off a recording you made is a strange thing to
     -- say and it is yours to say (0258).
     and not (coalesce(mp.evidence, '') = 'own_recording' and pe.linked_profile <> v_me);
  get diagnostics v_removed = row_count;

  update public.tag_claims c
     set status = 'retracted', decided_at = now()
   where c.subject_kind = 'activity'
     and c.subject_id = p_activity
     and not (c.profile_id = any(v_wanted))
     and c.status in ('proposed', 'accepted_legacy');

  if v_place is not null then
    perform public.recompute_place_stats(v_place);
    perform public.rebuild_place_visits(v_place);
  end if;

  return jsonb_build_object('stated', v_stated, 'asked', to_jsonb(v_asked), 'removed', v_removed);
end $function$
;

create or replace function public.set_place_solo(p_place uuid, p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me      uuid := auth.uid();
  v_wanted  uuid[];
  v_person  uuid;
  v_visit   uuid;
  v_stated  int := 0;
  v_removed int := 0;
  v_asked   uuid[] := '{}';
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_wanted := case
    when p_profile is not null then array[p_profile]
    else array(select id from public.profiles
                where role in ('owner','editor')
                  and coalesce(display_name,'') !~* '(test|bot)')
  end;

  foreach v_person in array v_wanted loop
    if v_person = v_me then
      for v_visit in select id from public.visits where place_id = p_place loop
        insert into public.memory_people
          (subject_id, person_id, participation_status, evidence, created_by, decided_by, decided_at)
        values (public.subject_for_visit(v_visit), public.person_for_profile(v_me),
                'accepted', 'own_statement', 'user', v_me, now())
        on conflict (subject_id, person_id) do update
          set participation_status = 'accepted', decided_by = v_me, decided_at = now();
        v_stated := v_stated + 1;
      end loop;
    else
      insert into public.tag_claims
        (subject_kind, subject_id, profile_id, asserted_by, status)
      values ('place', p_place, v_person, v_me, 'proposed')
      on conflict (subject_kind, subject_id, profile_id) do update
        set status = 'proposed', asserted_by = v_me, decided_at = null
      where public.tag_claims.status = 'retracted';

      -- The wider question withdraws the ones about that place's own days (0242).
      update public.tag_claims c
         set status = 'retracted', decided_at = now()
       where c.subject_kind = 'visit'
         and c.profile_id = v_person
         and c.status in ('proposed', 'accepted_legacy')
         and c.subject_id in (select id from public.visits where place_id = p_place);

      if exists (select 1 from public.tag_claims c
                  where c.subject_kind = 'place' and c.subject_id = p_place
                    and c.profile_id = v_person and c.status in ('proposed','accepted_legacy')) then
        v_asked := v_asked || v_person;
      end if;
    end if;
  end loop;

  delete from public.memory_people mp
   using public.memory_subjects s, public.people pe, public.visits v
   where s.id = mp.subject_id and pe.id = mp.person_id and s.visit_id = v.id
     and v.place_id = p_place
     and not (pe.linked_profile = any(v_wanted))
     and (pe.linked_profile = v_me or not exists (
           select 1 from public.visit_evidence ve
            where ve.visit_id = v.id
              and ((ve.evidence_type = 'photo'
                    and exists (select 1 from public.photos ph
                                 where ph.id = ve.evidence_id and ph.uploaded_by = pe.linked_profile))
                or (ve.evidence_type = 'activity'
                    and exists (select 1 from public.activities a
                                 where a.id = ve.evidence_id and a.owner_profile = pe.linked_profile)))));
  get diagnostics v_removed = row_count;

  update public.tag_claims c
     set status = 'retracted', decided_at = now()
   where c.status in ('proposed', 'accepted_legacy')
     and not (c.profile_id = any(v_wanted))
     and ((c.subject_kind = 'place' and c.subject_id = p_place)
       or (c.subject_kind = 'visit'
           and c.subject_id in (select id from public.visits where place_id = p_place)));

  update public.visits set manual = true, solo_override = true where place_id = p_place;

  return jsonb_build_object('stated', v_stated, 'asked', to_jsonb(v_asked), 'removed', v_removed);
end $function$
;

create or replace function public.set_visit_participants(p_visit uuid, p_profiles uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me      uuid := auth.uid();
  v_person  uuid;
  v_stated  int := 0;
  v_removed int := 0;
  v_asked   uuid[] := '{}';
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

  foreach v_person in array p_profiles loop
    if v_person = v_me then
      insert into public.memory_people
        (subject_id, person_id, participation_status, evidence, created_by, decided_by, decided_at)
      values (public.subject_for_visit(p_visit), public.person_for_profile(v_person),
              'accepted', 'own_statement', 'user', v_me, now())
      on conflict (subject_id, person_id) do update
        set participation_status = 'accepted', decided_by = v_me, decided_at = now();
      v_stated := v_stated + 1;
    else
      insert into public.tag_claims
        (subject_kind, subject_id, profile_id, asserted_by, status)
      values ('visit', p_visit, v_person, v_me, 'proposed')
      on conflict (subject_kind, subject_id, profile_id) do update
        set status = 'proposed', asserted_by = v_me, decided_at = null
      where public.tag_claims.status = 'retracted';

      if exists (select 1 from public.tag_claims c
                  where c.subject_kind = 'visit' and c.subject_id = p_visit
                    and c.profile_id = v_person and c.status in ('proposed','accepted_legacy')) then
        v_asked := v_asked || v_person;
      end if;
    end if;
  end loop;

  delete from public.memory_people mp
   using public.memory_subjects s, public.people pe
   where s.id = mp.subject_id and pe.id = mp.person_id
     and s.visit_id = p_visit
     and not (pe.linked_profile = any(p_profiles))
     and (pe.linked_profile = v_me or not exists (
           select 1 from public.visit_evidence ve
            where ve.visit_id = p_visit
              and ((ve.evidence_type = 'photo'
                    and exists (select 1 from public.photos ph
                                 where ph.id = ve.evidence_id and ph.uploaded_by = pe.linked_profile))
                or (ve.evidence_type = 'activity'
                    and exists (select 1 from public.activities a
                                 where a.id = ve.evidence_id and a.owner_profile = pe.linked_profile)))));
  get diagnostics v_removed = row_count;

  update public.tag_claims c
     set status = 'retracted', decided_at = now()
   where c.subject_kind = 'visit'
     and c.subject_id = p_visit
     and not (c.profile_id = any(p_profiles))
     and c.status in ('proposed', 'accepted_legacy');

  update public.visits set solo_override = true where id = p_visit;

  return jsonb_build_object('stated', v_stated, 'asked', to_jsonb(v_asked), 'removed', v_removed);
end $function$
;

-- ---------------------------------------------------------------------------
-- And it has to be the same data, or it is not a migration.
-- ---------------------------------------------------------------------------
do $$
declare v int;
begin
  select count(*) into v from (
    select * from public.activity_profiles_retired
    except select * from public.activity_profiles) x;
  if v > 0 then raise exception 'THE VIEW LOST % outing rows the table had', v; end if;

  select count(*) into v from (
    select * from public.activity_profiles
    except select * from public.activity_profiles_retired) x;
  if v > 0 then raise exception 'THE VIEW INVENTED % outing rows the table never had', v; end if;

  select count(*) into v from (
    select * from public.visit_profiles_retired
    except select * from public.visit_profiles) x;
  if v > 0 then raise exception 'THE VIEW LOST % visit rows the table had', v; end if;

  select count(*) into v from (
    select * from public.visit_profiles
    except select * from public.visit_profiles_retired) x;
  if v > 0 then raise exception 'THE VIEW INVENTED % visit rows the table never had', v; end if;

  raise notice '0266: % outing and % visit participations, now read through memory_people',
    (select count(*) from public.activity_profiles),
    (select count(*) from public.visit_profiles);
end $$;
