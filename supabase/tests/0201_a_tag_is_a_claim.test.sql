-- 0201 — a tag is a claim, and only the tagged person can turn it into a fact.
--
-- §A has said since 2026-08-11 that tagging someone means "they are asked to verify it
-- before it is added". Nothing implemented it: 0039 wrote 44 participations for Josh in one
-- UPDATE, and he has still never been asked about any of them.
--
-- The trap this pins down is the one that makes the whole feature pointless if it slips: a
-- PROPOSED tag must not be counted by anything. If proposals lived in activity_profiles,
-- every reader would treat them as fact and proposing would BE applying.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('bbbb0201-0000-0000-0000-000000000001', 'e0201@example.invalid'),
  ('bbbb0201-0000-0000-0000-000000000002', 'j0201@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0201-0000-0000-0000-000000000001', 'E0201', 'owner'),
  ('bbbb0201-0000-0000-0000-000000000002', 'J0201', 'editor')
on conflict (id) do update set role = excluded.role;
-- 0298: these actors used to share a space because `ensure_profile_space()` put any
-- new non-owner into the only one that existed. That heuristic is gone; the fixture
-- says what it needs instead. See supabase/tests/_prelude.sql.
select test_support.share_one_space();


do $$
declare
  e_id  uuid := 'bbbb0201-0000-0000-0000-000000000001';
  j_id  uuid := 'bbbb0201-0000-0000-0000-000000000002';
  p     uuid;
  a_in  uuid;   -- inside the rule's range
  a_out uuid;   -- before it
  a_exc uuid;   -- inside, but excepted: "her race, not a joint outing"
  rule  uuid;
  claim uuid;
  n     int;
begin
  insert into public.places (name, lat, lng, saved, categories)
    values ('P0201 Ridge', 39.4, -77.8, true, array['hiking']) returning id into p;

  insert into public.activities (name, type, distance, start_date, place_id, source, original_source, owner_profile)
    values ('Inside the range','Run',8046.0,'2026-01-05T13:00:00Z',p,'file','file',e_id) returning id into a_in;
  insert into public.activities (name, type, distance, start_date, place_id, source, original_source, owner_profile)
    values ('Before the range','Run',8046.0,'2025-11-05T13:00:00Z',p,'file','file',e_id) returning id into a_out;
  insert into public.activities (name, type, distance, start_date, place_id, source, original_source, owner_profile)
    values ('Her race','Run',42195.0,'2026-02-05T13:00:00Z',p,'file','file',e_id) returning id into a_exc;

  -- ---- Erica proposes the rule, naming the exception, exactly as she did in December ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  select public.propose_tagging_rule(j_id, date '2025-12-21', null, '{}',
                                     'test rule', array[a_exc]) into rule;

  select count(*) into n from public.tag_claims where rule_id = rule;
  if n <> 1 then
    raise exception 'FAIL: expected 1 claim (in-range, not excepted); got %', n;
  end if;
  if exists (select 1 from public.tag_claims where rule_id=rule and subject_id=a_out) then
    raise exception 'FAIL: the rule claimed an activity from BEFORE its range';
  end if;
  if exists (select 1 from public.tag_claims where rule_id=rule and subject_id=a_exc) then
    raise exception 'FAIL: the rule claimed the activity it was told to except';
  end if;

  -- THE LOAD-BEARING ASSERTION. A proposal must change nothing that anything counts.
  select count(*) into n from public.activity_profiles
   where activity_id = a_in and profile_id = j_id;
  if n <> 0 then
    raise exception 'FAIL: proposing a tag already made it a participation — proposing IS applying';
  end if;

  -- ---- the asserter cannot accept on the other person's behalf ----
  select id into claim from public.tag_claims where rule_id=rule and subject_id=a_in;
  begin
    perform public.respond_to_tag(claim, true);
    raise exception 'FAIL: Erica accepted a tag on Josh''s behalf';
  exception when insufficient_privilege then
    null; -- expected
  end;

  -- ---- Josh accepts, and only THEN is he a participant ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', j_id, 'role','authenticated')::text, true);
  perform public.respond_to_tag(claim, true);

  select count(*) into n from public.activity_profiles
   where activity_id = a_in and profile_id = j_id;
  if n <> 1 then
    raise exception 'FAIL: accepting a tag did not create the participation';
  end if;
  if not exists (select 1 from public.activity_profiles
                  where activity_id=a_in and profile_id=j_id
                    and evidence='tagged_and_accepted' and decided_by=j_id and asserted_by=e_id) then
    raise exception 'FAIL: the participation does not record who claimed it and who agreed';
  end if;

  -- ---- revoking takes back proposals, and leaves what he agreed to ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  perform public.revoke_tagging_rule(rule);

  select count(*) into n from public.activity_profiles
   where activity_id = a_in and profile_id = j_id;
  if n <> 1 then
    raise exception 'FAIL: revoking the rule removed a participation Josh had ACCEPTED — his decision, not hers to undo';
  end if;

  raise notice 'PASS: proposals count for nothing, only the tagged person may accept, and revoking leaves his decisions alone.';
end $$;

rollback;
