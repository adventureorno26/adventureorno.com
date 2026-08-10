-- PUT THE MACHINES BEHIND THE GUARD.
--
-- Step 4 of docs/INGEST-BUILD-PLAN.md. Steps 1–3 built the ledger, the suggester and
-- the Inbox; until this migration, though, the rule only applied to code that opted
-- in. This is the step that makes it true everywhere.
--
-- The split (design §4), verified against the LIVE function bodies rather than the
-- design's from-memory list:
--
--   4.1 PERSON-INITIATED — she is already deciding when she calls these, so they
--       write the value AND record the approval. Her edit in the app IS an approval;
--       she must never confirm the same thing twice, once in the editor and again in
--       a queue.
--         set_place_name · update_activity · reassign_activity · set_visit_place ·
--         set_visit_is_trip · set_photo_visit
--
--   4.2 MACHINE-INITIATED — must ask before writing a field a person has decided.
--         rename_activities_for_place  (the one that can actually clobber an approved
--                                       activity name: it rewrites every generic name
--                                       at a place whenever that place is renamed)
--
--   4.3 DERIVED — recompute_place_stats, rebuild_place_visits, ensure_visit and the
--       soft-delete/restore pair touch counts, geometry and dates, never a name or a
--       placement. Untouched, deliberately.
--
-- Each function below is the LIVE definition with the marked lines added and nothing
-- else changed — the 0137 lesson: diff against what is deployed, not against what the
-- repo remembers.

begin;

