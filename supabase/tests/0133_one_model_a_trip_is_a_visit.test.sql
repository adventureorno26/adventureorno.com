-- DB test for 0133 — one model. A place counts once, a visit counts every time,
-- and a trip is a visit a PERSON marked.
begin;

insert into auth.users (id,email) values
  ('ffff6666-0000-0000-0000-00000000b001','v133-erica@example.test'),
  ('ffff6666-0000-0000-0000-00000000b002','v133-josh@example.test') on conflict do nothing;
insert into public.profiles (id,role,display_name) values
  ('ffff6666-0000-0000-0000-00000000b001','owner','V133 Erica'),
  ('ffff6666-0000-0000-0000-00000000b002','editor','Josh') on conflict do nothing;
set local request.jwt.claims = '{"sub":"ffff6666-0000-0000-0000-00000000b001"}';

-- 1) THE REGENERATION BUG. This is the one that made every previous fix temporary:
--    0127 cleared the category, then sync_place_category re-derived 'trip' from
--    categories[] on the next update, and the destination silently stopped counting.
--    Cape Cod really did hold 10 photos and count as nothing.
do $$
declare p uuid; c text; counts boolean;
begin
  insert into public.places (name, lat, lng, saved, categories)
    values ('V133 Cape Cod', 41.7, -70.0, true, array['beach','region']) returning id into p;

  -- try to force the retired category back, exactly as the old trigger would have
  update public.places set categories = array_append(categories,'trip') where id = p;
  update public.places set rating = 4 where id = p;   -- any later write re-derived it

  select category, counts_as_place into c, counts from public.places where id = p;
  if c = 'trip' then raise exception 'FAIL: the trip category regenerated (%)', c; end if;
  if not counts then raise exception 'FAIL: a destination does not count as a place'; end if;
  raise notice 'PASS 1: the trip category cannot come back; the destination counts';
end $$;

-- 2) A trail is the ONLY thing that does not count — it is a sum of segments that
--    already counted.
do $$
declare t uuid; d uuid;
begin
  insert into public.places (name, lat, lng, saved, is_trail) values ('V133 Trail', 39.0, -77.6, true, true) returning id into t;
  insert into public.places (name, lat, lng, saved, categories) values ('V133 Region', 39.1, -77.7, true, array['region']) returning id into d;
  if (select counts_as_place from public.places where id = t) then raise exception 'FAIL: a trail must not count'; end if;
  if not (select counts_as_place from public.places where id = d) then raise exception 'FAIL: a region must count'; end if;
  raise notice 'PASS 2: only a trail is a rollup';
end $$;

-- 3) A TRIP IS A VISIT SHE MARKED. Counting once as a place, every time as a trip.
do $$
declare p uuid; v1 uuid; v2 uuid; base int; after_one int; after_two int; places_after int; places_base int;
begin
  select trips_count, places_count into base, places_base from public.wander_stats(null);

  insert into public.places (name, lat, lng, saved, categories)
    values ('V133 San Diego', 32.7, -117.1, true, array['city']) returning id into p;
  insert into public.visits (place_id, start_date, end_date, manual, solo_profile)
    values (p, '2026-03-01', '2026-03-06', true, null) returning id into v1;
  insert into public.visits (place_id, start_date, end_date, manual, solo_profile)
    values (p, '2026-09-01', '2026-09-05', true, null) returning id into v2;

  -- ⚠️ THIS RULE CHANGED, 2026-08-11 (migration 0159). It used to assert the
  -- opposite — that duration means NOTHING and only a person marking a visit makes
  -- it a trip. STATE.md §2, which Erica locked, says:
  --   "A VISIT for more than one day counts as a TRIP in the stats bar, but nothing
  --    needs to be labelled as a trip."
  -- So a multi-day visit counts on its own now. `is_trip` still counts too, because
  -- unmarking three visits she had marked BY HAND on a single day would be an
  -- automation undoing a human decision (0157). The rule is: more than one day, OR
  -- marked. Both of these span several days, so both count immediately.
  select trips_count into after_one from public.wander_stats(null);
  if after_one <> base + 2 then
    raise exception 'FAIL: two multi-day visits should count as two trips (% -> %)', base, after_one;
  end if;

  -- Marking them adds NOTHING — they already count. A visit is one occasion however
  -- it came to be a trip, and must never be counted twice.
  perform public.set_visit_is_trip(v1, true);
  perform public.set_visit_is_trip(v2, true);
  select trips_count, places_count into after_two, places_after from public.wander_stats(null);

  if after_two <> base + 2 then
    raise exception 'FAIL: marking an already-counted trip double-counted it (% -> %)', base, after_two; end if;
  if places_after <> places_base + 1 then
    raise exception 'FAIL: two trips to one city must add ONE place (% -> %)', places_base, places_after; end if;
  raise notice 'PASS 3: one place, two trips — counted once and every time';
