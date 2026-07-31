-- 0111 — Unified transactional + idempotent experience-creation service (Prompt 2B).
--
-- The ADR requires ONE creation service used by AddWizard, NewPlaceDraft, MapView,
-- PlacePanel/addSpot, DayView, and the import flows, so a "log an experience" always
-- writes the same place+visit+attribution+people graph the same way — no half-built
-- records, no per-caller drift.
--
-- Atomicity: a PL/pgSQL function body runs in a single transaction, so the place, the
-- visit, its attribution, the rating, and the people links all commit together or not
-- at all. If any step raises, nothing is written.
--
-- Idempotency: the caller supplies a stable client key (one per user "save" action).
-- A same-key retry — the ADR "retry after partial failure" case — returns the SAME
-- place_id/visit_id instead of creating a duplicate. Concurrent same-key calls are
-- serialized with a per-key advisory lock so the second one observes the first's
-- committed request row and short-circuits.
--
-- ROLLBACK:
--   drop function if exists public.create_experience(text, jsonb, jsonb);
--   drop table if exists public.experience_requests;

create table if not exists public.experience_requests (
  idempotency_key text primary key,
  created_by      uuid references public.profiles(id) on delete set null,
  place_id        uuid,
  visit_id        uuid,
  created_at      timestamptz not null default now()
);
alter table public.experience_requests enable row level security;
drop policy if exists experience_requests_rw on public.experience_requests;
create policy experience_requests_rw on public.experience_requests for all
  using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());
grant select, insert on public.experience_requests to authenticated;

create or replace function public.create_experience(
  p_key   text,
  p_place jsonb,
  p_visit jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  --    otherwise create a new one (name + coordinates are required by the schema).
  v_place := nullif(p_place->>'id', '')::uuid;
  if v_place is not null then
    if not exists (select 1 from public.places where id = v_place) then
      raise exception 'place % not found', v_place;
    end if;
  else
    v_name := btrim(coalesce(p_place->>'name', ''));
    v_lat  := nullif(p_place->>'lat', '')::float8;
    v_lng  := nullif(p_place->>'lng', '')::float8;
    if v_name = '' then
      raise exception 'a new place requires a name';
    end if;
    if v_lat is null or v_lng is null then
      raise exception 'a new place requires coordinates';
    end if;
    insert into public.places (
      name, lat, lng, country, admin1, city, address, categories, saved, created_by)
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
      v_uid)
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

    -- is_trip is a GENERATED column (multi-day span) — never inserted explicitly.
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

    -- Planned → completed: if this place has a planned stop on a trip whose date
    -- window contains the new visit, promote that stop and link it to the visit.
    perform public.promote_trip_stops_for_place(v_place);
  end if;

  -- Rating (per-user place_ratings, mirrored to places.rating for the owner) —
  -- delegated to the canonical RPC so the rating model stays single-sourced.
  -- Applies whether or not a visit was created; auth.uid() is preserved under
  -- SECURITY DEFINER so it's attributed to the actual caller.
  if nullif(p_visit->>'rating', '') is not null then
    perform public.set_my_rating(v_place, (p_visit->>'rating')::smallint);
  end if;

  -- 3) Record the request so a retry is idempotent.
  insert into public.experience_requests (idempotency_key, created_by, place_id, visit_id)
  values (p_key, v_uid, v_place, v_visit);

  return jsonb_build_object('place_id', v_place, 'visit_id', v_visit, 'idempotent', false);
end
$function$;

revoke all on function public.create_experience(text, jsonb, jsonb) from public;
revoke all on function public.create_experience(text, jsonb, jsonb) from anon;
grant execute on function public.create_experience(text, jsonb, jsonb) to authenticated;
