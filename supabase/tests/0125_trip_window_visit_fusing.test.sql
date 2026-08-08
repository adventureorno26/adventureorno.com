-- DB test for 0125 — trip-window visit fusing + hand-edited visit dates.
-- LOCAL disposable stack only. Shapes are taken from the real production data.

begin;

insert into auth.users (id, email) values
  ('dddddddd-0000-0000-0000-00000000b001', 'v125-owner@example.test'),
  ('dddddddd-0000-0000-0000-00000000b002', 'v125-josh@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('dddddddd-0000-0000-0000-00000000b001', 'owner',  'V125 Owner'),
  ('dddddddd-0000-0000-0000-00000000b002', 'editor', 'Josh') on conflict do nothing;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-00000000b001"}';

-- 1) THE CAPE COD CASE. Photos on Aug 2,3,5,6,7 with a blank Aug 4 previously
--    produced TWO visits. Inside a trip window it must become ONE.
do $$
declare p uuid; t uuid; n int; s date; e date;
begin
  insert into public.places (name, lat, lng, saved) values ('V125 Cape Cod', 41.7, -70.0, true) returning id into p;
  insert into public.trips (name, start_date, end_date) values ('V125 Cape Cod trip', '2026-08-02', '2026-08-07') returning id into t;
  insert into public.photos (place_id, lat, lng, taken_at, r2_key, thumb_key, sha256) values
    (p,41.7,-70.0,'2026-08-02T12:00:00Z','k1','t1','h1'),
    (p,41.7,-70.0,'2026-08-03T12:00:00Z','k2','t2','h2'),
    (p,41.7,-70.0,'2026-08-05T12:00:00Z','k3','t3','h3'),
    (p,41.7,-70.0,'2026-08-06T12:00:00Z','k4','t4','h4'),
    (p,41.7,-70.0,'2026-08-07T12:00:00Z','k5','t5','h5');

  perform public.rebuild_place_visits(p);
  select count(*) into n from public.visits where place_id = p;
  if n <> 1 then raise exception 'FAIL: expected ONE fused visit, got %', n; end if;
  select start_date, end_date into s, e from public.visits where place_id = p;
  if s <> '2026-08-02' or e <> '2026-08-07' then
    raise exception 'FAIL: fused span is %..%, expected 2026-08-02..2026-08-07', s, e; end if;
  raise notice 'PASS 1: the Aug 4 gap no longer splits the stay';
end $$;

-- 2) RETURNING is a SECOND visit on the SAME place — "count the place once, count
--    the visits every time".
do $$
declare p uuid; n int;
begin
  select id into p from public.places where name = 'V125 Cape Cod';
  insert into public.trips (name, start_date, end_date) values ('V125 Cape Cod trip 2', '2027-07-10', '2027-07-14');
  insert into public.photos (place_id, lat, lng, taken_at, r2_key, thumb_key, sha256) values
    (p,41.7,-70.0,'2027-07-11T12:00:00Z','k6','t6','h6'),
    (p,41.7,-70.0,'2027-07-13T12:00:00Z','k7','t7','h7');
  perform public.rebuild_place_visits(p);
  select count(*) into n from public.visits where place_id = p;
  if n <> 2 then raise exception 'FAIL: a return trip should be a 2nd visit, got % visits', n; end if;
  if (select count(*) from public.places where name = 'V125 Cape Cod') <> 1 then
    raise exception 'FAIL: the place must still be counted once'; end if;
  raise notice 'PASS 2: return trip = 2nd visit, still ONE place';
end $$;

-- 3) LOCAL REPEATS MUST NOT FUSE. This is the regression that a blanket <=2-day
--    rule would have caused: Potomac Station 39 -> 27. Runs 2 days apart, in no
--    trip window, stay separate.
do $$
declare p uuid; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('V125 Local Run', 39.11, -77.55, true) returning id into p;
  insert into public.entries (place_id, kind, title, date) values
    (p,'note','run a','2026-09-01'), (p,'note','run b','2026-09-03'), (p,'note','run c','2026-09-05');
  perform public.rebuild_place_visits(p);
  select count(*) into n from public.visits where place_id = p;
  if n <> 3 then raise exception 'FAIL: local repeats fused — expected 3 visits, got %', n; end if;
  raise notice 'PASS 3: local repeat visits stay separate (no blanket gap rule)';
