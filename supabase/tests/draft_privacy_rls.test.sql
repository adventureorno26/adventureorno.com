-- Draft-privacy RLS test (items 6, 8, 10). LOCAL disposable stack only.
-- Runs SELECTs under SET ROLE authenticated with fictional owner vs viewer JWTs, so
-- it exercises the REAL grants + RLS policies (not superuser, which bypasses RLS).

begin;

-- Fictional identities (as superuser).
insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-0000000000a1','owner@example.test'),
  ('cccccccc-0000-0000-0000-0000000000a2','viewer@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('cccccccc-0000-0000-0000-0000000000a1','owner','Owner'),
  ('cccccccc-0000-0000-0000-0000000000a2','viewer','Viewer');

-- A SAVED source place (normal trip) and an UNSAVED source place (draft trip).
insert into public.places (id,name,lat,lng,category,holds_children,saved,first_visit,last_visit) values
  ('dddddddd-0000-0000-0000-0000000000a1','Saved Trip Src',1,1,'trip',true,true, '2026-06-01','2026-06-10'),
  ('dddddddd-0000-0000-0000-0000000000a2','Draft Trip Src',1,1,'trip',true,false,'2026-06-01','2026-06-10'),
  ('dddddddd-0000-0000-0000-0000000000a3','Saved Stop',2,2,'beach', false,true, null,null),
  ('dddddddd-0000-0000-0000-0000000000a4','Unsaved Stop',2,2,'beach',false,false,null,null);
insert into public.trips (id,name,start_date,end_date,status,source_place_id) values
  ('11111111-0000-0000-0000-0000000000a1','Normal','2026-06-01','2026-06-10','taken','dddddddd-0000-0000-0000-0000000000a1'),
  ('11111111-0000-0000-0000-0000000000a2','DraftT','2026-06-01','2026-06-10','taken','dddddddd-0000-0000-0000-0000000000a2');
insert into public.trip_stops (trip_id,place_id,status) values
  ('11111111-0000-0000-0000-0000000000a1','dddddddd-0000-0000-0000-0000000000a3','planned'),
  ('11111111-0000-0000-0000-0000000000a1','dddddddd-0000-0000-0000-0000000000a4','planned');

-- OWNER sees both trips + both stops.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-0000000000a1"}';
do $$
begin
  if (select count(*) from public.trips) <> 2 then
    raise exception 'FAIL: owner cannot see all trips (got %) — check grants/RLS', (select count(*) from public.trips);
  end if;
  if (select count(*) from public.trip_stops) <> 2 then
    raise exception 'FAIL: owner cannot see all trip_stops (got %)', (select count(*) from public.trip_stops);
  end if;
end $$;
reset role;

-- VIEWER sees only the non-draft trip + only the saved-place stop.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-0000000000a2"}';
do $$
begin
  if (select count(*) from public.trips) <> 1 then
    raise exception 'FAIL(item6): viewer saw a draft trip (count=%)', (select count(*) from public.trips);
  end if;
  if exists (select 1 from public.trips where source_place_id='dddddddd-0000-0000-0000-0000000000a2') then
    raise exception 'FAIL(item6): viewer can read the draft trip';
  end if;
  if (select count(*) from public.trip_stops) <> 1 then
    raise exception 'FAIL(item6): viewer saw an unsaved-place stop (count=%)', (select count(*) from public.trip_stops);
  end if;
  if exists (select 1 from public.trip_stops where place_id='dddddddd-0000-0000-0000-0000000000a4') then
    raise exception 'FAIL(item6): viewer can read the unsaved-place stop identifier';
  end if;
end $$;
reset role;

do $$ begin raise notice 'PASS: draft-privacy RLS (owner vs viewer)'; end $$;

rollback;
