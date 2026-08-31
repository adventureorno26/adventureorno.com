-- 0196 — Erica cannot see Josh's Strava data through ANY reader.
--
-- This is the test 0193 should have shipped with. 0193 added the helper, the view and
-- the policy, and every one of them was correct; the app read none of them, and nothing
-- failed, because nothing asked the question from a person's seat.
--
-- So the question is asked here the only way that means anything: sign in as one person,
-- call the readers a browser can call, and look for the other person's Strava-origin
-- activity in the answer. A test that inspects policies would have passed on 2026-08-15
-- and been wrong.
--
-- Everything runs in one transaction and rolls back. Nothing here touches real data.
begin;

set local check_function_bodies = off;

-- E is the owner, J is the editor. Both are members: this is not about permissions,
-- it is about one specific category of data between two people who trust each other.
insert into auth.users (id, email) values
  ('eeee0196-0000-0000-0000-000000000001', 'e0196@example.invalid'),
  ('eeee0196-0000-0000-0000-000000000002', 'j0196@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('eeee0196-0000-0000-0000-000000000001', 'E0196', 'owner'),
  ('eeee0196-0000-0000-0000-000000000002', 'J0196', 'editor')
on conflict (id) do update set role = excluded.role;
-- 0298: these actors used to share a space because `ensure_profile_space()` put any
-- new non-owner into the only one that existed. That heuristic is gone; the fixture
-- says what it needs instead. See supabase/tests/_prelude.sql.
select test_support.share_one_space();


do $$
declare
  e_id     uuid := 'eeee0196-0000-0000-0000-000000000001';
  j_id     uuid := 'eeee0196-0000-0000-0000-000000000002';
  p        uuid;
  v        uuid;
  j_strava uuid;
  j_file   uuid;
  n        int;
  miles    numeric;
begin
  insert into public.places (name, lat, lng, saved, categories)
    values ('P0196 Ridge', 39.2, -77.6, true, array['hiking'])
    returning id into p;

  -- `accepted_at` matters: `accepted_visits` is `status='taken' and accepted_at is not
  -- null`, and card_view reads that view. A fixture without it produces an EMPTY card,
  -- which passes every "does it leak?" check for the wrong reason — the first draft of
  -- this test did exactly that.
  insert into public.visits (place_id, start_date, end_date, status, manual, accepted_at)
    values (p, '2026-05-02', '2026-05-02', 'taken', true, now()) returning id into v;
  insert into public.memory_people (subject_id, person_id)
  select public.subject_for_visit(t.visit_id::uuid), public.person_for_profile(t.profile_id::uuid)
    from (values (v, e_id), (v, j_id)) t(visit_id, profile_id)
  on conflict do nothing;

  -- JOSH'S STRAVA RUN. original_source says where it BEGAN, which is the only thing the
  -- rule is written against — `source` says how we received it and is not the question.
  insert into public.activities
      (name, type, distance, start_date, place_id, visit_id, source, original_source, owner_profile)
    values ('J0196 Strava Run', 'Run', 8046.72, '2026-05-02T14:00:00Z', p, v,
            'strava', 'strava', j_id)
    returning id into j_strava;
  insert into public.memory_people (subject_id, person_id)
  select public.subject_for_activity(t.activity_id::uuid), public.person_for_profile(t.profile_id::uuid)
    from (values (j_strava, j_id)) t(activity_id, profile_id)
  on conflict do nothing;

  -- JOSH'S FILE IMPORT, same day, same place. This one carries no restriction at all,
  -- and it is here so a reader that simply returns nothing cannot pass by accident.
  insert into public.activities
      (name, type, distance, start_date, place_id, visit_id, source, original_source, owner_profile)
    values ('J0196 File Hike', 'Hike', 3218.69, '2026-05-02T09:00:00Z', p, v,
            'file', 'file', j_id)
    returning id into j_file;
  insert into public.memory_people (subject_id, person_id)
  select public.subject_for_activity(t.activity_id::uuid), public.person_for_profile(t.profile_id::uuid)
    from (values (j_file, j_id)) t(activity_id, profile_id)
  on conflict do nothing;

  -- ---------------------------------------------------------------------------
  -- From here on we are ERICA.
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', e_id)::text, true);

  -- 1. The helper itself.
  if public.can_see_activity(j_strava) then
    raise exception 'FAIL 1: can_see_activity says Erica may see Josh''s Strava run';
  end if;
  if not public.can_see_activity(j_file) then
    raise exception 'FAIL 1: can_see_activity hid a FILE import, which carries no restriction';
  end if;
  raise notice 'PASS 1: the helper answers both ways';

  -- 2. The view.
  if exists (select 1 from public.visible_activities where id = j_strava) then
    raise exception 'FAIL 2: visible_activities shows Josh''s Strava run';
  end if;
  if not exists (select 1 from public.visible_activities where id = j_file) then
    raise exception 'FAIL 2: visible_activities hid the file import';
  end if;
  raise notice 'PASS 2: the view answers both ways';

  -- 3. THE ONE THAT MATTERS MOST. Before 0196 this returned Josh's mileage to Erica
  --    for the asking, because SECURITY DEFINER walks straight past the policy.
  select coalesce(sum(m.miles), 0) into miles
    from public.mileage_by_person(j_id) m;
  if miles > 2.1 then
    raise exception
      'FAIL 3: mileage_by_person gave Erica % miles of Josh''s — the Strava run is in there',
      miles;
  end if;
  raise notice 'PASS 3: mileage_by_person(josh) = % miles — the file import only', miles;

  -- 4. Every remaining reader a browser can call, by name, so that adding a reader that
  --    forgets the rule fails HERE rather than in front of a user.
  select count(*) into n from public.activities_of_type('Run') a where a.id = j_strava;
  if n > 0 then raise exception 'FAIL 4: activities_of_type leaks it'; end if;

  -- activity_lines draws the route overlays on the map. A polyline IS the data.
  if (select count(*) from public.activity_lines() l where l.id = j_strava) > 0 then
    raise exception 'FAIL 4: activity_lines leaks it — its route would draw on Erica''s map';
  end if;

  if (public.card_view(p)::text) like '%J0196 Strava Run%' then
    raise exception 'FAIL 4: card_view leaks it';
  end if;

  if (public.visit_detail(v)::text) like '%J0196 Strava Run%' then
    raise exception 'FAIL 4: visit_detail leaks it';
  end if;

  if (public.inbox()::text) like '%J0196 Strava Run%' then
    raise exception 'FAIL 4: inbox leaks it';
  end if;

  raise notice 'PASS 4: no browser-callable reader returned it';

  -- 5. AND THE FILE IMPORT IS STILL THERE. A reader that hid everything would pass every
  --    check above, and would be a different bug wearing this one's clothes.
  if (public.card_view(p)::text) not like '%J0196 File Hike%' then
    raise exception 'FAIL 5: card_view hid the file import too — this is over-filtering';
  end if;
  raise notice 'PASS 5: the unrestricted activity is still visible';

  -- ---------------------------------------------------------------------------
  -- 6. And Josh still sees his own. The rule is "only its athlete", not "nobody".
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', j_id)::text, true);

  if not public.can_see_activity(j_strava) then
    raise exception 'FAIL 6: Josh cannot see his OWN Strava run';
  end if;
  if not exists (select 1 from public.visible_activities where id = j_strava) then
    raise exception 'FAIL 6: the view hides Josh''s own run from Josh';
  end if;
  select coalesce(sum(m.miles), 0) into miles from public.mileage_by_person(j_id) m;
  if miles < 6 then
    raise exception 'FAIL 6: Josh''s own mileage is missing his Strava run (got %)', miles;
  end if;
  raise notice 'PASS 6: Josh sees his own, % miles', miles;
end $$;

rollback;
