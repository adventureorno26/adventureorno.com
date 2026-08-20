-- 0243 — the picker says what it actually did.
--
-- 0236 and 0240/0241/0242 changed what pressing `Together / Just me / Just Josh` MEANS: your
-- own presence you state, anyone else you ASK. The screens did not change with it, and they
-- cannot, because all three functions return `void`:
--
--     await setPlaceSolo(place.id, profileId);
--     setSolo(profileId);            // ← the UI then shows him as being there
--
-- So pressing "Just Josh" now raises a question and the screen reports it as a fact. That is
-- a worse failure than the one being fixed: before, the app wrote something untrue to the
-- database; now it would write the right thing and tell the person the wrong one. A control
-- that cannot report what it did can only guess, and it guessed the old behaviour.
--
-- Each of the three returns jsonb now:
--
--     { "stated": 12, "asked": ["<profile>"], "removed": 0 }
--
--   stated  — rows written because they are YOURS to write (your own presence)
--   asked   — the people a question went to, who are not on it until they answer
--   removed — rows taken off, never including anyone's own recording or own evidence
--
-- The return type changes, so these are dropped and recreated rather than replaced; every
-- caller passes the same arguments and simply ignored the old `void`.
--
-- Nothing about who may do what changes here. The bodies are the ones 0241 and 0242 left,
-- with counters threaded through.

drop function if exists public.set_activity_solo(uuid, uuid);
create function public.set_activity_solo(p_activity uuid, p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
      insert into public.activity_profiles
        (activity_id, profile_id, claim_status, evidence, created_by, decided_by, decided_at)
      values (p_activity, v_person, 'accepted', 'own_statement', 'user', v_me, now())
      on conflict (activity_id, profile_id) do update
        set claim_status = 'accepted', decided_by = v_me, decided_at = now();
      v_stated := v_stated + 1;
    else
      insert into public.activity_profiles
        (activity_id, profile_id, claim_status, evidence, created_by, asserted_by)
      values (p_activity, v_person, 'proposed', 'owner_asserted', 'user', v_me)
      on conflict (activity_id, profile_id) do nothing;

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

  delete from public.activity_profiles ap
   where ap.activity_id = p_activity
     and not (ap.profile_id = any(v_wanted))
     and coalesce(ap.evidence, '') <> 'own_recording';
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
end $function$;

comment on function public.set_activity_solo is
  'Who was on an outing. Your OWN participation you may state; anyone else is ASKED. Returns '
  '{stated, asked, removed} so the screen can say what happened instead of assuming (0243).';

drop function if exists public.set_visit_participants(uuid, uuid[]);
create function public.set_visit_participants(p_visit uuid, p_profiles uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
     and not exists (
           select 1 from public.visit_evidence ve
            where ve.visit_id = p_visit
              and ((ve.evidence_type = 'photo'
                    and exists (select 1 from public.photos ph
                                 where ph.id = ve.evidence_id and ph.uploaded_by = vp.profile_id))
                or (ve.evidence_type = 'activity'
                    and exists (select 1 from public.activities a
                                 where a.id = ve.evidence_id and a.owner_profile = vp.profile_id))));
  get diagnostics v_removed = row_count;

  update public.tag_claims c
     set status = 'retracted', decided_at = now()
   where c.subject_kind = 'visit'
     and c.subject_id = p_visit
     and not (c.profile_id = any(p_profiles))
     and c.status in ('proposed', 'accepted_legacy');

  update public.visits set solo_override = true where id = p_visit;

  return jsonb_build_object('stated', v_stated, 'asked', to_jsonb(v_asked), 'removed', v_removed);
end $function$;

comment on function public.set_visit_participants is
  'Who was on a visit. Your OWN presence you may state; anyone else is a question, and there '
  'is no participant row until they answer it — nothing filters this table by claim_status, so '
  'a pending row would already be on their statistics. Never deletes a person whose own photo '
  'or own activity is the evidence for that day. Returns {stated, asked, removed} (0240, 0243).';

drop function if exists public.set_visit_solo(uuid, uuid);
create function public.set_visit_solo(p_visit uuid, p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_out jsonb;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_out := public.set_visit_participants(
    p_visit,
    case when p_profile is not null then array[p_profile]
         else array(select id from public.profiles
                     where role in ('owner','editor')
                       and coalesce(display_name,'') !~* '(test|bot)') end);
  update public.visits set solo_override = true where id = p_visit;
  return v_out;
end $function$;

drop function if exists public.set_place_solo(uuid, uuid);
create function public.set_place_solo(p_place uuid, p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
     and not exists (
           select 1 from public.visit_evidence ve
            where ve.visit_id = vp.visit_id
              and ((ve.evidence_type = 'photo'
                    and exists (select 1 from public.photos ph
                                 where ph.id = ve.evidence_id and ph.uploaded_by = vp.profile_id))
                or (ve.evidence_type = 'activity'
                    and exists (select 1 from public.activities a
                                 where a.id = ve.evidence_id and a.owner_profile = vp.profile_id))));
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
end $function$;

comment on function public.set_place_solo is
  'Who goes to a place. Your own presence you may state on every visit there; anyone else is '
  'ONE claim about the place, which withdraws any open question about that place''s individual '
  'days. Returns {stated, asked, removed} (0240, 0242, 0243).';

revoke all on function public.set_activity_solo(uuid, uuid) from public, anon;
revoke all on function public.set_visit_participants(uuid, uuid[]) from public, anon;
revoke all on function public.set_visit_solo(uuid, uuid) from public, anon;
revoke all on function public.set_place_solo(uuid, uuid) from public, anon;
grant execute on function public.set_activity_solo(uuid, uuid) to authenticated;
grant execute on function public.set_visit_participants(uuid, uuid[]) to authenticated;
grant execute on function public.set_visit_solo(uuid, uuid) to authenticated;
grant execute on function public.set_place_solo(uuid, uuid) to authenticated;
