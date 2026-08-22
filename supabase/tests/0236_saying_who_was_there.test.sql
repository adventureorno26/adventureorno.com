-- Saying who was there must not overwrite what they said about it.
--
-- `set_activity_solo` backs the `Together / Just me / Just Josh` picker and used to run
-- `delete from activity_profiles where activity_id = ...` followed by a bare insert. Four
-- consequences, the last of which only became true once sharing existed:
--
--   1. it erased his ANSWER — claim_status, evidence, asserted_by, decided_by, rule_id
--   2. it tagged him without asking, around tag_claims entirely
--   3. its "everyone" branch re-added every owner/editor — the 0039 behaviour
--   4. and since 0228, writing an activity_profiles row SHARES a Strava recording, so a
--      picker that silently writes rows is a picker that silently shares
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('eeee0236-0000-0000-0000-000000000001','e0236@example.invalid'),
  ('eeee0236-0000-0000-0000-000000000002','j0236@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('eeee0236-0000-0000-0000-000000000001','E0236','owner'),
  ('eeee0236-0000-0000-0000-000000000002','J0236','editor')
on conflict (id) do update set role = excluded.role;

do $$
declare
  e_id uuid := 'eeee0236-0000-0000-0000-000000000001';
  j_id uuid := 'eeee0236-0000-0000-0000-000000000002';
  act  uuid;
  his  uuid;
begin
  insert into public.activities
    (id,type,name,distance,start_date,lat,lng,owner_profile,source,original_source)
  values (gen_random_uuid(),'Hike','Ours',9000,'2026-04-09T13:00:00Z',39.2,-77.6,e_id,'file','file')
  returning id into act;

  -- HE HAS ALREADY ANSWERED. This is the record 7a-12 exists to keep.
  -- The owner is already on their own recording — the insert trigger says so since 0257 —
  -- so this fills in the shape rather than creating it.
  insert into public.memory_people (subject_id, person_id, participation_status, evidence, created_by, tagged_by, decided_by, decided_at)
  select public.subject_for_activity(t.activity_id::uuid), public.person_for_profile(t.profile_id::uuid), t.claim_status, t.evidence, t.created_by, t.asserted_by::uuid, t.decided_by::uuid, t.decided_at::timestamptz
    from (values (act,e_id,'accepted','own_recording','import',null,e_id,now()),
         (act,j_id,'accepted','tagged_and_accepted','user',e_id,j_id,now())) t(activity_id, profile_id, claim_status, evidence, created_by, asserted_by, decided_by, decided_at)
  on conflict (subject_id, person_id) do update
    set participation_status = excluded.participation_status, evidence = excluded.evidence,
        created_by = excluded.created_by, tagged_by = excluded.tagged_by,
        decided_by = excluded.decided_by, decided_at = excluded.decided_at;

  -- HIS OWN separate recording, which a tag decision must never touch.
  insert into public.activities
    (id,type,name,distance,start_date,lat,lng,owner_profile,source,original_source)
  values (gen_random_uuid(),'Hike','His own',9100,'2026-04-09T13:01:00Z',39.2,-77.6,j_id,'file','file')
  returning id into his;
  insert into public.memory_people (subject_id, person_id, participation_status, evidence, created_by)
  select public.subject_for_activity(t.activity_id::uuid), public.person_for_profile(t.profile_id::uuid), t.claim_status, t.evidence, t.created_by
    from (values (his,j_id,'accepted','own_recording','import')) t(activity_id, profile_id, claim_status, evidence, created_by)
  on conflict (subject_id, person_id) do nothing;

  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);

  -- ---- 1. "Together" must not erase his answer --------------------------
  perform public.set_activity_solo(act, null);
  if not exists (select 1 from public.activity_profiles
                  where activity_id=act and profile_id=j_id
                    and claim_status='accepted' and decided_by=j_id) then
    raise exception 'FAIL: pressing Together erased the record that HE accepted the tag';
  end if;

  -- ---- 2. "Just me" retracts rather than silently deleting ---------------
  perform public.set_activity_solo(act, e_id);
  if exists (select 1 from public.activity_profiles where activity_id=act and profile_id=j_id) then
    raise exception 'FAIL: removing him left him on the outing';
  end if;
  if not exists (select 1 from public.tag_claims
                  where subject_id=act and profile_id=j_id and status='retracted') then
    raise exception 'FAIL: he was removed with no record that the claim was retracted';
  end if;
  if not exists (select 1 from public.activity_profiles
                  where activity_id=act and profile_id=e_id and claim_status='accepted') then
    raise exception 'FAIL: her own participation was deleted along with his';
  end if;

  -- ---- 3. HIS OWN RECORDING IS NOT HERS TO DELETE ------------------------
  if not exists (select 1 from public.activity_profiles
                  where activity_id=his and profile_id=j_id) then
    raise exception 'FAIL: a tag decision removed him from HIS OWN recording';
  end if;

  -- ---- 3b. …BUT YOUR OWN RECORDING IS YOURS TO STEP OFF (0258) -----------
  -- The protection above is against somebody ELSE deleting your evidence — 0236's own words:
  -- "not THE TAGGER'S to delete". Once 0257 made an imported activity's owner row say
  -- `own_recording`, a blanket rule meant she could no longer take herself off a run she had
  -- recorded: pressing "Just Josh" left her on it. Saying you were not on your own recording
  -- is a strange thing to say and it is yours to say.
  perform public.set_activity_solo(act, j_id);
  if exists (select 1 from public.activity_profiles where activity_id=act and profile_id=e_id) then
    raise exception 'FAIL: she could not take herself off a recording she made';
  end if;
  -- put her back for the rest of the test
  perform public.set_activity_solo(act, e_id);

  -- ---- 4. adding him again PROPOSES, it does not assert ------------------
  perform public.set_activity_solo(act, null);
  if (select claim_status from public.activity_profiles
       where activity_id=act and profile_id=j_id) <> 'proposed' then
    raise exception 'FAIL: she tagged him and it counted as his own answer';
  end if;
  if not exists (select 1 from public.tag_claims
                  where subject_id=act and profile_id=j_id) then
    raise exception 'FAIL: tagging him raised no claim for him to answer';
  end if;

  raise notice 'PASS: Together keeps his answer, Just me retracts, her own row and HIS OWN recording survive, and re-tagging proposes.';
end $$;

rollback;
