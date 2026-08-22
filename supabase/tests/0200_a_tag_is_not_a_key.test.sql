-- 0200 — being tagged on an outing does not unlock Strava's copy of it.
--
-- The bug this pins down was measured on production: acting as Josh,
-- `mileage_by_person(josh)` returned 46 of Erica's Strava activities and 356.1 of her
-- miles. Nothing was broken in the guard — `can_see_activity` and `visible_activities`
-- were both correct — they simply asked *"does the caller have an activity_profiles
-- row?"*, and 0039 handed Josh 44 of those in a single UPDATE, by date.
--
-- So the test is written from the seat that matters: tag a person on someone else's
-- Strava activity, then check every door — the helper, the view, the RLS policy, and a
-- real reader. A test that only checked one of them would have passed on 2026-08-16 while
-- three others leaked.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('aaaa0200-0000-0000-0000-000000000001', 'e0200@example.invalid'),
  ('aaaa0200-0000-0000-0000-000000000002', 'j0200@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('aaaa0200-0000-0000-0000-000000000001', 'E0200', 'owner'),
  ('aaaa0200-0000-0000-0000-000000000002', 'J0200', 'editor')
on conflict (id) do update set role = excluded.role;

do $$
declare
  e_id     uuid := 'aaaa0200-0000-0000-0000-000000000001';
  j_id     uuid := 'aaaa0200-0000-0000-0000-000000000002';
  p        uuid;
  a_strava uuid;
  a_file   uuid;
  a_untagged uuid;
  n        int;
  ok       boolean;
begin
  insert into public.places (name, lat, lng, saved, categories)
    values ('P0200 Ridge', 39.3, -77.7, true, array['hiking'])
    returning id into p;

  -- ERICA'S STRAVA ACTIVITY, and JOSH IS TAGGED ON IT. This is the exact shape 0039
  -- created 44 times: a true-looking participation row on someone else's Strava data.
  insert into public.activities
      (name, type, distance, start_date, place_id, source, original_source, owner_profile)
    values ('E0200 Strava Run', 'Run', 8046.72, '2026-06-01T13:00:00Z', p,
            'strava', 'strava', e_id)
    returning id into a_strava;
  insert into public.memory_people (subject_id, person_id)
  select public.subject_for_activity(t.activity_id::uuid), public.person_for_profile(t.profile_id::uuid)
    from (values (a_strava, e_id), (a_strava, j_id)) t(activity_id, profile_id)
  on conflict do nothing;

  -- A NON-STRAVA activity, same tagging. This one he is allowed to see — the rule is
  -- about Strava's copy, not about hiding the household's own records from each other.
  insert into public.activities
      (name, type, distance, start_date, place_id, source, original_source, owner_profile)
    values ('E0200 File Walk', 'Walk', 3218.0, '2026-06-02T13:00:00Z', p,
            'file', 'file', e_id)
    returning id into a_file;
  insert into public.memory_people (subject_id, person_id)
  select public.subject_for_activity(t.activity_id::uuid), public.person_for_profile(t.profile_id::uuid)
    from (values (a_file, e_id), (a_file, j_id)) t(activity_id, profile_id)
  on conflict do nothing;

  -- THE CONTROL. Another Strava activity of hers that he is NOT tagged on. Sharing what she
  -- tags him on must never become sharing her account, and only a row like this can prove it.
  insert into public.activities
    (id, type, name, distance, start_date, lat, lng, source, original_source, owner_profile)
  values (gen_random_uuid(), 'Run', 'Hers alone', 7000, '2026-03-02T13:00:00Z', 39.2, -77.6,
          'strava', 'strava', e_id)
  returning id into a_untagged;
  insert into public.memory_people (subject_id, person_id)
  select public.subject_for_activity(t.activity_id::uuid), public.person_for_profile(t.profile_id::uuid)
    from (values (a_untagged, e_id)) t(activity_id, profile_id)
  on conflict do nothing;

  -- ---- act as JOSH -------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', j_id, 'role', 'authenticated')::text, true);

  -- ORIGINAL RULE, kept because a rewritten check must never look like it was always this
  -- permissive: a tag was NOT a key, and `can_see_activity(a_strava)` had to be false for a
  -- tagged person.
  --
  -- REWRITTEN 2026-08-20 for 0228, on Erica's decision: *"share everything I tag Josh on"*.
  -- Tagging someone is now the act of sharing with them — but only when the OWNER has
  -- switched it on, and only for that one outing. The three assertions below are the shape
  -- of that: off means off, on means this outing, and on never means the account.
  --
  -- 1. the helper — with sharing OFF, a tag is still not a key
  update public.profiles set share_tagged_outings = false where id = e_id;
  select public.can_see_activity(a_strava) into ok;
  if ok then
    raise exception 'FAIL: sharing is OFF and a tagged person could still see her Strava activity';
  end if;

  -- …and with sharing ON, the outing he is tagged on opens — and nothing else does
  update public.profiles set share_tagged_outings = true where id = e_id;
  select public.can_see_activity(a_strava) into ok;
  if not ok then
    raise exception 'FAIL: she shares what she tags him on, but the outing stayed hidden';
  end if;
  if public.can_see_activity(a_untagged) then
    raise exception 'FAIL: sharing one outing opened a Strava activity he is NOT tagged on — that is her account, not a memory';
  end if;
  select public.can_see_activity(a_file) into ok;
  if not ok then
    raise exception 'FAIL: can_see_activity() hid a NON-Strava activity from a tagged member';
  end if;

  -- 2. the view every reader was moved onto in 0196
  select count(*) into n from public.visible_activities where id = a_strava;
  if n <> 1 then
    raise exception 'FAIL: the view hid an outing she has shared with him (% rows)', n;
  end if;
  select count(*) into n from public.visible_activities where id = a_untagged;
  if n <> 0 then
    raise exception 'FAIL: the view exposed a Strava activity he is not tagged on';
  end if;
  select count(*) into n from public.visible_activities where id = a_file;
  if n <> 1 then
    raise exception 'FAIL: visible_activities hid a non-Strava activity from a tagged member';
  end if;

  -- 3. THE RLS POLICY, which carried its own copy of the predicate. Fixing the view and
  --    leaving this would make `select * from activities` disagree with every reader.
  -- The policy must say the SAME thing as the view, or which rule applies depends on which
  -- query a screen happens to use (0229).
  set local role authenticated;
  select count(*) into n from public.activities where id = a_strava;
  if n <> 1 then
    raise exception 'FAIL: the row policy disagrees with the view about a shared outing';
  end if;
  select count(*) into n from public.activities where id = a_untagged;
  if n <> 0 then
    raise exception 'FAIL: the row policy let him select a Strava row he is not tagged on';
  end if;
  reset role;

  -- ---- and Erica still sees her own ---------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role', 'authenticated')::text, true);
  select count(*) into n from public.visible_activities where id = a_strava;
  if n <> 1 then
    raise exception 'FAIL: the OWNER cannot see her own Strava activity — the rule closed too far';
  end if;

  -- ---- the source owner cannot be reassigned ------------------------------
  -- Without this, the fix is one UPDATE away from being undone, and the column it rests
  -- on was only immutable by habit.
  begin
    update public.activities set owner_profile = j_id where id = a_strava;
    raise exception 'FAIL: owner_profile was reassigned — the source owner must be immutable';
  exception when insufficient_privilege then
    null; -- expected
  end;

  -- NULL -> a value is still allowed: that is a backfill, not a change of hands.
  update public.activities set owner_profile = null where id = a_file and false;

  raise notice 'PASS: a tag is not a key — helper, view, policy and owner all hold.';
end $$;

rollback;
