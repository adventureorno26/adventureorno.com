-- Saying who was at a place, or on a visit, must not overwrite what they said about it.
--
-- 0236 fixed the same defect for activities. `set_visit_participants` still ran
-- `delete from visit_profiles where visit_id = ...` and rebuilt the rows bare, throwing away
-- claim_status, evidence, asserted_by, decided_by and rule_id every time.
--
-- Two things differ from the activity case and both are asserted here:
--
--   * NO ROW UNTIL THEY AGREE. Nothing filters visit_profiles by claim_status — of the 24
--     functions that read it, only respond_to_tag looks at the column — so a 'proposed' row
--     would already be on somebody's statistics. The claim is the pending state.
--   * A PLACE ASKS ONCE. 43 questions is not a better version of never being asked.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('eeee0240-0000-0000-0000-000000000001','e0240@example.invalid'),
  ('eeee0240-0000-0000-0000-000000000002','j0240@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('eeee0240-0000-0000-0000-000000000001','E0240','owner'),
  ('eeee0240-0000-0000-0000-000000000002','J0240','editor')
on conflict (id) do update set role = excluded.role;
-- 0298: these actors used to share a space because `ensure_profile_space()` put any
-- new non-owner into the only one that existed. That heuristic is gone; the fixture
-- says what it needs instead. See supabase/tests/_prelude.sql.
select test_support.share_one_space();


do $$
declare
  e_id  uuid := 'eeee0240-0000-0000-0000-000000000001';
  j_id  uuid := 'eeee0240-0000-0000-0000-000000000002';
  pl    uuid;
  v1    uuid;
  v2    uuid;
  act   uuid;
  n     int;
begin
  insert into public.places (id, name, lat, lng, saved)
  values (gen_random_uuid(), 'Place 0240', 39.0, -77.0, true) returning id into pl;

  -- A VISIT IS DERIVED, so it cannot be inserted: `rebuild_place_visits` deletes and rebuilds
  -- every visit at a place from its evidence, which quietly destroyed a hand-written fixture
  -- the moment any evidence arrived. Two days of evidence, then read back what the system
  -- built — hers on 03-01, HIS OWN on 04-01.
  insert into public.activities
    (id, type, name, distance, start_date, lat, lng, owner_profile, source, original_source, place_id)
  values (gen_random_uuid(),'Hike','Hers 0240',8000,'2026-03-01T13:00:00Z',39.0,-77.0,
          e_id,'file','file',pl),
         (gen_random_uuid(),'Hike','His own 0240',9000,'2026-04-01T13:00:00Z',39.0,-77.0,
          j_id,'file','file',pl);
  select id into act from public.activities where name = 'His own 0240';

  perform public.rebuild_place_visits(pl);
  select id into v1 from public.visits where place_id = pl and start_date = '2026-03-01';
  select id into v2 from public.visits where place_id = pl and start_date = '2026-04-01';
  if v1 is null or v2 is null then
    raise exception 'FIXTURE: the two days of evidence did not produce two visits';
  end if;
  -- `rebuild_place_visits` builds the visits from dates; visit_evidence is written
  -- separately, so the link that makes the second visit HIS is stated here and the ids are
  -- read again afterwards in case writing it rebuilt anything.
  insert into public.visit_evidence (visit_id, evidence_type, evidence_id, evidence_date)
  values (v2, 'activity', act, '2026-04-01')
  on conflict do nothing;
  select id into v1 from public.visits where place_id = pl and start_date = '2026-03-01';
  select id into v2 from public.visits where place_id = pl and start_date = '2026-04-01';
  if not exists (select 1 from public.visit_evidence
                  where visit_id = v2 and evidence_type = 'activity' and evidence_id = act) then
    raise exception 'FIXTURE: his own activity is not the evidence for the second visit';
  end if;

  -- HE HAS ALREADY ANSWERED a tag on the first visit. This is the record being protected.
  insert into public.memory_people (subject_id, person_id, participation_status, evidence, created_by, tagged_by, decided_by, decided_at)
  select public.subject_for_visit(t.visit_id::uuid), public.person_for_profile(t.profile_id::uuid), t.claim_status, t.evidence, t.created_by, t.asserted_by::uuid, t.decided_by::uuid, t.decided_at::timestamptz
    from (values (v1, e_id, 'accepted', 'own_statement', 'user', null, e_id, now()),
         (v1, j_id, 'accepted', 'tagged_and_accepted', 'user', e_id, j_id, now())) t(visit_id, profile_id, claim_status, evidence, created_by, asserted_by, decided_by, decided_at)
  on conflict (subject_id, person_id) do update
    set participation_status = excluded.participation_status, evidence = excluded.evidence,
        created_by = excluded.created_by, tagged_by = excluded.tagged_by,
        decided_by = excluded.decided_by, decided_at = excluded.decided_at;

  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);

  -- ---- 1. "Together" must not erase his answer --------------------------------
  perform public.set_visit_participants(v1, array[e_id, j_id]);
  if not exists (select 1 from public.visit_profiles
                  where visit_id = v1 and profile_id = j_id
                    and claim_status = 'accepted'
                    and evidence = 'tagged_and_accepted'
                    and decided_by = j_id) then
    raise exception 'FAIL: naming him again erased the record that HE accepted the tag';
  end if;

  -- ---- 2. "Just me" retracts rather than silently deleting ---------------------
  perform public.set_visit_participants(v1, array[e_id]);
  if exists (select 1 from public.visit_profiles where visit_id = v1 and profile_id = j_id) then
    raise exception 'FAIL: removing him left him on the visit';
  end if;
  if not exists (select 1 from public.visit_profiles
                  where visit_id = v1 and profile_id = e_id and claim_status = 'accepted') then
    raise exception 'FAIL: her own presence was deleted along with his';
  end if;

  -- ---- 3. Adding him back ASKS — it does not assert ----------------------------
  perform public.set_visit_participants(v1, array[e_id, j_id]);
  if exists (select 1 from public.visit_profiles where visit_id = v1 and profile_id = j_id) then
    raise exception 'FAIL: a pending tag put a row on his statistics before he agreed';
  end if;
  if not exists (select 1 from public.tag_claims
                  where subject_kind = 'visit' and subject_id = v1
                    and profile_id = j_id and status = 'proposed') then
    raise exception 'FAIL: adding him to a visit raised no claim for him to answer';
  end if;

  -- ---- 4. HIS OWN EVIDENCE IS NOT HERS TO DELETE -------------------------------
  perform public.set_visit_participants(v2, array[e_id]);
  if not exists (select 1 from public.visit_profiles where visit_id = v2 and profile_id = j_id) then
    raise exception 'FAIL: her saying she was alone deleted the visit his own activity proves';
  end if;

  -- ---- 5. A PLACE ASKS ONCE, not once per visit --------------------------------
  perform public.set_place_solo(pl, j_id);
  select count(*) into n from public.tag_claims
   where profile_id = j_id and status = 'proposed'
     and ((subject_kind = 'place' and subject_id = pl)
       or (subject_kind = 'visit' and subject_id in (v1, v2)));
  if n <> 1 then
    raise exception 'FAIL: tagging him on a 2-visit place raised % questions, not 1', n;
  end if;

  -- ---- 6. …and answering it once covers every visit there ----------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', j_id, 'role','authenticated')::text, true);
  perform public.respond_to_tag(
    (select id from public.tag_claims
      where subject_kind = 'place' and subject_id = pl and profile_id = j_id
        and status = 'proposed'), true);

  select count(*) into n from public.visit_profiles
   where profile_id = j_id and visit_id in (v1, v2) and claim_status = 'accepted';
  if n <> 2 then
    raise exception 'FAIL: accepting the place put him on % of its 2 visits', n;
  end if;

  -- ---- 7. ASKING AGAIN AFTER TAKING IT BACK (0241) -----------------------------
  -- `tag_claims_one_per_subject` is UNIQUE per (kind, subject, person), so the ordinary
  -- sequence Together → Just me → Together used to retract the claim and then crash.
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  perform public.set_visit_participants(v1, array[e_id, j_id]);   -- ask
  perform public.set_visit_participants(v1, array[e_id]);          -- take it back
  if not exists (select 1 from public.tag_claims
                  where subject_kind='visit' and subject_id=v1 and profile_id=j_id
                    and status='retracted') then
    raise exception 'FAIL: removing him did not retract the visit claim';
  end if;
  perform public.set_visit_participants(v1, array[e_id, j_id]);    -- ask again
  if not exists (select 1 from public.tag_claims
                  where subject_kind='visit' and subject_id=v1 and profile_id=j_id
                    and status='proposed') then
    raise exception 'FAIL: naming him again after taking it back asked him nothing';
  end if;

  -- ---- 8. …BUT NOT AFTER HE HAS SAID NO ----------------------------------------
  -- "I was not there" is answered once. Re-asking on every press is nagging.
  perform set_config('request.jwt.claims',
    json_build_object('sub', j_id, 'role','authenticated')::text, true);
  perform public.respond_to_tag(
    (select id from public.tag_claims
      where subject_kind='visit' and subject_id=v1 and profile_id=j_id and status='proposed'),
    false);
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  perform public.set_visit_participants(v1, array[e_id, j_id]);
  if exists (select 1 from public.tag_claims
              where subject_kind='visit' and subject_id=v1 and profile_id=j_id
                and status <> 'declined') then
    raise exception 'FAIL: pressing the button re-asked a question he had already declined';
  end if;

  -- ---- 9. THE WIDER QUESTION WITHDRAWS THE NARROWER ONES (0242) ----------------
  -- An open question about one of the place's days, then a statement about the whole place.
  -- "Were you at this place with me?" and "were you here on the 1st?" are one question and
  -- its own subset; asking both is asking twice.
  perform public.set_visit_participants(v2, array[e_id, j_id]);
  if not exists (select 1 from public.tag_claims
                  where subject_kind='visit' and subject_id=v2 and profile_id=j_id
                    and status='proposed') then
    raise exception 'FIXTURE: there was no open question about that day to withdraw';
  end if;

  perform public.set_place_solo(pl, j_id);

  if exists (select 1 from public.tag_claims
              where subject_kind='visit' and profile_id=j_id
                and status in ('proposed','accepted_legacy')
                and subject_id in (v1, v2)) then
    raise exception 'FAIL: asking about the place left its own days still being asked about';
  end if;
  select count(*) into n from public.tag_claims
   where profile_id = j_id and status in ('proposed','accepted_legacy')
     and ((subject_kind='place' and subject_id=pl)
       or (subject_kind='visit' and subject_id in (v1, v2)));
  if n > 1 then
    raise exception 'FAIL: he is being asked % overlapping questions about one place', n;
  end if;
  -- He accepted the place in step 6 and that answer stands: re-stating it must not ask him
  -- to confirm what he has already confirmed.
  if not exists (select 1 from public.tag_claims
                  where subject_kind='place' and subject_id=pl and profile_id=j_id
                    and status='accepted') then
    raise exception 'FAIL: re-stating the place reopened an answer he had already given';
  end if;
