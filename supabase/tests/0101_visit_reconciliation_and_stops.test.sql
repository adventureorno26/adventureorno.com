-- DB test for 0101 (stable Visit reconciliation + trip_stop semantics).
-- LOCAL disposable stack only. Fictional data, rolled back. Negative assertions use
-- an ok-flag set INSIDE the handler and raised OUTSIDE it, so a FAIL can never be
-- swallowed by the same handler.

begin;

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-00000000d001','owner@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('cccccccc-0000-0000-0000-00000000d001','owner','Owner');
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000d001"}';

-- A trip (first-class) + a member place with a PLANNED stop (no evidence yet).
insert into public.places (id,name,lat,lng,category,holds_children,saved,first_visit,last_visit) values
  ('dddddddd-0000-0000-0000-00000000d001','Trip Container',1,1,'trip',true,true,'2026-05-01','2026-05-31'),
  ('dddddddd-0000-0000-0000-00000000d002','Stop Place',1,1,'beach',false,true,null,null),
  ('dddddddd-0000-0000-0000-00000000d003','Other Place',5,5,'dining',false,true,null,null);
insert into public.trips (id,name,start_date,end_date,status,source_place_id) values
  ('11111111-0000-0000-0000-00000000d001','Trip','2026-05-01','2026-05-31','taken','dddddddd-0000-0000-0000-00000000d001');
insert into public.trip_stops (trip_id,place_id,status) values
  ('11111111-0000-0000-0000-00000000d001','dddddddd-0000-0000-0000-00000000d002','planned');

do $$
declare vid uuid; vid2 uuid; ok boolean;
begin
  -- Item 4: an activity in range creates a visit → the planned stop is PROMOTED.
  insert into public.activities (id,place_id,type,lat,lng,distance,start_date) values
    ('ffffffff-0000-0000-0000-00000000d001','dddddddd-0000-0000-0000-00000000d002','Hike',1,1,1000,'2026-05-10T10:00:00Z');
  if (select count(*) from public.trip_stops where place_id='dddddddd-0000-0000-0000-00000000d002' and status='completed') <> 1 then
    raise exception 'FAIL(item4): planned stop not promoted to completed';
  end if;
  if (select count(*) from public.trip_stops where place_id='dddddddd-0000-0000-0000-00000000d002') <> 1 then
    raise exception 'FAIL(item4): duplicate stop row left after promotion';
  end if;
  select visit_id into vid from public.trip_stops where place_id='dddddddd-0000-0000-0000-00000000d002';

  -- Item 9: a second activity same day keeps the SAME visit id + the stop's link.
  insert into public.activities (id,place_id,type,lat,lng,distance,start_date) values
    ('ffffffff-0000-0000-0000-00000000d002','dddddddd-0000-0000-0000-00000000d002','Hike',1,1,2000,'2026-05-10T15:00:00Z');
  select visit_id into vid2 from public.trip_stops where place_id='dddddddd-0000-0000-0000-00000000d002';
  if vid2 <> vid then raise exception 'FAIL(item9): completed stop visit id changed after new evidence'; end if;

  -- Item 3: a completed stop's visit must be SAME place. Point the stop at a visit of
  -- Other Place → rejected.
  insert into public.activities (id,place_id,type,lat,lng,distance,start_date) values
    ('ffffffff-0000-0000-0000-00000000d003','dddddddd-0000-0000-0000-00000000d003','Hike',5,5,1000,'2026-05-11T10:00:00Z');
  ok := false;
  begin
    update public.trip_stops set visit_id = (select id from public.visits where place_id='dddddddd-0000-0000-0000-00000000d003' limit 1)
      where place_id='dddddddd-0000-0000-0000-00000000d002';
  exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL(item3): cross-place visit was accepted'; end if;

  -- Item 3: a completed stop's visit must overlap the trip range. Add an out-of-range
  -- visit for the stop place and try to link it → rejected.
  insert into public.activities (id,place_id,type,lat,lng,distance,start_date) values
    ('ffffffff-0000-0000-0000-00000000d004','dddddddd-0000-0000-0000-00000000d002','Hike',1,1,1000,'2027-01-01T10:00:00Z');
  ok := false;
  begin
    update public.trip_stops set visit_id = (select id from public.visits where place_id='dddddddd-0000-0000-0000-00000000d002' and start_date='2027-01-01')
      where place_id='dddddddd-0000-0000-0000-00000000d002' and visit_id = vid;
  exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL(item3): out-of-range visit was accepted'; end if;

  -- Item 2: deleting the linked visit DEMOTES the stop to planned (no abort, no
  -- constraint violation).
  delete from public.visits where id = vid;
  if (select status from public.trip_stops where place_id='dddddddd-0000-0000-0000-00000000d002') <> 'planned' then
    raise exception 'FAIL(item2): stop not demoted to planned after visit delete';
  end if;
  if (select visit_id from public.trip_stops where place_id='dddddddd-0000-0000-0000-00000000d002') is not null then
    raise exception 'FAIL(item2): demoted stop still references a visit';
  end if;

  raise notice 'PASS: 0101 reconciliation + trip_stop semantics';
end $$;

rollback;