end $$;

-- 4) Automation must never mark a trip. rebuild_place_visits is the thing that
--    rewrites visits; a marked trip has to survive it.
do $$
declare p uuid; v uuid; still boolean;
begin
  insert into public.places (name, lat, lng, saved) values ('V133 Brewster', 41.76, -70.08, true) returning id into p;
  insert into public.visits (place_id, start_date, end_date, manual, is_trip)
    values (p, '2018-07-16', '2018-07-17', true, true) returning id into v;
  perform public.rebuild_place_visits(p);
  select is_trip into still from public.visits where id = v;
  if still is null then raise exception 'FAIL: rebuild deleted a marked trip'; end if;
  if not still then raise exception 'FAIL: rebuild cleared the trip mark'; end if;
  raise notice 'PASS 4: a marked trip survives an automated rebuild';
end $$;

-- 5) A planned (future) trip does not inflate the taken-trip stats.
do $$
declare p uuid; v uuid; before_t int; after_t int;
begin
  select trips_count into before_t from public.wander_stats(null);
  insert into public.places (name, lat, lng, saved) values ('V133 Future', 48.8, 2.3, true) returning id into p;
  insert into public.visits (place_id, start_date, end_date, manual, is_trip, status, solo_profile)
    values (p, '2027-06-01', '2027-06-10', true, true, 'planned', null) returning id into v;
  select trips_count into after_t from public.wander_stats(null);
  if after_t <> before_t then raise exception 'FAIL: a planned trip counted as taken'; end if;
  raise notice 'PASS 5: planned trips are not counted as taken';
end $$;

-- 6) Attribution still governs the view.
do $$
declare p uuid; v uuid; c_e int; c_j int; b_e int; b_j int;
begin
  select trips_count into b_e from public.wander_stats('ffff6666-0000-0000-0000-00000000b001');
  select trips_count into b_j from public.wander_stats('ffff6666-0000-0000-0000-00000000b002');
  insert into public.places (name, lat, lng, saved) values ('V133 Josh Trip', 45.0, -93.0, true) returning id into p;
  insert into public.visits (place_id, start_date, end_date, manual, is_trip, solo_profile)
    values (p, '2026-05-01', '2026-05-04', true, true, 'ffff6666-0000-0000-0000-00000000b002') returning id into v;
  select trips_count into c_e from public.wander_stats('ffff6666-0000-0000-0000-00000000b001');
  select trips_count into c_j from public.wander_stats('ffff6666-0000-0000-0000-00000000b002');
  if c_e <> b_e then raise exception 'FAIL: Josh''s trip showed in Erica''s view'; end if;
  if c_j <> b_j + 1 then raise exception 'FAIL: Josh''s trip missing from his view'; end if;
  raise notice 'PASS 6: trips respect Just me / Just Josh / Both';
end $$;

-- 7) Only editors/owners may mark a trip.
do $$
declare v uuid; ok boolean := false;
begin
  insert into auth.users (id,email) values ('ffff6666-0000-0000-0000-00000000b003','v133-viewer@example.test') on conflict do nothing;
  insert into public.profiles (id,role,display_name) values ('ffff6666-0000-0000-0000-00000000b003','viewer','V133 Viewer') on conflict do nothing;
  select id into v from public.visits where is_trip limit 1;
  set local request.jwt.claims = '{"sub":"ffff6666-0000-0000-0000-00000000b003"}';
  begin perform public.set_visit_is_trip(v, false); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a viewer unmarked a trip'; end if;
  raise notice 'PASS 7: viewer denied';
end $$;

do $$ begin raise notice 'PASS: 0133 one model — place once, visit every time, trip is a marked visit'; end $$;
rollback;
