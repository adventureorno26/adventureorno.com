-- 0163/0164 — the trip definition and the "+ Add an activity" dropdown.
--
-- §0.9 requires these to be permanent, not remembered. Everything runs inside one
-- transaction and rolls back; nothing here touches real data.
begin;

set local check_function_bodies = off;

-- A real member so is_editor_or_owner() passes and auth.uid() resolves.
insert into auth.users (id, email) values
  ('bbbb0164-0000-0000-0000-000000000001', 't0164@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0164-0000-0000-0000-000000000001', 'T0164', 'owner')
on conflict (id) do update set role = 'owner';
set local request.jwt.claims = '{"sub":"bbbb0164-0000-0000-0000-000000000001"}';

-- ---------------------------------------------------------------------------
-- 1. counts_as_trip is the ONE definition (§0.4).
-- ---------------------------------------------------------------------------
do $$
declare p uuid; multi uuid; single uuid; marked uuid; planned uuid; unacc uuid; v public.visits;
begin
  insert into public.places (name, lat, lng, saved) values ('T164 Place', 38.9, -77.4, true)
    returning id into p;

  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-05-01', '2026-05-04', 'taken', true) returning id into multi;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-06-01', '2026-06-01', 'taken', true) returning id into single;
  insert into public.visits (place_id, start_date, end_date, status, manual, trip_marked)
    values (p, '2026-07-01', '2026-07-01', 'taken', true, true) returning id into marked;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-08-01', '2026-08-05', 'planned', true) returning id into planned;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-09-01', '2026-09-05', 'taken', true) returning id into unacc;
  update public.visits set accepted_at = null where id = unacc;

  select * into v from public.visits where id = multi;
  if not public.counts_as_trip(v.*) then
    raise exception 'FAIL: a multi-day visit must count as a trip without being marked'; end if;

  select * into v from public.visits where id = single;
  if public.counts_as_trip(v.*) then
    raise exception 'FAIL: an unmarked single-day visit is not a trip'; end if;

  select * into v from public.visits where id = marked;
  if not public.counts_as_trip(v.*) then
    raise exception 'FAIL: a MARKED single-day visit must count as a trip'; end if;

  -- unmarking reverses only that decision
  update public.visits set trip_marked = false where id = marked;
  select * into v from public.visits where id = marked;
  if public.counts_as_trip(v.*) then
    raise exception 'FAIL: unmarking must reverse the trip decision'; end if;

  select * into v from public.visits where id = planned;
  if public.counts_as_trip(v.*) then
    raise exception 'FAIL: a planned visit must never count'; end if;
  if exists (select 1 from public.accepted_visits where id = planned) then
    raise exception 'FAIL: a planned visit must not appear in accepted_visits'; end if;

  select * into v from public.visits where id = unacc;
  if public.counts_as_trip(v.*) then
    raise exception 'FAIL: an UNACCEPTED visit must never count'; end if;
  if exists (select 1 from public.accepted_visits where id = unacc) then
    raise exception 'FAIL: an unaccepted visit must not appear in accepted_visits'; end if;

  raise notice 'PASS 1: multi-day counts, marked single-day counts, unmarking reverses, planned and unaccepted never count';
end $$;

-- ---------------------------------------------------------------------------
-- 2. There is ONE column for the mark now (0191). This used to assert that
--    is_trip and trip_marked stayed in step; that mirror is gone, so what is
--    worth asserting is that the mark alone decides.
do $$
declare
  a_id uuid := 'aaaa0164-0000-0000-0000-000000000001';
  p uuid; v uuid; marked boolean;
begin
  insert into public.places (name, lat, lng, saved) values ('V164 Mark', 38.5, -77.2, true)
    returning id into p;
  insert into public.visits (place_id, start_date, end_date, manual)
    values (p, '2026-02-02', '2026-02-02', true) returning id into v;

  perform public.set_visit_is_trip(v, true);
  select trip_marked into marked from public.visits where id = v;
  if not marked then raise exception 'FAIL: marking a visit did not set trip_marked'; end if;

  perform public.set_visit_is_trip(v, false);
  select trip_marked into marked from public.visits where id = v;
  if marked then raise exception 'FAIL: unmarking a visit did not clear trip_marked'; end if;

  raise notice 'PASS 2: one column carries the mark, and set_visit_is_trip drives it';
end $$;

