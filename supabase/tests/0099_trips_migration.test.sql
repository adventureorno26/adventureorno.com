-- DB test for migration 0099 (Visit-linked trip_stops + careful backfill).
-- LOCAL disposable stack only. Fictional data, transaction-rolled-back. Exercises
-- the REAL functions (migrate_container_place_trips, trip_place_ids, trip_stats)
-- under a real member session — no duplicated SQL.

begin;

-- Member session (owner).
insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-00000000c001', 'testowner@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('cccccccc-0000-0000-0000-00000000c001', 'owner', 'Test Owner');
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000c001"}';

-- Fixtures.
insert into public.places (id, name, lat, lng, category, holds_children, saved, suggested, deleted_at, first_visit, last_visit) values
  ('dddddddd-0000-0000-0000-00000000a001','Clean Trip',   1,1,'trip', true, true, false, null, '2026-04-01','2026-04-10'),
  ('dddddddd-0000-0000-0000-00000000a002','Undated Trip', 1,1,'trip', true, true, false, null, null, null),
  ('dddddddd-0000-0000-0000-00000000a003','Suggested Trip',1,1,'trip',true, true, true,  null, '2026-04-01','2026-04-10'),
  ('dddddddd-0000-0000-0000-00000000b001','Repeat Place', 1,1,'beach', false, true, false, null, '2026-04-02','2026-04-05'),
  ('dddddddd-0000-0000-0000-00000000b002','No-Visit Place',1,1,'dining',false, true, false, null, null, null),
  ('dddddddd-0000-0000-0000-00000000b003','Unsaved Draft',1,1,'dining',false, false,false, null, null, null),
  ('dddddddd-0000-0000-0000-00000000b004','Deleted Member',1,1,'dining',false,true, false, now(), null, null),
  ('dddddddd-0000-0000-0000-00000000b005','Unrelated Place',9,9,'hiking',false,true, false, null,'2026-04-03','2026-04-03');
insert into public.place_membership (child_id, parent_id) values
  ('dddddddd-0000-0000-0000-00000000b001','dddddddd-0000-0000-0000-00000000a001'),
  ('dddddddd-0000-0000-0000-00000000b002','dddddddd-0000-0000-0000-00000000a001'),
  ('dddddddd-0000-0000-0000-00000000b003','dddddddd-0000-0000-0000-00000000a001'),
  ('dddddddd-0000-0000-0000-00000000b004','dddddddd-0000-0000-0000-00000000a001');
-- Evidence: 2 activities for Repeat Place on non-consecutive days → the visit
-- rebuild derives 2 visits → 2 completed stops (repeat visits). Each is 1 mile.
-- Plus an UNRELATED place's activity in the same date range that must NOT count
-- toward the trip (proves stats aren't arbitrary date-range household activity).
insert into public.activities (id, place_id, type, lat, lng, distance, start_date) values
  ('ffffffff-0000-0000-0000-00000000f001','dddddddd-0000-0000-0000-00000000b001','Hike',1,1,1609.344,'2026-04-02T10:00:00Z'),
  ('ffffffff-0000-0000-0000-00000000f003','dddddddd-0000-0000-0000-00000000b001','Hike',1,1,1609.344,'2026-04-05T10:00:00Z'),
  ('ffffffff-0000-0000-0000-00000000f002','dddddddd-0000-0000-0000-00000000b005','Hike',9,9,5000,'2026-04-03T10:00:00Z');

-- Run the real backfill.
select public.migrate_container_place_trips();

do $$
declare v_trip uuid; n int; r json;
begin
  -- Only the clean trip migrated; undated + suggested are quarantined, not migrated.
  if (select count(*) from public.trips where source_place_id is not null) <> 1 then
    raise exception 'FAIL: expected exactly 1 migrated trip';
  end if;
  select id into v_trip from public.trips where source_place_id='dddddddd-0000-0000-0000-00000000a001';

  -- Quarantine: 2 trip-level (undated, suggested) + 2 member-level (deleted, unsaved).
  if (select count(*) from public.trip_migration_exceptions) <> 4 then
    raise exception 'FAIL: expected 4 quarantined records, got %',
      (select count(*) from public.trip_migration_exceptions);
  end if;

  -- Repeat visits → 2 completed stops for the same place (different visits).
  select count(*) into n from public.trip_stops
    where trip_id=v_trip and place_id='dddddddd-0000-0000-0000-00000000b001' and status='completed';
  if n <> 2 then raise exception 'FAIL: repeat visits should give 2 completed stops, got %', n; end if;

  -- No-visit member → exactly one planned stop (not guessed complete).
  select count(*) into n from public.trip_stops
    where trip_id=v_trip and place_id='dddddddd-0000-0000-0000-00000000b002' and status='planned';
  if n <> 1 then raise exception 'FAIL: no-visit member should be 1 planned stop, got %', n; end if;

  -- Deleted + unsaved members got NO stops.
  if (select count(*) from public.trip_stops where place_id in
      ('dddddddd-0000-0000-0000-00000000b003','dddddddd-0000-0000-0000-00000000b004')) <> 0 then
    raise exception 'FAIL: deleted/unsaved members must not become stops';
  end if;

  -- REAL RPC trip_place_ids: explicit membership, draft-private → {Repeat, No-Visit} = 2.
  select count(*) into n from public.trip_place_ids(v_trip);
  if n <> 2 then raise exception 'FAIL: trip_place_ids expected 2, got %', n; end if;

  -- REAL RPC trip_stats: from linked COMPLETED data only.
  select public.trip_stats(v_trip) into r;
  if (r->>'places')::int <> 1 then raise exception 'FAIL: stats.places expected 1 (completed), got %', r->>'places'; end if;
  if (r->>'visits')::int <> 2 then raise exception 'FAIL: stats.visits expected 2, got %', r->>'visits'; end if;
  -- Miles = the Repeat Place's 2 activities (2 miles). The unrelated place's
  -- activity in the same date range must NOT count.
  if (r->>'miles')::int <> 2 then raise exception 'FAIL: stats.miles expected 2 (linked only), got %', r->>'miles'; end if;

  -- completed status REQUIRES a visit (check constraint, not unique).
  begin
    insert into public.trip_stops (trip_id, place_id, status) values
      (v_trip, 'dddddddd-0000-0000-0000-00000000b002', 'completed');
    raise exception 'FAIL: completed stop without a visit was allowed';
  exception when check_violation then null; end;

  -- invalid status rejected by CHECK.
  begin
    insert into public.trip_stops (trip_id, place_id, status) values
      (v_trip, 'dddddddd-0000-0000-0000-00000000b002', 'bogus');
    raise exception 'FAIL: invalid status allowed';
  exception when check_violation then null; end;

  -- Draft-privacy: a stop for an unsaved place is excluded from trip_place_ids.
  insert into public.trip_stops (trip_id, place_id, status) values
    (v_trip, 'dddddddd-0000-0000-0000-00000000b003', 'planned');
  select count(*) into n from public.trip_place_ids(v_trip);
  if n <> 2 then raise exception 'FAIL: draft-private read leaked an unsaved place (%).', n; end if;

  -- Idempotency: re-running the backfill creates nothing new.
  n := (select count(*) from public.trip_stops);
  perform public.migrate_container_place_trips();
  if (select count(*) from public.trip_stops) <> n then
    raise exception 'FAIL: backfill not idempotent';
  end if;
end $$;

do $$ begin raise notice 'PASS: 0099 Visit-linked trip_stops + careful migration tests'; end $$;

rollback;
