-- DB test for 0132 — the Trips stat counts real trips, per view.
begin;

insert into auth.users (id,email) values
  ('eeee5555-0000-0000-0000-00000000a001','v132-erica@example.test'),
  ('eeee5555-0000-0000-0000-00000000a002','v132-josh@example.test') on conflict do nothing;
insert into public.profiles (id,role,display_name) values
  ('eeee5555-0000-0000-0000-00000000a001','owner','V132 Erica'),
  ('eeee5555-0000-0000-0000-00000000a002','editor','Josh') on conflict do nothing;
set local request.jwt.claims = '{"sub":"eeee5555-0000-0000-0000-00000000a001"}';

-- 1) A destination reclassified by 0127 must NOT be what the Trips number counts.
--    This is the exact regression: the place is a region, the trip is a trip row.
do $$
declare p uuid; t uuid; before_trips int; after_trips int;
begin
  select trips_count into before_trips from public.wander_stats(null);

  insert into public.places (name, lat, lng, saved, categories)
    values ('V132 Cape Cod', 41.7, -70.0, true, array['region']) returning id into p;
  insert into public.trips (name, start_date, end_date, status)
    values ('V132 Cape Cod trip', '2026-08-02', '2026-08-07', 'taken') returning id into t;
  insert into public.visits (place_id, start_date, end_date, solo_profile, manual)
    values (p, '2026-08-02', '2026-08-07', null, true);
  insert into public.trip_stops (trip_id, place_id, status) values (t, p, 'planned');

  select trips_count into after_trips from public.wander_stats(null);
  if after_trips <> before_trips + 1 then
    raise exception 'FAIL: adding one real trip changed Trips by % (expected 1)', after_trips - before_trips;
  end if;
  raise notice 'PASS 1: a real trip row increments the Trips stat';
end $$;

-- 2) NEGATIVE CONTROL for the old behaviour. A place carrying the retired
--    category='trip' must NOT add to the count on its own — that is what made the
--    number read 1 instead of 8.
do $$
declare p uuid; before_trips int; after_trips int;
begin
  select trips_count into before_trips from public.wander_stats(null);
  insert into public.places (name, lat, lng, saved) values ('V132 Legacy Trip Place', 40.0, -75.0, true) returning id into p;
  update public.places set category = 'trip' where id = p;   -- bypass the trigger's derivation
  insert into public.visits (place_id, start_date, end_date, solo_profile, manual)
    values (p, '2026-09-01', '2026-09-02', null, true);
  select trips_count into after_trips from public.wander_stats(null);
  if after_trips <> before_trips then
    raise exception 'FAIL: a legacy trip-category PLACE still counts as a trip (% -> %)', before_trips, after_trips;
  end if;
  raise notice 'PASS 2: a place is never counted as a trip';
end $$;

-- 3) THE VIEW. A trip whose only visits are Josh's must not appear in Erica's view.
do $$
declare p uuid; t uuid; c_erica int; c_josh int; base_e int; base_j int;
begin
  select trips_count into base_e from public.wander_stats('eeee5555-0000-0000-0000-00000000a001');
  select trips_count into base_j from public.wander_stats('eeee5555-0000-0000-0000-00000000a002');

  insert into public.places (name, lat, lng, saved) values ('V132 Josh Only', 45.0, -93.0, true) returning id into p;
  insert into public.trips (name, start_date, end_date, status)
    values ('V132 Josh solo trip', '2026-10-01', '2026-10-03', 'taken') returning id into t;
  insert into public.visits (place_id, start_date, end_date, solo_profile, manual)
    values (p, '2026-10-01', '2026-10-03', 'eeee5555-0000-0000-0000-00000000a002', true);
  insert into public.trip_stops (trip_id, place_id, status) values (t, p, 'planned');

  select trips_count into c_erica from public.wander_stats('eeee5555-0000-0000-0000-00000000a001');
  select trips_count into c_josh  from public.wander_stats('eeee5555-0000-0000-0000-00000000a002');

  if c_erica <> base_e then raise exception 'FAIL: Josh-only trip appeared in Erica''s view'; end if;
  if c_josh  <> base_j + 1 then raise exception 'FAIL: Josh''s own trip missing from his view'; end if;
  raise notice 'PASS 3: trips respect Just me / Just Josh / Both';
end $$;

-- 4) Still members-only.
do $$
declare ok boolean := false;
begin
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000fe"}';
  begin perform * from public.wander_stats(null); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a non-member read wander_stats'; end if;
  raise notice 'PASS 4: non-member denied';
end $$;

do $$ begin raise notice 'PASS: 0132 trips come from the trips table'; end $$;
rollback;
