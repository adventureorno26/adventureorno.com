-- Restore the rating write that 0137 removed by accident.
--
-- 0137 cut sections 3 and 4 out of create_experience (the Trip link and the
-- planned->completed stop promotion). The rating block sat BETWEEN section 4 and
-- section 5 with no numbered header of its own, so it went with them — and
-- `create_experience(..., {rating: 5})` silently stopped writing place_ratings.
-- Nothing errored; the rating just vanished. Caught by 0111's section 5.
--
-- The lesson, recorded because it nearly shipped: when editing a live function by
-- slicing between two markers, diff the result against the original instead of
-- trusting the markers.

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
  v_josh     uuid;
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
    -- Attribution: who = 'me' | 'josh' | 'both' | <profile-uuid>. Empty = leave unset.
    v_who  := lower(coalesce(p_visit->>'who', ''));
    v_josh := (select id from public.profiles where display_name = 'Josh' limit 1);
    if v_who = 'both' then
      v_solo := null; v_override := true;
    elsif v_who = 'josh' then
      v_solo := v_josh; v_override := true;
    elsif v_who = 'me' then
      v_solo := v_uid; v_override := true;
    elsif v_who <> '' then
      v_solo := nullif(p_visit->>'who', '')::uuid; v_override := v_solo is not null;
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
