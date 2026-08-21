-- 0259 — the sign was backwards on the two visit pickers.
--
-- Three regression tests caught it the moment 0258 reached CI:
--
--     0166: naming another person put 1 row(s) on the visit before they agreed
--     0169: the set was not replaced, got 2
--
-- 0258 said "your own recording is still yours to step off", which is right, and wrote it
-- correctly for the activity picker:
--
--     and not (evidence = 'own_recording' and profile_id <> v_me)     -- delete unless it is
--                                                                    -- SOMEBODY ELSE'S
--                                                                    -- evidence
--
-- and backwards for the two visit ones:
--
--     and vp.profile_id <> v_me and not exists (…their own photo or activity…)
--
-- which does not exempt the caller from the PROTECTION — it exempts them from being REMOVED
-- AT ALL. So pressing "Just Josh" on a visit left her on it, permanently, on every visit in
-- the app. Exactly the behaviour 0258's own title says it was restoring, achieved in the
-- opposite direction.
--
-- The rule, said as a condition rather than as two: a row goes when it was not named AND
-- either it is the caller's own or nobody else's evidence stands behind it.
--
--     and (vp.profile_id = v_me or not exists (…))
--
-- Nothing else in either function changes.

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
        insert into public.visit_profiles
          (visit_id, profile_id, claim_status, evidence, created_by, decided_by, decided_at)
        values (v_visit, v_me, 'accepted', 'own_statement', 'user', v_me, now())
        on conflict (visit_id, profile_id) do update
          set claim_status = 'accepted', decided_by = v_me, decided_at = now();
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

  delete from public.visit_profiles vp
   using public.visits v
   where v.id = vp.visit_id
     and v.place_id = p_place
     and not (vp.profile_id = any(v_wanted))
     and (vp.profile_id = v_me or not exists (
           select 1 from public.visit_evidence ve
            where ve.visit_id = vp.visit_id
              and ((ve.evidence_type = 'photo'
                    and exists (select 1 from public.photos ph
                                 where ph.id = ve.evidence_id and ph.uploaded_by = vp.profile_id))
                or (ve.evidence_type = 'activity'
                    and exists (select 1 from public.activities a
                                 where a.id = ve.evidence_id and a.owner_profile = vp.profile_id)))));
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
      insert into public.visit_profiles
        (visit_id, profile_id, claim_status, evidence, created_by, decided_by, decided_at)
      values (p_visit, v_person, 'accepted', 'own_statement', 'user', v_me, now())
      on conflict (visit_id, profile_id) do update
        set claim_status = 'accepted', decided_by = v_me, decided_at = now();
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

  delete from public.visit_profiles vp
   where vp.visit_id = p_visit
     and not (vp.profile_id = any(p_profiles))
     and (vp.profile_id = v_me or not exists (
           select 1 from public.visit_evidence ve
            where ve.visit_id = p_visit
              and ((ve.evidence_type = 'photo'
                    and exists (select 1 from public.photos ph
                                 where ph.id = ve.evidence_id and ph.uploaded_by = vp.profile_id))
                or (ve.evidence_type = 'activity'
                    and exists (select 1 from public.activities a
                                 where a.id = ve.evidence_id and a.owner_profile = vp.profile_id)))));
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
