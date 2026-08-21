-- 0264 — `accepted_legacy` is not a synonym for `accepted`, and 0262 treated it as one.
--
-- Checking whether a view over `memory_people` can reproduce `activity_profiles` exactly:
--
--     rows in the table but not the view … 0
--     rows in the view but not the table … 0
--     rows differing in a column ………………… 44
--
-- All forty-four are `claim_status = 'accepted_legacy'`, which 0262 folded into `accepted` on
-- the way across under the heading "one word for one idea". That heading was right about
-- **rejected** and **declined**, which are two spellings of the same thing. It is wrong here:
-- `accepted_legacy` does not mean "accepted", it means **accepted by a rule rather than by the
-- person** — the 44 tags a tagging rule applied to Josh before anyone thought to ask him, and
-- the reason `respond_to_tag` and `my_tags_to_confirm` both treat it as still answerable.
--
-- The information was not lost — `verification_status = 'unverified'` carries it — but the
-- compatibility view in the next step has to return what the table returns, byte for byte, or
-- the migration is not a migration. Preserving the value is cheaper than proving that every
-- reader is indifferent to it, and the reader who is not indifferent is the one nobody checked.
alter table public.memory_people drop constraint if exists memory_people_participation_status_check;
alter table public.memory_people add constraint memory_people_participation_status_check
  check (participation_status in ('proposed','accepted','accepted_legacy','declined','retracted'));

update public.memory_people mp
   set participation_status = 'accepted_legacy'
  from public.memory_subjects s, public.people pe, public.activity_profiles ap
 where s.id = mp.subject_id and s.kind = 'outing'
   and pe.id = mp.person_id
   and ap.activity_id = s.activity_id and ap.profile_id = pe.linked_profile
   and ap.claim_status = 'accepted_legacy'
   and mp.participation_status = 'accepted';

update public.memory_people mp
   set participation_status = 'accepted_legacy'
  from public.memory_subjects s, public.people pe, public.visit_profiles vp
 where s.id = mp.subject_id and s.kind = 'visit'
   and pe.id = mp.person_id
   and vp.visit_id = s.visit_id and vp.profile_id = pe.linked_profile
   and vp.claim_status = 'accepted_legacy'
   and mp.participation_status = 'accepted';

comment on column public.memory_people.participation_status is
  'proposed | accepted | accepted_legacy | declined | retracted. `accepted_legacy` is NOT a '
  'synonym for accepted — it is accepted BY A RULE rather than by the person, which is why '
  'respond_to_tag still treats it as answerable (0264).';

-- And it has to be exact now, or the next step cannot happen.
do $$
declare v_diff int;
begin
  select count(*) into v_diff
    from public.activity_profiles ap
    join public.people pe on pe.linked_profile = ap.profile_id and pe.owner_profile = ap.profile_id
    join public.memory_subjects s on s.activity_id = ap.activity_id
    join public.memory_people mp on mp.subject_id = s.id and mp.person_id = pe.id
   where (ap.claim_status, coalesce(ap.evidence,'unknown'), coalesce(ap.created_by,'unknown'), ap.rule_id)
         is distinct from
         (case mp.participation_status when 'declined' then 'rejected' else mp.participation_status end,
          mp.evidence, mp.created_by, mp.rule_id);
  if v_diff > 0 then
    raise exception 'STILL DIFFERENT: % outing rows do not match the table they came from', v_diff;
  end if;

  select count(*) into v_diff
    from public.visit_profiles vp
    join public.people pe on pe.linked_profile = vp.profile_id and pe.owner_profile = vp.profile_id
    join public.memory_subjects s on s.visit_id = vp.visit_id
    join public.memory_people mp on mp.subject_id = s.id and mp.person_id = pe.id
   where (vp.claim_status, coalesce(vp.evidence,'unknown'), coalesce(vp.created_by,'unknown'), vp.rule_id)
         is distinct from
         (case mp.participation_status when 'declined' then 'rejected' else mp.participation_status end,
          mp.evidence, mp.created_by, mp.rule_id);
  if v_diff > 0 then
    raise exception 'STILL DIFFERENT: % visit rows do not match the table they came from', v_diff;
  end if;
end $$;
