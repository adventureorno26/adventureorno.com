-- DB test: trip_stats must NOT double-count an Activity that falls inside two
-- overlapping Visits (item 7/10), and purging a Trip's source Place must SET NULL
-- the link and leave the Trip intact (item 5/10). LOCAL disposable stack only.
-- Exercises the REAL trip_stats RPC + the REAL source_place_id FK — no duplicated SQL.

begin;

-- Member session (owner) so is_member()/SECURITY DEFINER reads succeed.
insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-00000000e001','statsowner@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('cccccccc-0000-0000-0000-00000000e001','owner','Stats Owner');
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000e001"}';

-- A container source Place + a leaf Place with a real Activity.
insert into public.places (id,name,lat,lng,category,holds_children,saved,suggested,deleted_at,first_visit,last_visit) values
  ('dddddddd-0000-0000-0000-00000000e101','Src Container',1,1,'trip', true, true, false, null,'2026-05-01','2026-05-31'),
  ('dddddddd-0000-0000-0000-00000000e102','Overlap Place', 1,1,'beach',false,true, false, null,'2026-05-17','2026-05-17');

insert into public.trips (id,name,start_date,end_date,status,source_place_id) values
  ('11111111-0000-0000-0000-00000000e201','Overlap Trip','2026-05-01','2026-05-31','taken','dddddddd-0000-0000-0000-00000000e101');

-- ONE activity on 05-17, worth exactly 1 mile.
insert into public.activities (id, place_id, type, lat, lng, distance, start_date) values
  ('ffffffff-0000-0000-0000-00000000e301','dddddddd-0000-0000-0000-00000000e102','Hike',1,1,1609.344,'2026-05-17T10:00:00Z');

-- Two MANUAL visits on the same Place with OVERLAPPING ranges, both containing 05-17
-- and both overlapping the trip range (so the visit-integrity trigger accepts them).
insert into public.visits (id, place_id, start_date, end_date, manual) values
  ('aaaaaaaa-0000-0000-0000-00000000e401','dddddddd-0000-0000-0000-00000000e102','2026-05-10','2026-05-20', true),
  ('aaaaaaaa-0000-0000-0000-00000000e402','dddddddd-0000-0000-0000-00000000e102','2026-05-15','2026-05-25', true);

-- Two COMPLETED stops linking those two overlapping visits.
insert into public.trip_stops (trip_id, place_id, status, visit_id) values
  ('11111111-0000-0000-0000-00000000e201','dddddddd-0000-0000-0000-00000000e102','completed','aaaaaaaa-0000-0000-0000-00000000e401'),
  ('11111111-0000-0000-0000-00000000e201','dddddddd-0000-0000-0000-00000000e102','completed','aaaaaaaa-0000-0000-0000-00000000e402');

do $$
declare r json;
begin
  select public.trip_stats('11111111-0000-0000-0000-00000000e201') into r;
  -- The activity matches BOTH overlapping visits; a naive sum would report 2 miles.
  -- The `select distinct a.id` dedup must report it ONCE.
  if (r->>'miles')::int <> 1 then
    raise exception 'FAIL: overlapping-visit activity double-counted — miles=% (want 1)', r->>'miles';
  end if;
  -- Two completed stops on one place → visits=2, places=1.
  if (r->>'visits')::int <> 2 then raise exception 'FAIL: visits=% (want 2)', r->>'visits'; end if;
  if (r->>'places')::int <> 1 then raise exception 'FAIL: places=% (want 1)', r->>'places'; end if;
end $$;

-- Source-place purge: hard-deleting the source Place SET NULLs the link; the Trip lives.
delete from public.places where id='dddddddd-0000-0000-0000-00000000e101';
do $$
begin
  if not exists (select 1 from public.trips where id='11111111-0000-0000-0000-00000000e201') then
    raise exception 'FAIL: purging the source place deleted the trip (should survive)';
  end if;
  if (select source_place_id from public.trips where id='11111111-0000-0000-0000-00000000e201') is not null then
    raise exception 'FAIL: source_place_id not nulled after source place purge';
  end if;
end $$;

do $$ begin raise notice 'PASS: trip_stats overlap dedup + source-place purge SET NULL'; end $$;

rollback;