-- ---------------------------------------------------------------------------
-- 1. Recording an approval, from inside a person's own edit.
-- ---------------------------------------------------------------------------
create or replace function public.record_approval(
  p_type text, p_id uuid, p_field text, p_value jsonb
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_me uuid := auth.uid();
begin
  -- No signed-in person means no decision to record. Cron and service-role paths land
  -- here; they must not fail, and they must not forge an approval either.
  if v_me is null or p_id is null then return; end if;
  insert into public.approved_fields (subject_type, subject_id, field, value, approved_by, via)
  values (p_type, p_id, p_field, p_value, v_me, 'edit')
  on conflict (subject_type, subject_id, field)
    do update set value = excluded.value, approved_by = excluded.approved_by,
                  approved_at = now(), via = 'edit';
end
$function$;

comment on function public.record_approval(text, uuid, text, jsonb) is
  'Her edit in the app IS an approval. Called by the person-initiated RPCs so the '
  'Inbox never asks about something she has already decided.';

revoke all on function public.record_approval(text, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. GROUP 4.1 — person-initiated: write, and lock.
-- ---------------------------------------------------------------------------

create or replace function public.set_place_name(p_place uuid, p_name text, p_scope uuid default null::uuid)
returns places
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.places;
  v_me  uuid := auth.uid();
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'a place needs a name';
  end if;

  -- You cannot rename a place someone named in their own space.
  if not public.can_rename_place(p_place, v_me) then
    raise exception 'this place was named in another person''s space; only they can rename it'
      using errcode = '42501';
  end if;

  -- A personal scope may only ever be your own — you cannot name INTO someone
  -- else's space and lock them out of their own place.
  if p_scope is not null and p_scope <> v_me then
    raise exception 'you can only name a place in your own space or the shared one'
      using errcode = '42501';
  end if;

  update public.places
     set name = btrim(p_name),
         name_locked = true,       -- automation must never touch it again
         named_by = v_me,
         name_scope = p_scope,
         auto = false,
         needs_geocode = false     -- and the geocoder must not re-derive it
   where id = p_place
  returning * into v_row;

  if v_row.id is null then raise exception 'place % not found', p_place; end if;
  -- ADDED: name_locked was one of four partial, inconsistent versions of "don't touch
  -- this". Record it in the one ledger too, so the Inbox and may_autowrite see it.
  perform public.record_approval('place', p_place, 'name', to_jsonb(btrim(p_name)));
  return v_row;
end $function$;

create or replace function public.update_activity(p_id uuid, p_name text, p_type text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare pl uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized';
  end if;
  update public.activities
    set name = coalesce(p_name, name),
        type = coalesce(p_type, type)
    where id = p_id
    returning place_id into pl;
  -- ADDED: only a NAME edit is a naming decision. Changing the type alone must not
  -- lock the name, or a stray type fix would silently stop every future suggestion.
  if p_name is not null then
    perform public.record_approval('activity', p_id, 'name', to_jsonb(btrim(p_name)));
  end if;
  if pl is not null then perform public.recompute_place_stats(pl); end if;
end $function$;

create or replace function public.reassign_activity(p_activity uuid, p_place uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare old_place uuid;
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  select place_id into old_place from public.activities where id = p_activity;
  update public.activities set place_id = p_place where id = p_activity;
  -- ADDED: moving an activity by hand is a decision about where it happened.
  perform public.record_approval('activity', p_activity, 'place_id', to_jsonb(p_place));
  if old_place is not null then
    perform public.recompute_place_stats(old_place);
    perform public.rebuild_place_visits(old_place);
  end if;
  if p_place is not null then
    perform public.recompute_place_stats(p_place);
    perform public.rebuild_place_visits(p_place);
  end if;
end $function$;

create or replace function public.set_visit_place(p_visit uuid, p_place uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_old uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_place is null then raise exception 'a visit needs a place'; end if;
  if not exists (select 1 from public.places where id = p_place) then
    raise exception 'place % not found', p_place;
  end if;

  select place_id into v_old from public.visits where id = p_visit;
  if v_old is null then raise exception 'visit % not found', p_visit; end if;
  if v_old = p_place then return; end if;

  -- manual = true: a person moved this deliberately, so rebuild must not delete it.
  update public.visits set place_id = p_place, manual = true where id = p_visit;
  -- ADDED: and record it, so the ledger agrees with `manual` rather than duplicating it.
  perform public.record_approval('visit', p_visit, 'place_id', to_jsonb(p_place));

  perform public.recompute_place_stats(v_old);
  perform public.rebuild_place_visits(v_old);
  perform public.recompute_place_stats(p_place);
end $function$;

create or replace function public.set_visit_is_trip(p_visit uuid, p_is_trip boolean)
returns visits
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row public.visits;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.visits
     set is_trip = coalesce(p_is_trip, false),
         manual  = case when p_is_trip then true else manual end
   where id = p_visit
  returning * into v_row;

  if v_row.id is null then raise exception 'visit % not found', p_visit; end if;
  -- ADDED: "this was a trip" is exactly the kind of judgement no machine should undo.
  perform public.record_approval('visit', p_visit, 'is_trip', to_jsonb(coalesce(p_is_trip, false)));
  perform public.recompute_place_stats(v_row.place_id);
  return v_row;
end $function$;

create or replace function public.set_photo_visit(p_photo uuid, p_visit uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_place uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_visit is null then
    update public.photos set visit_id = null where id = p_photo;
    -- ADDED: unpinning is a decision too — it must not be quietly re-pinned later.
    perform public.record_approval('photo', p_photo, 'visit_id', to_jsonb(p_visit));
    return;
  end if;

  select place_id into v_place from public.visits where id = p_visit;
  if v_place is null then raise exception 'visit % not found', p_visit; end if;

  -- Pinning also moves the photo to that visit's place, or it would be pinned to a
  -- visit it cannot be seen from. The DATE stays exactly as it was.
  update public.photos set visit_id = p_visit, place_id = v_place where id = p_photo;
  perform public.record_approval('photo', p_photo, 'visit_id', to_jsonb(p_visit));
end $function$;

-- ---------------------------------------------------------------------------
-- 3. GROUP 4.2 — machine-initiated: ask first.
-- ---------------------------------------------------------------------------
-- This is the one that could actually undo an approval. When a place gets a better
-- name, every activity there still carrying the OLD place name follows it. That is
-- right for a machine-written name and WRONG for one Erica chose — and until now the
-- only thing standing between them was is_generic_activity_name(), which cannot know
-- whether a real-looking name was hers or a previous guess.
create or replace function public.rename_activities_for_place(p_place uuid, p_old_name text default null::text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_new text; v_n integer;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select nullif(btrim(name), '') into v_new from public.places where id = p_place;
  if v_new is null then return 0; end if;

  update public.activities a
     set name = v_new
   where a.place_id = p_place
     and a.name is distinct from v_new
     and (public.is_generic_activity_name(a.name)
          or (p_old_name is not null and btrim(a.name) = btrim(p_old_name)))
     -- ADDED: and only where nobody has decided this activity's name.
     and public.may_autowrite('activity', a.id, 'name');
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

commit;
