-- 0173 — an activity is done by whoever did it, and no reader infers from dates.
--
-- §0.9 requires these to be permanent, not remembered. Everything runs inside one
-- transaction and rolls back; nothing here touches real data.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('bbbb0173-0000-0000-0000-000000000001', 'a0173@example.invalid'),
  ('bbbb0173-0000-0000-0000-000000000002', 'b0173@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0173-0000-0000-0000-000000000001', 'A0173', 'owner'),
  ('bbbb0173-0000-0000-0000-000000000002', 'B0173', 'editor')
on conflict (id) do update set role = excluded.role;
set local request.jwt.claims = '{"sub":"bbbb0173-0000-0000-0000-000000000001"}';

-- ---------------------------------------------------------------------------
-- 1. THE CASE THAT FORCED A SEPARATE TABLE: both went, one ran (§0.3).
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0173-0000-0000-0000-000000000001';
  b_id uuid := 'bbbb0173-0000-0000-0000-000000000002';
  p uuid; v uuid; act uuid; n int; m double precision;
begin
  insert into public.places (name, lat, lng, saved) values ('T173 Trailhead', 39.1, -77.5, true)
    returning id into p;
  -- a visit BOTH of them made
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-04-10', '2026-04-10', 'taken', true) returning id into v;

  if not public.is_shared_visit(v) then
    raise exception 'FAIL: setup — the visit should have both members on it'; end if;

  -- but only B ran
  insert into public.activities (name, type, distance, start_date, place_id,
                                 visit_id, solo_profile, source, owner_profile)
    values ('T173 Run', 'Run', 8046.72, '2026-04-10T12:00:00Z', p, v, b_id,
            'manual', b_id)
    returning id into act;

  select count(*) into n from public.activity_profiles where activity_id = act;
  if n <> 1 then raise exception 'FAIL: a solo activity must have exactly one participant, got %', n; end if;
  if not exists (select 1 from public.activity_profiles where activity_id = act and profile_id = b_id) then
    raise exception 'FAIL: the activity belongs to whoever did it'; end if;

  -- THE WHOLE POINT: the visit is shared, the activity is not.
  if public.is_shared_activity(act) then
    raise exception 'FAIL: an activity one person did must not count as shared just because the visit was'; end if;

  -- and the miles land on B only
  select coalesce(sum(distance),0) into m from public.activities a
   where a.id = act and exists (select 1 from public.activity_profiles ap
                                 where ap.activity_id = a.id and ap.profile_id = b_id);
  if m <= 0 then raise exception 'FAIL: B must get the miles'; end if;
  if exists (select 1 from public.activity_profiles where activity_id = act and profile_id = a_id) then
    raise exception 'FAIL: A must NOT get miles for a run B did'; end if;

  raise notice 'PASS 1: both visited, one ran — the miles follow the runner';
end $$;

-- ---------------------------------------------------------------------------
-- 2. The mirror stays true while solo_profile still exists (§0.8).
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0173-0000-0000-0000-000000000001';
  b_id uuid := 'bbbb0173-0000-0000-0000-000000000002';
  p uuid; act uuid; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T173 Loop', 39.2, -77.6, true)
    returning id into p;
  insert into public.activities (name, type, distance, start_date, place_id,
                                 solo_profile, source, owner_profile)
    values ('T173 Walk', 'Walk', 3000, '2026-04-11T12:00:00Z', p, a_id,
            'manual', a_id)
    returning id into act;

  if not exists (select 1 from public.activity_profiles where activity_id = act and profile_id = a_id) then
    raise exception 'FAIL: insert must write the participant row'; end if;

  -- reattributing moves the row
  update public.activities set solo_profile = b_id where id = act;
  if exists (select 1 from public.activity_profiles where activity_id = act and profile_id = a_id) then
    raise exception 'FAIL: reattributing must remove the old participant'; end if;
  if not exists (select 1 from public.activity_profiles where activity_id = act and profile_id = b_id) then
    raise exception 'FAIL: reattributing must add the new participant'; end if;

  -- "Both" means everyone real, which is what NULL used to assert
  update public.activities set solo_profile = null where id = act;
  select count(*) into n from public.activity_profiles where activity_id = act;
  if n <> 2 then raise exception 'FAIL: Both must write every active member, got %', n; end if;
  if not public.is_shared_activity(act) then
    raise exception 'FAIL: an activity both did must count as shared'; end if;

  raise notice 'PASS 2: solo_profile and the participant rows cannot disagree';
end $$;

