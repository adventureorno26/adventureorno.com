-- DB test for 0128 — a stop on a trip you already took is completed.
-- Reproduces the live Annabelle's shape: a stop whose place has NO evidence.
begin;

insert into auth.users (id,email) values ('aaaa1111-0000-0000-0000-00000000e001','v128@example.test') on conflict do nothing;
insert into public.profiles (id,role,display_name) values ('aaaa1111-0000-0000-0000-00000000e001','owner','V128 Owner') on conflict do nothing;
set local request.jwt.claims = '{"sub":"aaaa1111-0000-0000-0000-00000000e001"}';

-- 1) A stop with no evidence on a TAKEN trip gets a visit and completes.
do $$
declare stay uuid; t uuid; st text; vid uuid; n int; man boolean;
begin
  insert into public.places (name, lat, lng, saved, categories)
    values ('V128 Annabelle''s', 13.181, -59.641, true, array['stay']) returning id into stay;
  insert into public.trips (name, start_date, end_date, status)
    values ('V128 Barbados','2026-04-16','2026-04-20','taken') returning id into t;
  insert into public.trip_stops (trip_id, place_id, status) values (t, stay, 'planned');

  if (select count(*) from public.visits where place_id = stay) <> 0 then
    raise exception 'FAIL: setup wrong — the stay should start with no visits'; end if;

  perform public.complete_stops_on_taken_trips();

  select status, visit_id into st, vid from public.trip_stops where trip_id=t and place_id=stay;
  if st <> 'completed' then raise exception 'FAIL: stop is % not completed', st; end if;
  if vid is null then raise exception 'FAIL: completed stop has no visit'; end if;

  select count(*) into n from public.visits where place_id = stay;
  if n <> 1 then raise exception 'FAIL: expected 1 visit, got %', n; end if;
  select start_date = '2026-04-16' and end_date = '2026-04-20', manual into st, man
    from public.visits where id = vid;
  if not man then raise exception 'FAIL: the visit must be manual or rebuild will delete it'; end if;
  raise notice 'PASS 1: a no-evidence stop on a taken trip is completed with a real visit';
end $$;

-- 2) THE POINT OF manual=true — a rebuild finds no days for this place and would
--    otherwise wipe the visit.
do $$
declare stay uuid; n int;
begin
  select id into stay from public.places where name = 'V128 Annabelle''s';
  perform public.rebuild_place_visits(stay);
  select count(*) into n from public.visits where place_id = stay;
  if n <> 1 then raise exception 'FAIL: the visit did not survive a rebuild (got %)', n; end if;
  if (select status from public.trip_stops s join public.places p on p.id=s.place_id
       where p.id = stay) <> 'completed' then
    raise exception 'FAIL: the stop reverted after rebuild'; end if;
  raise notice 'PASS 2: it survives rebuild_place_visits';
end $$;

-- 3) An UPCOMING trip is a real plan — leave it alone.
do $$
declare p uuid; t uuid; st text;
begin
  insert into public.places (name, lat, lng, saved) values ('V128 Future Hotel', 10.0, 20.0, true) returning id into p;
  insert into public.trips (name, start_date, end_date, status)
    values ('V128 Next Year','2027-06-01','2027-06-05','upcoming') returning id into t;
  insert into public.trip_stops (trip_id, place_id, status) values (t, p, 'planned');

  perform public.complete_stops_on_taken_trips();

  select status into st from public.trip_stops where trip_id=t and place_id=p;
  if st <> 'planned' then raise exception 'FAIL: an upcoming trip stop was completed (%)', st; end if;
  if (select count(*) from public.visits where place_id=p) <> 0 then
    raise exception 'FAIL: a visit was invented for a trip that has not happened'; end if;
  raise notice 'PASS 3: upcoming trips keep their plans';
end $$;

-- 4) A stop whose place ALREADY has a visit in the window is left to the normal
--    promotion path — no duplicate visit is created.
do $$
declare p uuid; t uuid; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('V128 Has Evidence', 11.0, 21.0, true) returning id into p;
  insert into public.trips (name, start_date, end_date, status)
    values ('V128 Evidenced','2026-06-01','2026-06-03','taken') returning id into t;
  insert into public.visits (place_id, start_date, end_date, manual) values (p,'2026-06-02','2026-06-02', true);
  insert into public.trip_stops (trip_id, place_id, status) values (t, p, 'planned');

  perform public.complete_stops_on_taken_trips();
  select count(*) into n from public.visits where place_id = p;
  if n <> 1 then raise exception 'FAIL: duplicated a visit for a place that already had one (%)', n; end if;
  raise notice 'PASS 4: no duplicate visit when evidence already exists';
end $$;

do $$ begin raise notice 'PASS: 0128 stops on taken trips are completed'; end $$;
rollback;
