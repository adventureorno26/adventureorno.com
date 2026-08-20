-- 0242 — asking about the place withdraws the questions about its days.
--
-- Also found by 0240's test:
--
--     FAIL: tagging him on a 2-visit place raised 2 questions, not 1
--
-- The place claim was raised correctly. What made it two was an OPEN VISIT CLAIM about one of
-- that place's days, left over from an earlier statement — so he was being asked both
--
--     "were you at this place with me?"            (the place)
--     "were you here on the 1st of March?"         (one of its visits)
--
-- which is one question and its own subset, presented as two things to answer. Whichever he
-- answers first, the other is either redundant or contradictory, and a queue that asks a
-- person to adjudicate between two versions of the same question is how the review queue got
-- into the state she described on 08-20: *"this is all fucked up and nonsensical, and the
-- options are redundant and make no sense."*
--
-- A statement about the place is the WIDER one and it is made second, so it supersedes: open
-- visit claims for that person at that place are retracted as the place claim goes up. Not
-- deleted, and not answered on his behalf — retracted, which is the word for a question
-- somebody stopped asking.
--
-- NOT SYMMETRIC, DELIBERATELY. Naming somebody on a single visit does not touch an open place
-- claim: a day is not an answer about the place, and withdrawing the wider question because
-- the narrower one was asked would lose the part he had not been asked about yet.
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
      -- ONE question for the whole place, reopened if she took it back (0241)…
      insert into public.tag_claims
        (subject_kind, subject_id, profile_id, asserted_by, status)
      values ('place', p_place, v_person, v_me, 'proposed')
      on conflict (subject_kind, subject_id, profile_id) do update
        set status = 'proposed', asserted_by = v_me, decided_at = null
      where public.tag_claims.status = 'retracted';

      -- …and it withdraws the questions about that place's individual days, which are its
      -- own subset. Asking both is asking twice.
      update public.tag_claims c
         set status = 'retracted', decided_at = now()
       where c.subject_kind = 'visit'
         and c.profile_id = v_person
         and c.status in ('proposed', 'accepted_legacy')
         and c.subject_id in (select id from public.visits where place_id = p_place);
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

comment on function public.set_place_solo is
  'Who goes to a place. Your own presence you may state on every visit there; anyone else is '
  'ONE claim about the place, which withdraws any open question about that place''s '
  'individual days — the wider statement is made second and supersedes them (0240, 0242).';
