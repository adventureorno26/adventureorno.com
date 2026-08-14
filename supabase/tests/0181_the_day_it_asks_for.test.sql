-- 0181 — the day the card asks for is the day it records.
--
-- §0.9 requires these to be permanent, not remembered. Everything runs inside one
-- transaction and rolls back; nothing here touches real data.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('bbbb0181-0000-0000-0000-000000000001', 'a0181@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0181-0000-0000-0000-000000000001', 'A0181', 'owner')
on conflict (id) do update set role = 'owner';
set local request.jwt.claims = '{"sub":"bbbb0181-0000-0000-0000-000000000001"}';

-- ---------------------------------------------------------------------------
-- 1. A run on the Tuesday of a week away is dated the Tuesday.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0181-0000-0000-0000-000000000001';
  p uuid; v public.visits; act public.activities;
begin
  insert into public.places (name, lat, lng, saved) values ('T181 Week Away', 41.7, -70.3, true)
    returning id into p;
  v := public.create_visit(p, '2026-06-01', '2026-06-07', null, array[a_id]::uuid[]);

  act := public.add_activity_to_visit(v.id, 'run', 'Tuesday run', 8046.72, 'k181-a', '2026-06-03');
  if act.start_date::date <> '2026-06-03' then
    raise exception 'FAIL: the run should be dated 3 June, got %', act.start_date::date; end if;
  -- local_date is generated from start_date, so the card's grouping follows too
  if act.local_date <> '2026-06-03' then
    raise exception 'FAIL: local_date should follow, got %', act.local_date; end if;

  raise notice 'PASS 1: the activity lands on the day that was chosen';
end $$;

-- ---------------------------------------------------------------------------
-- 2. THE ONE THAT MATTERS: a dinner on one evening is a ONE-DAY visit to the
--    restaurant. It used to inherit the whole parent range — and under §0.4 a
--    multi-day visit IS a trip, so dinner would have become a trip.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0181-0000-0000-0000-000000000001';
  parent uuid; v public.visits; child public.places; cv public.visits;
begin
  insert into public.places (name, lat, lng, saved) values ('T181 San Diego', 32.7, -117.1, true)
    returning id into parent;
  v := public.create_visit(parent, '2026-07-11', '2026-07-16', null, array[a_id]::uuid[]);

  child := public.add_place_to_visit(v.id, 'restaurant', 'Wonderland Ocean Pub', null, null,
                                     'k181-b', '2026-07-13');
  select * into cv from public.visits where place_id = child.id;

  if cv.start_date <> '2026-07-13' or cv.end_date <> '2026-07-13' then
    raise exception 'FAIL: dinner should be one day (13 July), got % to %',
      cv.start_date, cv.end_date; end if;

  if public.counts_as_trip(cv.*) then
    raise exception 'FAIL: a dinner became a TRIP — it inherited the whole week'; end if;

  -- and it is still grouped inside the week
  if cv.parent_visit_id <> v.id then
    raise exception 'FAIL: the dinner should still sit inside the trip'; end if;

  raise notice 'PASS 2: dinner on one evening is one day, and is not a trip';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Omitting the day behaves exactly as before, so every existing caller is
--    unaffected.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0181-0000-0000-0000-000000000001';
  p uuid; v public.visits; act public.activities;
begin
  insert into public.places (name, lat, lng, saved) values ('T181 Default', 39.0, -77.0, true)
    returning id into p;
  v := public.create_visit(p, '2026-09-05', '2026-09-09', null, array[a_id]::uuid[]);

  act := public.add_activity_to_visit(v.id, 'walk', 'Stroll', null, 'k181-c');
  if act.start_date::date <> '2026-09-05' then
    raise exception 'FAIL: with no day given it should use the visit''s first, got %',
      act.start_date::date; end if;

  raise notice 'PASS 3: omitting the day is unchanged behaviour';
end $$;

-- ---------------------------------------------------------------------------
-- 4. A day outside the visit is an ERROR, not a silent clamp. Silently moving
--    it would put the run on a day she did not choose.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0181-0000-0000-0000-000000000001';
  p uuid; v public.visits; act public.activities; child public.places;
begin
  insert into public.places (name, lat, lng, saved) values ('T181 Bounds', 38.2, -77.9, true)
    returning id into p;
  v := public.create_visit(p, '2026-10-01', '2026-10-03', null, array[a_id]::uuid[]);

  begin
    act := public.add_activity_to_visit(v.id, 'hike', 'Nope', null, 'k181-d', '2026-10-09');
    raise exception 'FAIL: a day after the visit was accepted';
  exception when others then
    if position('outside this visit' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    child := public.add_place_to_visit(v.id, 'bar', 'Nope Bar', null, null, 'k181-e', '2026-09-30');
    raise exception 'FAIL: a day before the visit was accepted';
  exception when others then
    if position('outside this visit' in sqlerrm) = 0 then raise; end if;
  end;

  raise notice 'PASS 4: a day outside the visit is refused, not quietly moved';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Only ONE signature of each, so a caller cannot silently get the old one.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'add_activity_to_visit';
  if n <> 1 then raise exception 'FAIL: % signatures of add_activity_to_visit', n; end if;

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'add_place_to_visit';
  if n <> 1 then raise exception 'FAIL: % signatures of add_place_to_visit', n; end if;

  raise notice 'PASS 5: one signature each — no silent overload';
end $$;

rollback;
