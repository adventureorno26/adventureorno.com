-- 0241 — asking again, after you took it back.
--
-- 0240's own test found this on its first run, which is the argument for writing the two
-- together:
--
--     ERROR: 23505: duplicate key value violates unique constraint "tag_claims_one_per_subject"
--
-- `tag_claims_one_per_subject` is UNIQUE on (subject_kind, subject_id, profile_id) — one claim
-- per person per thing, whatever state it is in. 0240 guarded its insert with
-- `where not exists (… and c.status in ('proposed','accepted','accepted_legacy'))`, which
-- reads as "don't ask twice" and actually means "raise a second row once the first is closed".
-- So the sequence a person will genuinely perform —
--
--     Together  →  Just me  →  Together
--
-- retracted the claim and then crashed trying to make a new one. Nobody could re-add a person
-- they had removed.
--
-- 0236 got this right by accident: its guard has no status filter at all, so it never tries.
-- But that is the opposite failure — after retracting, it silently never asks again, and the
-- person is left off with no question raised.
--
-- WHAT REOPENING SHOULD AND SHOULD NOT DO. Three closed states, three different answers:
--
--   retracted → REOPEN. She took it back and has changed her mind; that is hers to do.
--   declined  → LEAVE IT. He said he was not there. Re-asking every time somebody presses
--               the button is nagging dressed up as a data model, and 7a-12 keeps his answer
--               precisely so it does not have to be given twice.
--   accepted  → LEAVE IT. Already true; re-proposing would ask him to confirm what he has
--               confirmed.
--
-- `on conflict … do update … where status = 'retracted'` says exactly that, and a conflict
-- that matches no WHERE is a no-op rather than an error — so the other two states fall
-- through silently, which is what they should do.

create or replace function public.set_visit_participants(p_visit uuid, p_profiles uuid[])
returns setof public.visit_profiles
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me     uuid := auth.uid();
  v_person uuid;
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
    else
      -- No row until they answer: nothing filters visit_profiles by claim_status, so a
      -- pending row would already be on their statistics.
      insert into public.tag_claims
        (subject_kind, subject_id, profile_id, asserted_by, status)
      values ('visit', p_visit, v_person, v_me, 'proposed')
      on conflict (subject_kind, subject_id, profile_id) do update
        set status = 'proposed', asserted_by = v_me, decided_at = null
      where public.tag_claims.status = 'retracted';
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

  update public.tag_claims c
     set status = 'retracted', decided_at = now()
   where c.subject_kind = 'visit'
     and c.subject_id = p_visit
     and not (c.profile_id = any(p_profiles))
     and c.status in ('proposed', 'accepted_legacy');

  update public.visits set solo_override = true where id = p_visit;

  return query select * from public.visit_profiles where visit_id = p_visit;
end $function$;

create or replace function public.set_place_solo(p_place uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me     uuid := auth.uid();
  v_wanted uuid[];
  v_person uuid;
  v_visit  uuid;
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
      end loop;
    else
      -- ONE question for the whole place, reopened if she took it back.
      insert into public.tag_claims
        (subject_kind, subject_id, profile_id, asserted_by, status)
      values ('place', p_place, v_person, v_me, 'proposed')
      on conflict (subject_kind, subject_id, profile_id) do update
        set status = 'proposed', asserted_by = v_me, decided_at = null
      where public.tag_claims.status = 'retracted';
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

  update public.tag_claims c
     set status = 'retracted', decided_at = now()
   where c.status in ('proposed', 'accepted_legacy')
     and not (c.profile_id = any(v_wanted))
     and ((c.subject_kind = 'place' and c.subject_id = p_place)
       or (c.subject_kind = 'visit'
           and c.subject_id in (select id from public.visits where place_id = p_place)));

  update public.visits set manual = true, solo_override = true where place_id = p_place;
end $function$;

-- The same shape in 0236, for the same reason. Its guard never re-asks after a retraction,
-- so a person removed from an outing and named again silently got no question at all.
create or replace function public.set_activity_solo(p_activity uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me      uuid := auth.uid();
  v_place   uuid;
  v_wanted  uuid[];
  v_person  uuid;
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
        set claim_status = 'accepted',
            decided_by   = v_me,
            decided_at   = now();
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
    end if;
  end loop;

  delete from public.activity_profiles ap
   where ap.activity_id = p_activity
     and not (ap.profile_id = any(v_wanted))
     and coalesce(ap.evidence, '') <> 'own_recording';

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
end $function$;

comment on function public.set_activity_solo is
  'Who was on an outing. Your OWN participation you may state; adding anyone else PROPOSES a '
  'claim, removing them retracts it, and naming them again REOPENS a retracted claim but '
  'never a declined one — "I was not there" is answered once (0236, 0241).';
