-- DB test for migration 0103 (trip_notes/trip_timeline re-pointed to trips.id).
-- LOCAL disposable stack only. Exercises the REAL trip_timeline + add_trip_note RPCs.

begin;

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-0000000000d1', 'tluser@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('cccccccc-0000-0000-0000-0000000000d1', 'owner', 'TL Owner');
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-0000000000d1"}';

-- A leaf place (saved, not suggested) with one activity + one entry.
insert into public.places (id,name,lat,lng,category,holds_children,saved,suggested,deleted_at) values
  ('dddddddd-0000-0000-0000-0000000000d1','Timeline Place',1,1,'beach',false,true,false,null);
insert into public.activities (id,place_id,type,lat,lng,distance,start_date) values
  ('ffffffff-0000-0000-0000-0000000000d1','dddddddd-0000-0000-0000-0000000000d1','Hike',1,1,1609.344,'2026-05-10T10:00:00Z');
insert into public.entries (id,place_id,kind,title,date) values
  ('eeeeeeee-0000-0000-0000-0000000000d1','dddddddd-0000-0000-0000-0000000000d1','dining','Dinner','2026-05-11');

-- A canonical trip with a stop on that place.
insert into public.trips (id,name,start_date,end_date,status) values
  ('11111111-0000-0000-0000-0000000000d1','TL Trip','2026-05-01','2026-05-31','taken');
insert into public.trip_stops (trip_id,place_id,status) values
  ('11111111-0000-0000-0000-0000000000d1','dddddddd-0000-0000-0000-0000000000d1','planned');

do $$
declare n int; v_note uuid;
begin
  -- FK now references trips, not places.
  if (select confrelid::regclass::text from pg_constraint where conname = 'trip_notes_trip_id_fkey')
     <> 'trips' then
    raise exception 'FAIL: trip_notes FK does not reference trips';
  end if;

  -- trip_timeline resolves the trip's stopped place: 1 activity + 1 spot = 2 rows.
  select count(*) into n from public.trip_timeline('11111111-0000-0000-0000-0000000000d1');
  if n <> 2 then raise exception 'FAIL: trip_timeline expected 2 rows, got %', n; end if;

  -- add_trip_note stores against the trips id.
  v_note := public.add_trip_note('11111111-0000-0000-0000-0000000000d1', '2026-05-10', 'plan');
  if not exists (select 1 from public.trip_notes
                 where id = v_note and trip_id = '11111111-0000-0000-0000-0000000000d1') then
    raise exception 'FAIL: add_trip_note did not store against the trips id';
  end if;

  -- A non-trip id is rejected by the new FK.
  begin
    insert into public.trip_notes (trip_id, day, note)
      values ('11111111-0000-0000-0000-0000000000ff', '2026-05-10', 'x');
    raise exception 'FAIL: trip_notes accepted a non-trip id';
  exception when foreign_key_violation then null;
  end;
end $$;

-- Draft privacy: a non-member session sees an empty timeline.
set local request.jwt.claims = '{"sub":"99999999-0000-0000-0000-000000000000"}';
do $$
declare n int;
begin
  select count(*) into n from public.trip_timeline('11111111-0000-0000-0000-0000000000d1');
  if n <> 0 then raise exception 'FAIL: non-member saw % timeline rows', n; end if;
end $$;

do $$ begin raise notice 'PASS: trip_notes/timeline re-pointed to trips.id'; end $$;

rollback;
