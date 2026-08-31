-- 0293 — removing someone is a decision, not an erasure.
--
-- WHAT 0293 ITSELF ALREADY PROVES, so that this file does not repeat it. The migration
-- carries its own `do $check$` block, and because `scripts/db-test.sh` replays the entire
-- chain before running these tests, that block has already asserted — on this very
-- database — that none of the three writers still DELETEs a participation, that all three
-- now retract, that both views exclude retracted rows, and that 0290's
-- `is_member(space_id)` predicate survived the rewrite. If any of those were false the
-- chain would not have applied and this file would never run.
--
-- WHAT THIS FILE ADDS is the RULE, on rows it makes itself:
--
--   1. a retracted participation STILL EXISTS — removal is a record, not an erasure;
--   2. and the view STOPS REPORTING it — which is the half that makes removal actually
--      remove. Nothing filtered these rows by status before 0293: 34 of the 41 readers
--      never mention `claim_status`, so without the view predicate a "removed" person
--      would go on counting in every statistic.
--
-- Step 3 then BREAKS THE TIE deliberately — un-retracts the row and asserts the view
-- reports it again — because a test that cannot fail is not evidence.
--
-- NO PRODUCTION COUNT IS ASSERTED. This replays from an empty schema where every real
-- total is 0; every number below is about rows this file inserted, found by its own ids.
begin;

-- ---- FIXTURES -------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaa0293-0000-0000-0000-000000000001','v293-ann@example.test'),
  ('bbbb0293-0000-0000-0000-000000000002','v293-bob@example.test')
  on conflict do nothing;

insert into public.profiles (id, role, display_name) values
  ('aaaa0293-0000-0000-0000-000000000001','owner','V293 Ann'),
  ('bbbb0293-0000-0000-0000-000000000002','editor','V293 Bob')
  on conflict do nothing;

insert into public.spaces (id, name, owner_profile) values
  ('11110293-0000-0000-0000-000000000001','V293 space','aaaa0293-0000-0000-0000-000000000001')
  on conflict do nothing;

delete from public.space_memberships
 where profile_id in ('aaaa0293-0000-0000-0000-000000000001','bbbb0293-0000-0000-0000-000000000002');
insert into public.space_memberships (space_id, profile_id, role) values
  ('11110293-0000-0000-0000-000000000001','aaaa0293-0000-0000-0000-000000000001','owner'),
  ('11110293-0000-0000-0000-000000000001','bbbb0293-0000-0000-0000-000000000002','editor');

insert into public.places (id, name, lat, lng, saved, space_id, created_by) values
  ('a1110293-0000-0000-0000-000000000001','V293 Overlook', 38.90, -77.30, true,
   '11110293-0000-0000-0000-000000000001','aaaa0293-0000-0000-0000-000000000001')
  on conflict do nothing;

-- `end_date` is NOT NULL on visits — a one-day visit ends the day it starts.
insert into public.visits (id, place_id, start_date, end_date, space_id) values
  ('c1110293-0000-0000-0000-000000000001','a1110293-0000-0000-0000-000000000001',
   current_date, current_date, '11110293-0000-0000-0000-000000000001')
  on conflict do nothing;

-- 0262 gives every account exactly one `people` row and `people` carries
-- unique (owner_profile, linked_profile) with no space_id in it — so these are FOUND, not
-- created, which is the same accommodation 0292's test had to make.
update public.people set space_id = '11110293-0000-0000-0000-000000000001'
 where linked_profile in ('aaaa0293-0000-0000-0000-000000000001',
                          'bbbb0293-0000-0000-0000-000000000002');

-- Bob is on Ann's visit, accepted.
insert into public.memory_people
  (subject_id, person_id, participation_status, evidence, created_by, space_id)
select public.subject_for_visit('c1110293-0000-0000-0000-000000000001'), pe.id,
       'accepted', 'own_statement', 'user', '11110293-0000-0000-0000-000000000001'
  from public.people pe
 where pe.linked_profile = 'bbbb0293-0000-0000-0000-000000000002'
 limit 1
  on conflict do nothing;

-- The view is space-gated by 0290, so act as Ann for the reads below.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa0293-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare n int;
begin
  select count(*) into n from public.visit_profiles
   where visit_id = 'c1110293-0000-0000-0000-000000000001'
     and profile_id = 'bbbb0293-0000-0000-0000-000000000002';
  if n <> 1 then
    raise exception 'SETUP: expected Bob on the visit before anything is retracted, found %', n;
  end if;
  raise notice 'PASS 0293/0 — Bob is on the visit to begin with';
end $$;

reset role;

-- ---- 1. A RETRACTION IS A RECORD, NOT AN ERASURE --------------------------
update public.memory_people
   set participation_status = 'retracted', decided_at = now()
 where subject_id = public.subject_for_visit('c1110293-0000-0000-0000-000000000001')
   and person_id in (select id from public.people
                      where linked_profile = 'bbbb0293-0000-0000-0000-000000000002');

do $$
declare n int;
begin
  select count(*) into n from public.memory_people
   where subject_id = public.subject_for_visit('c1110293-0000-0000-0000-000000000001')
     and person_id in (select id from public.people
                        where linked_profile = 'bbbb0293-0000-0000-0000-000000000002');
  if n <> 1 then
    raise exception
      'FAIL 0293/1 — the retracted row is gone (%). Removal must leave a record: that is '
      'the whole instruction, and it is what lets an accepted tag stop being hostage to '
      'whoever made it.', n;
  end if;
  raise notice 'PASS 0293/1 — the row survives its own retraction';
end $$;

-- ---- 2. AND THE READERS STOP COUNTING IT ----------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa0293-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare n int;
begin
  select count(*) into n from public.visit_profiles
   where visit_id = 'c1110293-0000-0000-0000-000000000001'
     and profile_id = 'bbbb0293-0000-0000-0000-000000000002';
  if n <> 0 then
    raise exception
      'FAIL 0293/2 — visit_profiles still reports a retracted participation (%). Without '
      'this predicate a removed person keeps counting in every one of the 34 readers that '
      'never look at claim_status.', n;
  end if;
  raise notice 'PASS 0293/2 — the view stops reporting a retracted participation';
end $$;

reset role;

-- ---- 3. BREAK THE TIE — a test that cannot fail is not evidence -----------
update public.memory_people
   set participation_status = 'accepted'
 where subject_id = public.subject_for_visit('c1110293-0000-0000-0000-000000000001')
   and person_id in (select id from public.people
                      where linked_profile = 'bbbb0293-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa0293-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare n int;
begin
  select count(*) into n from public.visit_profiles
   where visit_id = 'c1110293-0000-0000-0000-000000000001'
     and profile_id = 'bbbb0293-0000-0000-0000-000000000002';
  if n <> 1 then
    raise exception
      'FAIL 0293/3 — the view did not report Bob again after un-retracting him (%), so '
      'step 2 proved nothing: the view may be hiding him for some other reason.', n;
  end if;
  raise notice 'PASS 0293/3 — the view reports him again, so step 2 was about the status';
end $$;

reset role;

rollback;
