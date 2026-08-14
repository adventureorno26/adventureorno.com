-- 0175 — a person was hardcoded into the database.
--
-- `create_experience` resolved the attribution value 'josh' like this:
--
--     v_josh := (select id from public.profiles where display_name = 'Josh' limit 1);
--
-- A HUMAN BEING, LOOKED UP BY NAME, inside the function that logs every new place and
-- visit. Rename that profile — or let someone type "Joshua" — and attribution silently
-- stops working: `v_josh` becomes null, `solo_profile` is set to null, and the visit
-- quietly says "both" instead. Nothing errors. And a third member could never be named
-- by this path at all, because there was no value that meant them.
--
-- §0.3: "Replace null-as-data attribution with explicit rows... never guess additional
-- participants." A name lookup is the same failure in a different costume.
--
-- The frontend already stopped sending 'josh' — `app/src/lib/participants.ts` builds
-- every choice from the real members and sends a profile id. This removes the value it
-- used to send, and makes an unknown profile an ERROR rather than a silent "both".
--
-- ROLLBACK: the previous definition is in git history (0154 and earlier).

begin;

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
      solo_profile, solo_override, manual, created_by)
    values (
      v_place, v_start, v_end,
      nullif(p_visit->>'note', ''),
      v_solo, v_override, true, v_uid)
    returning id into v_visit;

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

comment on function public.create_experience(text, jsonb, jsonb) is
  'Create-or-reuse a place and optionally log a visit, idempotent on p_key. '
  'Attribution takes ''me'', ''both'' or a PROFILE ID — never a display name, which '
  'used to hardcode one member and fail silently when it did not match (§0.3).';

revoke all on function public.create_experience(text, jsonb, jsonb) from public, anon;
grant execute on function public.create_experience(text, jsonb, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- The same hardcode, a second time — found by the test, not by reading.
-- ---------------------------------------------------------------------------
-- `rebuild_place_visits` DERIVES a visit's attribution, and did it like this:
--
--     when a.n > 0 and a.owners = array[v_josh] then v_josh
--
-- "if every activity in this window was recorded by that one named person". Same
-- lookup, same silent failure, and it decides attribution for every non-manual visit
-- the rebuilder recreates.
--
-- Generalised WITHOUT changing what happens today: every activity in the window
-- recorded by exactly one person who is not the account owner attributes to that
-- person. With the two current members that is precisely the old rule — Josh is the
-- only non-owner — so no existing attribution moves. With three members it names the
-- right one instead of nobody.
--
-- `v_erica` stays: it resolves by ROLE ('owner'), not by name, which is a description
-- of a position rather than of a human.

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
    (select v.solo_profile from public.visits v
       where v.place_id = p_place and not v.manual and v.solo_override
         and v.start_date <= i.e and v.end_date >= i.s
       order by v.start_date limit 1) as ovr_profile,
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
         solo_profile = case when m.ovr then m.ovr_profile else m.inferred end,
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

  insert into public.visits (place_id, start_date, end_date, note, solo_profile, solo_override)
    select p_place, m.s, m.e, m.note,
           case when m.ovr then m.ovr_profile else m.inferred end, m.ovr
    from _match m where m.reuse_id is null;

  drop table if exists _isl_raw;
  drop table if exists _isl;
  drop table if exists _isln;
  drop table if exists _match;

  perform set_config('aon.rebuilding', 'off', true);
end $function$;

commit;