-- ---------------------------------------------------------------------------
-- 3. NO READER INFERS CONTAINMENT FROM DATES (§0.1).
-- ---------------------------------------------------------------------------
do $$
declare
  trip_place uuid; other_place uuid; tv uuid; unrelated uuid; contents int;
begin
  insert into public.places (name, lat, lng, saved) values ('T173 Cape', 41.7, -70.3, true)
    returning id into trip_place;
  insert into public.places (name, lat, lng, saved) values ('T173 Elsewhere', 34.0, -118.2, true)
    returning id into other_place;

  -- a multi-day trip
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (trip_place, '2026-06-01', '2026-06-07', 'taken', true) returning id into tv;
  -- a visit somewhere else entirely, on a day inside those dates
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (other_place, '2026-06-03', '2026-06-03', 'taken', true) returning id into unrelated;

  if public.visit_is_inside_trip(unrelated) then
    raise exception 'FAIL: a visit 3000 miles away is not inside the trip just because the dates overlap'; end if;

  select count(*) into contents from public.trip_contents(tv);
  if contents <> 0 then
    raise exception 'FAIL: the trip contains only what is explicitly grouped, got % rows', contents; end if;

  -- it IS proposed, so the grouping is offered rather than lost
  if not exists (select 1 from public.trip_attachment_candidates()
                  where visit_id = unrelated and trip_visit_id = tv) then
    raise exception 'FAIL: the old inference must survive as a suggestion'; end if;

  -- accepting the proposal is what makes it true
  perform public.attach_child_visit(unrelated, tv);
  if not public.visit_is_inside_trip(unrelated) then
    raise exception 'FAIL: attaching must put the visit inside the trip'; end if;
  select count(*) into contents from public.trip_contents(tv);
  if contents <> 1 then raise exception 'FAIL: the attached visit must appear in the contents, got %', contents; end if;
  if exists (select 1 from public.trip_attachment_candidates() where visit_id = unrelated) then
    raise exception 'FAIL: an attached visit must stop being proposed'; end if;

  raise notice 'PASS 3: dates propose, a human attaches, and only attachment counts';
end $$;

-- ---------------------------------------------------------------------------
-- 4. visit_detail reads the visit's own activities, and knows a multi-day visit
--    is a trip without being marked (§0.4).
-- ---------------------------------------------------------------------------
do $$
declare
  p uuid; v1 uuid; v2 uuid; d jsonb;
begin
  insert into public.places (name, lat, lng, saved) values ('T173 Same Place', 38.5, -77.0, true)
    returning id into p;
  -- TWO visits to one place sharing a day: the old date rule could not tell them apart
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-05-01', '2026-05-03', 'taken', true) returning id into v1;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-05-02', '2026-05-02', 'taken', true) returning id into v2;

  insert into public.activities (name, type, distance, start_date, place_id,
                                 visit_id, source, owner_profile)
    values ('T173 Hike A', 'Hike', 5000, '2026-05-02T12:00:00Z', p, v2,
            'manual', 'bbbb0173-0000-0000-0000-000000000001');

  d := public.visit_detail(v1);
  if jsonb_array_length(d->'activities') <> 0 then
    raise exception 'FAIL: the activity belongs to the other visit, got % rows',
      jsonb_array_length(d->'activities'); end if;

  d := public.visit_detail(v2);
  if jsonb_array_length(d->'activities') <> 1 then
    raise exception 'FAIL: the visit must show its OWN activity, got % rows',
      jsonb_array_length(d->'activities'); end if;

  -- v1 is multi-day, so it is a trip nobody marked; its contents must still resolve
  perform public.attach_child_visit(v2, v1);
  d := public.visit_detail(v1);
  if jsonb_array_length(d->'contents') <> 1 then
    raise exception 'FAIL: an unmarked MULTI-DAY visit is still a trip and must show contents, got %',
      jsonb_array_length(d->'contents'); end if;

  raise notice 'PASS 4: a visit shows its own activities, and multi-day means trip';
end $$;

-- ---------------------------------------------------------------------------
-- 5. None of it is reachable anonymously.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.activity_profiles', 'SELECT')
  or has_table_privilege('anon', 'public.activity_participant_review', 'SELECT')
  or has_function_privilege('anon', 'public.is_shared_activity(uuid)', 'EXECUTE')
  or has_function_privilege('anon', 'public.trip_attachment_candidates()', 'EXECUTE')
  or has_function_privilege('anon', 'public.mileage_by_person(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can reach activity attribution';
  end if;

  raise notice 'PASS 5: anon reaches none of it';
end $$;

rollback;
