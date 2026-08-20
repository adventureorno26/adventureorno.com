-- 0244 — undo puts people back; it does not ask about them again.
--
-- Caught by `0185_two_visits_that_were_one` and two others the moment 0240 landed in CI.
--
-- 0240 made `set_visit_participants` ASK rather than assert, which is right for the picker
-- and wrong for its other two callers:
--
--   restore_visit  — REAL REGRESSION. Undoing a deleted visit ran everybody through the
--                    asking path, so anyone else's ACCEPTED participation became an
--                    unanswered question and they silently left the visit until they
--                    answered it a second time. Pressing Undo is not a claim about anybody;
--                    it is putting back a record that already existed.
--   create_visit   — LEFT ALONE, deliberately. Naming somebody while creating a visit is the
--                    same statement as naming them on the picker afterwards, and it should
--                    ask for the same reason. The three tests that broke were asserting the
--                    old behaviour with fixtures, and they now accept the claim.
--
-- AND THE SNAPSHOT WAS ALREADY TOO SMALL FOR ITS JOB. `delete_visit` recorded
-- `jsonb_agg(vp.profile_id)` — enough while a participant WAS an id. The row now carries
-- claim_status, evidence, who asserted it, who decided it and when; an undo that restores
-- only the id throws that away and calls the result the same thing. It records the whole row
-- now, and restore handles both shapes, because an undo token issued minutes before this
-- deploy still carries the old one.

create or replace function public.delete_visit(p_visit uuid, p_children text DEFAULT 'refuse'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row public.visits; v_kids uuid[]; v_snapshot jsonb;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_children not in ('refuse','detach') then
    raise exception 'p_children must be refuse or detach';
  end if;

  select * into v_row from public.visits where id = p_visit for update;
  if v_row.id is null then raise exception 'no such visit'; end if;

  select coalesce(array_agg(id), '{}') into v_kids
    from public.visits where parent_visit_id = p_visit;

  -- `parent_visit_id` is ON DELETE SET NULL, so without this the visits grouped inside
  -- a trip would quietly come loose and nothing would say so.
  if array_length(v_kids, 1) > 0 and p_children = 'refuse' then
    raise exception 'this trip still contains % visit(s) — detach them first, or say so explicitly',
      array_length(v_kids, 1);
  end if;

  -- Everything needed to put it back, captured before the row goes.
  v_snapshot := jsonb_build_object(
    'visit', to_jsonb(v_row) - 'geom',
    -- THE WHOLE ROW, not just the id (0244). It used to record `jsonb_agg(vp.profile_id)`,
    -- which was enough while a participant WAS an id — but the row now carries who asserted
    -- it, who decided it and when, and an undo that puts back only the id throws all of that
    -- away. `- 'geom'` is unnecessary here; visit_profiles has no geometry.
    'profiles', coalesce((select jsonb_agg(to_jsonb(vp))
                            from public.visit_profiles vp where vp.visit_id = p_visit), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(vpe.person_id)
                          from public.visit_people vpe where vpe.visit_id = p_visit), '[]'::jsonb),
    'children', to_jsonb(v_kids),
    'evidence', coalesce((select jsonb_agg(to_jsonb(e))
                            from public.visit_evidence e where e.visit_id = p_visit), '[]'::jsonb));

  if array_length(v_kids, 1) > 0 then
    perform public.detach_child_visit(k) from unnest(v_kids) k;
  end if;

  delete from public.visits where id = p_visit;
  return v_snapshot;
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
  insert into public.visit_profiles
    (visit_id, profile_id, claim_status, evidence, created_by, asserted_by, decided_by,
     decided_at, rule_id)
  select v_row.id,
         coalesce((e->>'profile_id')::uuid, (e #>> '{}')::uuid),
         coalesce(e->>'claim_status', 'accepted'),
         coalesce(e->>'evidence', 'restored'),
         coalesce(e->>'created_by', 'user'),
         (e->>'asserted_by')::uuid,
         (e->>'decided_by')::uuid,
         (e->>'decided_at')::timestamptz,
         (e->>'rule_id')::uuid
    from jsonb_array_elements(coalesce(p_snapshot->'profiles','[]'::jsonb)) e
  on conflict (visit_id, profile_id) do nothing;

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