end $$;

-- 4) THE 637-DAY GUARD. The live "Elizabeth Furnace" trip spans 2024-08-11 ->
--    2026-05-10 over 7 unrelated single-day visits. An untrusted window must NOT
--    fuse them, or 21 months of history collapses into one visit.
do $$
declare p uuid; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('V125 Campground', 38.9, -78.3, true) returning id into p;
  insert into public.trips (name, start_date, end_date) values ('V125 Bogus 637-day trip', '2024-08-11', '2026-05-10');
  insert into public.entries (place_id, kind, title, date) values
    (p,'note','a','2024-08-11'), (p,'note','b','2024-08-25'), (p,'note','c','2024-09-01'),
    (p,'note','d','2025-01-26'), (p,'note','e','2025-02-02'), (p,'note','f','2025-04-06'),
    (p,'note','g','2026-05-09');
  perform public.rebuild_place_visits(p);
  select count(*) into n from public.visits where place_id = p;
  if n <> 7 then
    raise exception 'FAIL: an absurd trip window fused % separate visits into %', 7, n; end if;
  raise notice 'PASS 4: a 637-day trip window is ignored, all 7 visits survive';
end $$;

-- 5) set_visit_dates STICKS. Every live visit is manual=false and rebuild deletes
--    non-manual visits, so an edit that does not set manual would be wiped.
do $$
declare p uuid; v uuid; s date; e date; m boolean; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('V125 Editable', 30.0, -80.0, true) returning id into p;
  insert into public.entries (place_id, kind, title, date) values (p,'note','x','2026-10-05');
  perform public.rebuild_place_visits(p);
  select id into v from public.visits where place_id = p;

  perform public.set_visit_dates(v, '2026-10-03', '2026-10-08');
  select start_date, end_date, manual into s, e, m from public.visits where id = v;
  if s <> '2026-10-03' or e <> '2026-10-08' then raise exception 'FAIL: dates not applied (%..%)', s, e; end if;
  if not m then raise exception 'FAIL: edit did not set manual=true — a rebuild would wipe it'; end if;

  -- the whole point: it survives a rebuild
  perform public.rebuild_place_visits(p);
  select count(*) into n from public.visits where id = v and start_date='2026-10-03' and end_date='2026-10-08';
  if n <> 1 then raise exception 'FAIL: the hand-edited visit did not survive rebuild'; end if;
  raise notice 'PASS 5: stretched visit persists across a rebuild';
end $$;

-- 6) JOSH (editor) can edit too, and a nonsensical range is rejected.
do $$
declare p uuid; v uuid; ok boolean := false;
begin
  select id into p from public.places where name = 'V125 Editable';
  select id into v from public.visits where place_id = p limit 1;

  set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-00000000b002"}';
  perform public.set_visit_dates(v, '2026-10-02', '2026-10-09');
  if not exists (select 1 from public.visits where id=v and start_date='2026-10-02') then
    raise exception 'FAIL: editor (Josh) could not edit the visit'; end if;

  begin
    perform public.set_visit_dates(v, '2026-10-09', '2026-10-02');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: end-before-start was accepted'; end if;
  raise notice 'PASS 6: Josh can edit; inverted range rejected';
end $$;

-- 7) A viewer cannot edit.
do $$
declare v uuid; ok boolean := false;
begin
  insert into auth.users (id,email) values ('dddddddd-0000-0000-0000-00000000b003','v125-viewer@example.test') on conflict do nothing;
  insert into public.profiles (id,role,display_name) values ('dddddddd-0000-0000-0000-00000000b003','viewer','V125 Viewer') on conflict do nothing;
  select v2.id into v from public.visits v2 join public.places p on p.id=v2.place_id where p.name='V125 Editable' limit 1;
  set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-00000000b003"}';
  begin
    perform public.set_visit_dates(v, '2026-10-01', '2026-10-10');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: a viewer edited a visit'; end if;
  raise notice 'PASS 7: viewer denied';
end $$;

do $$ begin raise notice 'PASS: 0125 trip-window fusing + editable visit dates'; end $$;

rollback;
