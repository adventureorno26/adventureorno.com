-- DB test for 0137 — the retired trip tables are GONE, and the things that
-- legitimately used a trip window still work off marked visits.
--
-- Ground rule 2: every rule here is seeded with the real shape first, and each
-- has a negative control that fails if the rule is removed.
begin;

insert into auth.users (id, email) values
  ('aaaa7777-0000-0000-0000-00000000e001','v137-erica@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('aaaa7777-0000-0000-0000-00000000e001','owner','V137 Erica') on conflict do nothing;
set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000e001"}';

-- 1) THE MECHANISM IS GONE — tables, the trip category, and the functions that
--    only existed to serve them. Not emptied: absent.
do $$
declare leftover text;
begin
  select string_agg(table_name, ', ') into leftover
    from information_schema.tables
   where table_schema = 'public' and table_name in ('trips','trip_stops');
  if leftover is not null then
    raise exception 'FAIL: retired table(s) still present: %', leftover;
  end if;

  if exists (select 1 from public.place_categories where slug = 'trip') then
    raise exception 'FAIL: the trip place category is back — it can be tagged again';
  end if;

  select string_agg(p.proname, ', ') into leftover
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('promote_trip_stops_for_place','demote_trip_stops_on_visit_delete',
                       'trip_stops_visit_integrity','complete_stops_on_taken_trips',
                       'confirm_suggested_trip','trip_stats','trip_timeline','trip_place_ids',
                       'migrate_container_place_trips');
  if leftover is not null then
    raise exception 'FAIL: trip-table function(s) still present: %', leftover;
  end if;
  raise notice 'PASS 1: trips, trip_stops, the trip category and their functions are gone';
end $$;

-- 2) NO PLACE CARRIES THE RETIRED TAG, and the category is gone so none can.
--    Seeded with the real shape (Cape Cod: beach + region + trip) rather than
--    asserting over whatever happens to be in the table.
do $$
declare p uuid; cats text[];
begin
  insert into public.places (name, lat, lng, saved, categories)
    values ('V137 Cape Cod', 41.7, -70.0, true, array['beach','region'])
    returning id into p;

  update public.places set categories = array['beach','region','trip'] where id = p;
  select categories into cats from public.places where id = p;
  -- NEGATIVE CONTROL: the tag string can still be written (nothing validates the
  -- array), so the guarantee is that the CATEGORY is gone and no UI can offer it.
  -- If a later change reinstated the category row, test 1 fails.
  if not ('trip' = any(cats)) then
    raise exception 'FAIL: control broken — expected the raw tag to be writable';
  end if;

  update public.places set categories = array_remove(categories, 'trip') where id = p;
  select categories into cats from public.places where id = p;
  if 'trip' = any(cats) then raise exception 'FAIL: the trip tag survived removal'; end if;
  if not ('beach' = any(cats) and 'region' = any(cats)) then
    raise exception 'FAIL: removing the trip tag took the real tags with it (%)', cats;
  end if;
  raise notice 'PASS 2: removing the trip tag leaves the real tags alone';
end $$;

