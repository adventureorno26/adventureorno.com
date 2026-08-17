-- The tagged person gets asked, "no" actually removes him, and a tag follows the OUTING.
--
-- WHAT WENT WRONG, in three layers, each found by running the layer above it:
--
--   1. `respond_to_tag` refused any claim that was not `proposed`. All 44 of Josh's are
--      `accepted_legacy`, so the one function built to ask him could not be called for a
--      single claim that existed. He had never been asked and, as built, never could be.
--   2. On DECLINE it marked the claim and stopped. For a legacy claim the participation row
--      is ALREADY there — put there by 0039's date rule — so "no" left him credited with
--      the outing he had just said he was not on. A no that changes nothing is 0210's
--      proposal-nobody-could-accept, one layer up.
--   3. Then `my_tags_to_confirm` returned **0 of 44**: every claim names Erica's Strava
--      recording, which he may not see. Reloading as files does not fix it by itself — her
--      file becomes a SECOND row and the claim still points at the first. The tag has to
--      follow the OUTING, not the recording (0214).
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('ffff0213-0000-0000-0000-000000000001', 'e0213@example.invalid'),
  ('ffff0213-0000-0000-0000-000000000002', 'j0213@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('ffff0213-0000-0000-0000-000000000001', 'E0213', 'owner'),
  ('ffff0213-0000-0000-0000-000000000002', 'J0213', 'editor')
on conflict (id) do update set role = excluded.role;

do $$
declare
  e_id  uuid := 'ffff0213-0000-0000-0000-000000000001';
  j_id  uuid := 'ffff0213-0000-0000-0000-000000000002';
  run   uuid;
  strav jsonb; file_copy jsonb; his_own jsonb;
  rule  uuid;
  claim uuid;
  lst   jsonb;
  own_before int; own_after int;
begin
  -- ---- Erica records an outing on Strava, and tags Josh on it ---------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  run := public.begin_ingest_run('strava','user',null,null);
  -- p_origin 'strava', not 'garmin': `original_source` is what the Strava rule reads, and
  -- for her real rows it says strava while the WATCH is recorded on activity_sources.origin.
  -- The first draft passed 'garmin' here, so the fixture's activity was never restricted at
  -- all and the first assertion failed for a reason that had nothing to do with the code.
  strav := public.ingest_activity(run,'strava','strava','strava:213001',
           'Ours together','Hike',null,9000.0,3000,39.30,-77.70,
           '2026-02-10T13:00:00Z','Garmin');

  -- Josh has his OWN membership on something else entirely, which must never be touched.
  perform set_config('request.jwt.claims',
    json_build_object('sub', j_id, 'role','authenticated')::text, true);
  run := public.begin_ingest_run('file-upload','user',null,null);
  his_own := public.ingest_activity(run,'file','garmin',null,
             'His own separate day','Run',null,5000.0,1800,41.00,-79.00,
             '2026-02-11T13:00:00Z','Garmin Connect');
  select count(*) into own_before from public.activity_profiles where profile_id = j_id;

  -- ---- the tag, stored the way 0039's date rule left the real ones ---------
  insert into public.tagging_rules (created_by, subject_profile, from_date, status, note)
  values (e_id, j_id, date '2026-01-01', 'active', 'We were together')
  returning id into rule;

  insert into public.activity_profiles
    (activity_id, profile_id, claim_status, evidence, created_by, asserted_by, rule_id)
  values ((strav->>'activity_id')::uuid, j_id, 'accepted_legacy',
          'owner_asserted_date_backfill', 'migration', e_id, rule);
  insert into public.tag_claims
    (rule_id, subject_kind, subject_id, profile_id, asserted_by, status)
  values (rule, 'activity', (strav->>'activity_id')::uuid, j_id, e_id, 'accepted_legacy')
  returning id into claim;

  -- ---- 1. HE CANNOT SEE IT YET, so he is not asked about it ----------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', j_id, 'role','authenticated')::text, true);
  if jsonb_array_length(public.my_tags_to_confirm()) <> 0 then
    raise exception 'FAIL: he was shown a tag on a Strava recording he may not see';
  end if;

  -- ---- 2. Erica reloads that day as a file, and links the two --------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  run := public.begin_ingest_run('file-upload','user',null,null);
  file_copy := public.ingest_activity(run,'file','garmin',null,
               'Ours together, from the watch','Hike',null,9010.0,3000,39.30,-77.70,
               '2026-02-10T13:00:20Z','Garmin Connect');
  perform public.approve_import_duplicates();

  -- ---- 3. NOW he is asked — via the other recording of the same outing -----
  perform set_config('request.jwt.claims',
    json_build_object('sub', j_id, 'role','authenticated')::text, true);
  lst := public.my_tags_to_confirm();
  if jsonb_array_length(lst) <> 1 then
    raise exception 'FAIL: after the reload he is asked about % tags, not 1', jsonb_array_length(lst);
  end if;
  if ((lst->0)->>'via_another_recording')::boolean is not true then
    raise exception 'FAIL: it did not reach him through the visible recording';
  end if;

  -- ---- 4. accepting credits him where he can actually see it ---------------
  perform public.respond_to_tag(claim, true);
  if not exists (
    select 1 from public.activity_profiles ap
     where ap.profile_id = j_id
       and ap.activity_id = (file_copy->>'activity_id')::uuid) then
    raise exception 'FAIL: he accepted and was credited on nothing he can see';
  end if;
  if (select status from public.tag_claims where id = claim) <> 'accepted' then
    raise exception 'FAIL: the claim was not marked accepted';
  end if;

  -- ---- 5. and DECLINING removes him from every recording of that outing ----
  update public.tag_claims set status = 'accepted_legacy', decided_at = null where id = claim;
  perform public.respond_to_tag(claim, false);

  if exists (
    select 1 from public.activity_profiles ap
     where ap.profile_id = j_id
       and ap.activity_id in ((strav->>'activity_id')::uuid, (file_copy->>'activity_id')::uuid)) then
    raise exception 'FAIL: he said no and is still credited with the outing — the bug 0213 fixed';
  end if;

  -- ---- 6. HIS OWN is untouched, which is the part that must never break ----
  select count(*) into own_after from public.activity_profiles where profile_id = j_id;
  if own_after <> own_before then
    raise exception 'FAIL: answering a tag changed his own memberships (% -> %)',
      own_before, own_after;
  end if;
  if not exists (
    select 1 from public.activity_profiles
     where profile_id = j_id and activity_id = (his_own->>'activity_id')::uuid) then
    raise exception 'FAIL: answering a tag removed him from his OWN recording';
  end if;

  -- ---- 7. and nobody else may answer for him ------------------------------
  update public.tag_claims set status = 'accepted_legacy', decided_at = null where id = claim;
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  begin
    perform public.respond_to_tag(claim, true);
    raise exception 'FAIL: the person who MADE the claim was allowed to answer it';
  exception when insufficient_privilege then
    null; -- correct
  end;

  raise notice 'PASS: asked only when visible, reached via the outing, accept credits him, no removes him, his own untouched, and only he may answer.';
end $$;

rollback;
