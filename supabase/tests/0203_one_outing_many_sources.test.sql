-- 0203 — one run recorded three times comes out as one outing per person, counted once.
--
-- THE FIXTURE IS A REAL DAY. 2026-03-07 in production holds:
--
--   Purcellville to Arlington - Full WOD  08:10:36  45.12mi  strava  owner Erica
--   Purcellville Running                  08:10:42  44.68mi  file    owner Josh
--   Purcellville Trailhead - W&OD         08:21:57  44.93mi  file    owner Erica
--
-- One run. It contains BOTH problems at once — a cross-source duplicate (Erica's Strava
-- copy and Erica's file copy of her own run) and a genuine joint outing (Josh's own
-- recording) — and the old importer could not tell them apart. It merged across people and
-- silently discarded the second file.
--
-- The right answer, which this test pins down:
--     Erica: her Strava copy stands; her file copy is created and PROPOSED as its duplicate
--     Josh:  his own recording stands, credited to him, linked to hers as a joint outing
--     nothing swallowed, nothing re-attributed, every submission in the ledger
--
-- Tier 2 proposes rather than merges, and THIS FIXTURE IS WHY: her two recordings of one
-- run start 11 minutes 21 seconds apart. Any auto-merge window wide enough to catch that is
-- too wide to trust unattended.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('cccc0203-0000-0000-0000-000000000001', 'e0203@example.invalid'),
  ('cccc0203-0000-0000-0000-000000000002', 'j0203@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('cccc0203-0000-0000-0000-000000000001', 'E0203', 'owner'),
  ('cccc0203-0000-0000-0000-000000000002', 'J0203', 'editor')
on conflict (id) do update set role = excluded.role;

do $$
declare
  e_id uuid := 'cccc0203-0000-0000-0000-000000000001';
  j_id uuid := 'cccc0203-0000-0000-0000-000000000002';
  run  uuid;
  r1   jsonb; r2 jsonb; r3 jsonb; r4 jsonb;
  a_e  uuid;  a_j uuid;
  n    int;
begin
  -- ---- Erica imports her Strava copy --------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  select public.begin_ingest_run('strava','user',null,null) into run;
  select public.ingest_activity(run,'strava','strava','strava:99001',
    'Purcellville to Arlington - Full WOD','Run',null,72610.0,36533,39.13,-77.71,
    '2026-03-07T13:10:36Z','Garmin fēnix 6S') into r1;
  if r1->>'disposition' <> 'inserted' then
    raise exception 'FAIL: the first recording should have been inserted, got %', r1->>'disposition';
  end if;
  a_e := (r1->>'activity_id')::uuid;

  -- ---- the SAME Strava record arrives again (a retry, or a re-sync) -------
  select public.ingest_activity(run,'strava','strava','strava:99001',
    'Purcellville to Arlington - Full WOD','Run',null,72610.0,36533,39.13,-77.71,
    '2026-03-07T13:10:36Z','Garmin fēnix 6S') into r2;
  if r2->>'disposition' <> 'duplicate' then
    raise exception 'FAIL: re-importing the same source record should be a duplicate, got %', r2->>'disposition';
  end if;
  if (r2->>'activity_id')::uuid <> a_e then
    raise exception 'FAIL: a re-import created a SECOND activity';
  end if;

  -- ---- Erica's own FILE copy of the same run ------------------------------
  -- No shared id with Strava — this is Tier 2, and it must ATTACH, not duplicate and not
  -- vanish the way the old importer made it vanish.
  select public.ingest_activity(run,'file','unknown',null,
    'Purcellville Trailhead - W&OD','Run',null,72290.0,42507,39.13,-77.71,
    '2026-03-07T13:21:57Z',null) into r3;
  if r3->>'disposition' <> 'proposed' then
    raise exception 'FAIL: her own second recording should be created AND PROPOSED as a duplicate, got %', r3->>'disposition';
  end if;
  if (r3->>'activity_id')::uuid = a_e then
    raise exception 'FAIL: it was merged automatically — Tier 2 must only propose';
  end if;

  -- NOT SWALLOWED. The old importer returned an id and inserted nothing; this keeps the
  -- recording and asks.
  --
  -- The field is SHARED_GROUP_ID, not duplicate_of, and 0210 is why: this assertion used to
  -- name a field `apply_inbox_field` cannot write, so the card it demanded was one nobody
  -- could ever accept. The test passed and the double-count survived. What makes a proposal
  -- real is that a person can say yes to it — see 0210_a_proposal_must_be_acceptable, which
  -- checks that rule for every field the importer proposes rather than just this one.
  if not exists (select 1 from public.suggestions
                  where subject_type='activity' and field='shared_group_id'
                    and subject_id = (r3->>'activity_id')::uuid) then
    raise exception 'FAIL: no duplicate suggestion was raised for her second recording';
  end if;

  -- ---- Josh imports HIS OWN recording of the same run ---------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', j_id, 'role','authenticated')::text, true);
  select public.begin_ingest_run('file','user',null,null) into run;
  select public.ingest_activity(run,'file','unknown',null,
    'Purcellville Running','Run',null,71900.0,43174,39.13,-77.71,
    '2026-03-07T13:10:42Z',null) into r4;

  -- THE ONE THE OLD IMPORTER GOT WRONG. His recording is not a duplicate of hers.
  if r4->>'disposition' <> 'inserted' then
    raise exception 'FAIL: another person''s recording was swallowed as a duplicate (%) — that is the bug', r4->>'disposition';
  end if;
  a_j := (r4->>'activity_id')::uuid;
  if a_j = a_e then
    raise exception 'FAIL: his recording was merged into her activity';
  end if;

  -- and it is HIS, not everyone's
  if exists (select 1 from public.activity_profiles where activity_id = a_j and profile_id = e_id) then
    raise exception 'FAIL: importing a file re-credited it to the other person — 0039 all over again';
  end if;
  if not exists (select 1 from public.activity_profiles where activity_id = a_j and profile_id = j_id) then
    raise exception 'FAIL: his own recording is not credited to him';
  end if;

  -- ---- linked, so the outing counts once ---------------------------------
  if (select shared_group_id from public.activities where id = a_e) is null
     or (select shared_group_id from public.activities where id = a_e)
        is distinct from (select shared_group_id from public.activities where id = a_j) then
    raise exception 'FAIL: the two recordings of one outing are not linked, so it counts twice';
  end if;

  -- ---- nothing was silently dropped --------------------------------------
  select count(*) into n from public.ingest_items;
  if n < 4 then
    raise exception 'FAIL: only % ledger rows for 4 submissions — something was swallowed', n;
  end if;

  raise notice 'PASS: same source record deduped; her second app PROPOSED not merged; his recording kept, credited to him and linked; all 4 logged.';
end $$;

rollback;