-- ---------------------------------------------------------------------------
-- 3. The dropdown's ROUTE half, and idempotent retry.
-- ---------------------------------------------------------------------------
do $$
declare p uuid; v uuid; act public.activities; again public.activities; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T164 Trailhead', 39.3, -77.7, true)
    returning id into p;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-04-02', '2026-04-02', 'taken', true) returning id into v;

  act := public.add_activity_to_visit(v, 'hike', 'Morning hike', 6400, 'key-abc');
  if act.visit_id <> v then raise exception 'FAIL: the activity must link to the visit'; end if;
  if act.type <> 'Hike' then raise exception 'FAIL: option hike must create type Hike, got %', act.type; end if;

  -- Bike maps to Strava's 'Ride' rather than inventing a second spelling.
  if (public.add_activity_to_visit(v, 'bike', null, null, 'key-bike')).type <> 'Ride' then
    raise exception 'FAIL: option bike must create type Ride'; end if;

  -- A dropped connection retried with the same key must NOT make a second row.
  again := public.add_activity_to_visit(v, 'hike', 'Morning hike', 6400, 'key-abc');
  if again.id <> act.id then raise exception 'FAIL: retry with the same key made a second activity'; end if;
  select count(*) into n from public.activities where visit_id = v;
  if n <> 2 then raise exception 'FAIL: expected 2 activities, got %', n; end if;

  begin
    act := public.add_activity_to_visit(v, 'restaurant');
    raise exception 'FAIL: a place option must not be accepted as a route';
  exception when others then
    if position('creates a place' in sqlerrm) = 0 then raise; end if;
  end;

  raise notice 'PASS 3: routes attach to the visit, bike means Ride, retries are idempotent';
end $$;

-- ---------------------------------------------------------------------------
-- 4. The dropdown's PLACE half — a restaurant IS a place, its dates are visits.
-- ---------------------------------------------------------------------------
do $$
declare parent uuid; v uuid; child public.places; again public.places; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T164 San Diego', 32.7, -117.1, true)
    returning id into parent;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (parent, '2026-07-11', '2026-07-16', 'taken', true) returning id into v;

  child := public.add_place_to_visit(v, 'restaurant', 'Wonderland Ocean Pub');
  if not (child.categories @> array['dining']) then
    raise exception 'FAIL: restaurant must map to the existing dining category, got %', child.categories; end if;
  if not exists (select 1 from public.place_membership
                  where child_id = child.id and parent_id = parent) then
    raise exception 'FAIL: the child must be a member of the parent place'; end if;

  -- "the dates are visits to those places"
  select count(*) into n from public.visits where place_id = child.id;
  if n <> 1 then raise exception 'FAIL: the child place must get its own visit, got %', n; end if;

  -- the parent visit is multi-day, so it qualifies and the child is grouped under it
  if (select parent_visit_id from public.visits where place_id = child.id) <> v then
    raise exception 'FAIL: the child visit must be grouped under the qualifying parent'; end if;

  -- adding the same restaurant again must not duplicate the place
  again := public.add_place_to_visit(v, 'restaurant', 'wonderland ocean pub');
  if again.id <> child.id then raise exception 'FAIL: the same-named child was duplicated'; end if;
  select count(*) into n from public.places where id in (child.id, again.id);
  if n <> 1 then raise exception 'FAIL: expected one place, got %', n; end if;

  begin
    child := public.add_place_to_visit(v, 'hike', 'Nope');
    raise exception 'FAIL: a route option must not be accepted as a place';
  exception when others then
    if position('creates a route' in sqlerrm) = 0 then raise; end if;
  end;

  raise notice 'PASS 4: a restaurant is a place with its own visit, grouped under the trip, never duplicated';
end $$;

-- ---------------------------------------------------------------------------
-- 5. The dropdown is DATA, and anon reaches none of it.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.activity_options where active;
  if n < 8 then raise exception 'FAIL: expected the 8 seeded options, got %', n; end if;

  -- signatures gained a trailing p_day in 0181
  if has_function_privilege('anon', 'public.add_activity_to_visit(uuid,text,text,double precision,text,date)', 'EXECUTE')
  or has_function_privilege('anon', 'public.add_place_to_visit(uuid,text,text,double precision,double precision,text,date)', 'EXECUTE')
  or has_table_privilege('anon', 'public.activity_options', 'SELECT') then
    raise exception 'FAIL: anon can reach the activity dropdown or its RPCs';
  end if;

  raise notice 'PASS 5: eight options seeded; anon reaches none of it';
end $$;

rollback;