end $$;

-- ---- 10. UNDO PUTS PEOPLE BACK; IT DOES NOT ASK ABOUT THEM AGAIN (0244) -------------
-- restore_visit ran everybody through the asking path, so pressing Undo on a deleted visit
-- turned an ACCEPTED participation into an unanswered question and dropped that person from
-- the visit until they answered a second time. Undo restores a record; it makes no claim.
do $$
declare
  e_id  uuid := 'eeee0240-0000-0000-0000-000000000001';
  j_id  uuid := 'eeee0240-0000-0000-0000-000000000002';
  pl    uuid;
  vis   uuid;
  snap  jsonb;
  back  public.visits;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);

  insert into public.places (id, name, lat, lng, saved)
  values (gen_random_uuid(), 'Undo 0240', 39.5, -77.5, true) returning id into pl;
  vis := (public.create_visit(pl, '2026-06-01', '2026-06-01', null, array[e_id]::uuid[])).id;

  -- He is on it, and he ACCEPTED being on it.
  insert into public.memory_people (subject_id, person_id, participation_status, evidence, created_by, tagged_by, decided_by, decided_at)
  select public.subject_for_visit(t.visit_id::uuid), public.person_for_profile(t.profile_id::uuid), t.claim_status, t.evidence, t.created_by, t.asserted_by::uuid, t.decided_by::uuid, t.decided_at::timestamptz
    from (values (vis, j_id, 'accepted', 'tagged_and_accepted', 'user', e_id, j_id, now())) t(visit_id, profile_id, claim_status, evidence, created_by, asserted_by, decided_by, decided_at)
  on conflict (subject_id, person_id) do update
    set participation_status = 'accepted', evidence = 'tagged_and_accepted', decided_by = j_id;

  snap := public.delete_visit(vis);
  back := public.restore_visit(snap);

  if not exists (select 1 from public.visit_profiles
                  where visit_id = back.id and profile_id = j_id) then
    raise exception 'FAIL: undoing a deleted visit dropped a person who had accepted being on it';
  end if;
  if exists (select 1 from public.visit_profiles
              where visit_id = back.id and profile_id = j_id and claim_status <> 'accepted') then
    raise exception 'FAIL: undo turned his accepted participation into something else';
  end if;
  if not exists (select 1 from public.visit_profiles
                  where visit_id = back.id and profile_id = j_id
                    and evidence = 'tagged_and_accepted' and decided_by = j_id) then
    raise exception 'FAIL: undo put back the id and threw away who decided it and how';
  end if;
end $$;

do $$ begin raise notice 'PASS 0240: a visit keeps what its people said about it, a pending tag is not a statistic, and a place is one question'; end $$;

rollback;