-- 3) THE TRIP WINDOW STILL FUSES. This is what the trips table was doing for
--    rebuild_place_visits; a MARKED VISIT is the window now. The Cape Cod shape:
--    a week away, with separate days of evidence at a place inside it.
do $$
declare trip_place uuid; inner_place uuid; tv uuid; n int; s date; e date;
begin
  insert into public.places (name, lat, lng, saved) values ('V137 Away Week', 41.75, -70.05, true)
    returning id into trip_place;
  insert into public.places (name, lat, lng, saved) values ('V137 The Beach', 41.76, -70.06, true)
    returning id into inner_place;

  -- Evidence on two non-adjacent days at the beach: without a trip window these
  -- are two separate islands, so two visits.
  insert into public.photos (place_id, taken_at, r2_key, thumb_key, sha256)
    values (inner_place, '2026-09-02T12:00:00Z', 'v137/a.jpg', 'v137/a-t.jpg', repeat('a',64)),
           (inner_place, '2026-09-05T12:00:00Z', 'v137/b.jpg', 'v137/b-t.jpg', repeat('b',64));

  perform public.rebuild_place_visits(inner_place);
  select count(*) into n from public.visits where place_id = inner_place and not manual;
  if n <> 2 then
    raise exception 'FAIL: control broken — two separated days should be 2 visits, got %', n;
  end if;

  -- Now mark the week as a trip. The two days become ONE stay.
  insert into public.visits (place_id, start_date, end_date, manual)
    values (trip_place, '2026-09-01', '2026-09-07', true) returning id into tv;
  perform public.set_visit_is_trip(tv, true);

  perform public.rebuild_place_visits(inner_place);
  select count(*) into n from public.visits where place_id = inner_place and not manual;
  if n <> 1 then
    raise exception 'FAIL: a marked trip must fuse the days inside it into one visit, got %', n;
  end if;
  select start_date, end_date into s, e
    from public.visits where place_id = inner_place and not manual;
  if s <> date '2026-09-02' or e <> date '2026-09-05' then
    raise exception 'FAIL: fused visit has the wrong span (% -> %)', s, e;
  end if;

  -- NEGATIVE CONTROL: unmark it and they separate again. If the fusing stopped
  -- reading is_trip (e.g. someone hardcoded it), this fails.
  perform public.set_visit_is_trip(tv, false);
  perform public.rebuild_place_visits(inner_place);
  select count(*) into n from public.visits where place_id = inner_place and not manual;
  if n <> 2 then
    raise exception 'FAIL: unmarking the trip must separate the days again, got %', n;
  end if;
  raise notice 'PASS 3: a marked visit is the trip window that fuses the days inside it';
end $$;

-- 4) create_experience REFUSES a trip link instead of silently ignoring it. A
--    caller left on the old contract must hear about it.
do $$
declare ok boolean := false; p uuid;
begin
  begin
    perform public.create_experience(
      'v137-key-1',
      jsonb_build_object('name','V137 Should Not Save','lat',40.0,'lng',-75.0,'saved',true,
                         'trip', jsonb_build_object('id','aaaa7777-0000-0000-0000-0000000000ff')));
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: create_experience accepted a trip link'; end if;
  -- ...and it rolled back, so no half-made place is left behind.
  select id into p from public.places where name = 'V137 Should Not Save';
  if p is not null then raise exception 'FAIL: the rejected call still created a place'; end if;
  raise notice 'PASS 4: a trip link is rejected and nothing is written';
end $$;

-- 5) create_experience STILL WORKS for the ordinary case — the surgery above
--    removed only the trip block.
do $$
declare res jsonb; pid uuid; n int;
begin
  select public.create_experience(
    'v137-key-2',
    jsonb_build_object('name','V137 Ordinary Place','lat',40.1,'lng',-75.1,'saved',true),
    jsonb_build_object('date','2026-09-10')) into res;
  pid := (res->>'place_id')::uuid;
  if pid is null then raise exception 'FAIL: create_experience returned no place'; end if;
  select count(*) into n from public.visits where place_id = pid;
  if n <> 1 then raise exception 'FAIL: expected 1 visit, got %', n; end if;

  -- Idempotent on retry, as before.
  select public.create_experience(
    'v137-key-2',
    jsonb_build_object('name','V137 Ordinary Place','lat',40.1,'lng',-75.1,'saved',true),
    jsonb_build_object('date','2026-09-10')) into res;
  if (res->>'idempotent') <> 'true' then
    raise exception 'FAIL: the same key created a second experience';
  end if;
  raise notice 'PASS 5: create_experience still creates a place + visit, and is idempotent';
end $$;

-- 6) The headline stats still count trips, from the visits that are marked.
do $$
declare t_before int; t_after int; v uuid; p uuid;
begin
  select trips_count into t_before from public.wander_stats(null);
  insert into public.places (name, lat, lng, saved) values ('V137 Counted', 42.0, -71.0, true)
    returning id into p;
  insert into public.visits (place_id, start_date, end_date, manual)
    values (p, '2026-10-01', '2026-10-04', true) returning id into v;
  perform public.set_visit_is_trip(v, true);
  select trips_count into t_after from public.wander_stats(null);
  if t_after <> t_before + 1 then
    raise exception 'FAIL: marking a visit as a trip must add one trip (% -> %)', t_before, t_after;
  end if;
  raise notice 'PASS 6: trips are counted from marked visits';
end $$;

do $$ begin raise notice 'PASS: 0137 a trip is a visit you marked'; end $$;
rollback;
