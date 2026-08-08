-- DB test for 0134 — the week is one occasion; the beach and restaurant are still
-- places. Shapes taken from the real Cape Cod trip.
begin;

insert into auth.users (id,email) values
  ('aaaa7777-0000-0000-0000-00000000c001','v134-erica@example.test'),
  ('aaaa7777-0000-0000-0000-00000000c002','v134-josh@example.test') on conflict do nothing;
insert into public.profiles (id,role,display_name) values
  ('aaaa7777-0000-0000-0000-00000000c001','owner','V134 Erica'),
  ('aaaa7777-0000-0000-0000-00000000c002','editor','Josh') on conflict do nothing;
set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000c001"}';

-- THE CAPE COD SHAPE: a trip to a place, during which you visit other places.
do $$
declare cc uuid; beach uuid; food uuid; tv uuid; occ_before int; occ_after int; pl_before int; pl_after int;
begin
  select public.occasion_count(null) into occ_before;
  select places_count into pl_before from public.wander_stats(null);

  insert into public.places (name, lat, lng, saved, categories) values ('V134 Cape Cod', 41.7, -70.0, true, array['region']) returning id into cc;
  insert into public.places (name, lat, lng, saved, categories) values ('V134 Linnell Landing', 41.75, -70.05, true, array['beach']) returning id into beach;
  insert into public.places (name, lat, lng, saved, categories) values ('V134 Arnolds', 41.72, -70.02, true, array['dining']) returning id into food;

  insert into public.visits (place_id, start_date, end_date, manual, solo_profile) values (cc, '2026-08-02','2026-08-07', true, null) returning id into tv;
  insert into public.visits (place_id, start_date, end_date, manual, solo_profile) values (beach,'2026-08-03','2026-08-03', true, null);
  insert into public.visits (place_id, start_date, end_date, manual, solo_profile) values (food, '2026-08-05','2026-08-05', true, null);

  -- Before marking: three ordinary visits, three occasions.
  select public.occasion_count(null) into occ_after;
  if occ_after <> occ_before + 3 then
    raise exception 'FAIL: unmarked visits should each be an occasion (% -> %)', occ_before, occ_after; end if;

  -- Mark the week as a trip. It becomes ONE occasion.
  perform public.set_visit_is_trip(tv, true);
  select public.occasion_count(null) into occ_after;
  if occ_after <> occ_before + 1 then
    raise exception 'FAIL: the week must be ONE occasion, got % (expected %)', occ_after, occ_before + 1; end if;

  -- ...but all three are still PLACES.
  select places_count into pl_after from public.wander_stats(null);
  if pl_after <> pl_before + 3 then
    raise exception 'FAIL: the beach and restaurant must still count as places (% -> %)', pl_before, pl_after; end if;
  raise notice 'PASS 1: the week is one occasion; the beach and restaurant are still places';
end $$;

-- 2) THE CONTENTS LIST. The trip contains the places you went to inside it, and
--    NOT its own place — Cape Cod is the trip, not something inside it.
do $$
declare tv uuid; n int; names text;
begin
  select v.id into tv from public.visits v join public.places p on p.id=v.place_id
   where p.name='V134 Cape Cod' and v.is_trip;
  select count(*), string_agg(place_name, ', ' order by place_name) into n, names
    from public.trip_contents(tv);
  if n <> 2 then raise exception 'FAIL: expected 2 places inside the trip, got % (%)', n, names; end if;
  if names !~ 'Linnell' or names !~ 'Arnolds' then raise exception 'FAIL: wrong contents (%)', names; end if;
  if names ~ 'Cape Cod' then raise exception 'FAIL: the trip listed itself as its own contents'; end if;
  raise notice 'PASS 2: trip contents = % (its own place excluded)', names;
end $$;

-- 3) UNMARKING PUTS THEM BACK. Nothing is stored, so nothing can drift.
do $$
declare tv uuid; occ int; base int;
begin
  select v.id into tv from public.visits v join public.places p on p.id=v.place_id where p.name='V134 Cape Cod';
  select public.occasion_count(null) into base;
  perform public.set_visit_is_trip(tv, false);
  select public.occasion_count(null) into occ;
  if occ <> base + 2 then
    raise exception 'FAIL: unmarking should free the 2 contained visits (% -> %)', base, occ; end if;
  if (select count(*) from public.trip_contents(tv)) <> 0 then
    raise exception 'FAIL: an unmarked visit still reports contents'; end if;
  perform public.set_visit_is_trip(tv, true);   -- put it back for later tests
  raise notice 'PASS 3: unmarking a trip releases its contents';
end $$;

-- 4) EACH HIKE IS A VISIT. A repeated place outside any trip counts every time —
--    "I hike the same places often so each hike is a visit."
do $$
declare wod uuid; occ_before int; occ_after int; pl_before int; pl_after int;
begin
  select public.occasion_count(null) into occ_before;
  select places_count into pl_before from public.wander_stats(null);
  insert into public.places (name, lat, lng, saved, categories) values ('V134 W&OD', 39.0, -77.5, true, array['running']) returning id into wod;
  insert into public.visits (place_id, start_date, end_date, manual, solo_profile) values
    (wod,'2026-02-01','2026-02-01',true,null),
    (wod,'2026-02-08','2026-02-08',true,null),
    (wod,'2026-02-15','2026-02-15',true,null);
  select public.occasion_count(null) into occ_after;
  select places_count into pl_after from public.wander_stats(null);
  if occ_after <> occ_before + 3 then raise exception 'FAIL: three runs should be three occasions'; end if;
  if pl_after <> pl_before + 1 then raise exception 'FAIL: three runs at one trail must add ONE place'; end if;
  raise notice 'PASS 4: 3 runs = 3 visits at 1 place';
end $$;

-- 5) A trip is never swallowed by another trip, and never counts twice.
do $$
declare p uuid; outer_v uuid; inner_v uuid; occ int; base int;
begin
  select public.occasion_count(null) into base;
  insert into public.places (name, lat, lng, saved) values ('V134 Europe', 48.8, 2.3, true) returning id into p;
  insert into public.visits (place_id, start_date, end_date, manual, solo_profile) values (p,'2026-06-01','2026-06-20',true,null) returning id into outer_v;
  insert into public.visits (place_id, start_date, end_date, manual, solo_profile) values (p,'2026-06-05','2026-06-08',true,null) returning id into inner_v;
  perform public.set_visit_is_trip(outer_v, true);
  perform public.set_visit_is_trip(inner_v, true);
  select public.occasion_count(null) into occ;
  if occ <> base + 2 then
    raise exception 'FAIL: a marked trip must stay its own occasion (% -> %, expected +2)', base, occ; end if;
  raise notice 'PASS 5: a trip inside a trip is still its own occasion';
end $$;

-- 6) Attribution still governs. Josh's visits are not Erica's occasions.
do $$
declare p uuid; c_e int; c_j int;
begin
  insert into public.places (name, lat, lng, saved) values ('V134 Josh Only', 45.0, -93.0, true) returning id into p;
  insert into public.visits (place_id, start_date, end_date, manual, solo_profile)
    values (p,'2026-04-01','2026-04-01',true,'aaaa7777-0000-0000-0000-00000000c002');
  select public.occasion_count('aaaa7777-0000-0000-0000-00000000c001') into c_e;
  select public.occasion_count('aaaa7777-0000-0000-0000-00000000c002') into c_j;
  if c_e >= c_j then raise exception 'FAIL: Josh-only visit leaked into Erica''s occasions (e=% j=%)', c_e, c_j; end if;
  raise notice 'PASS 6: occasions respect the view';
end $$;

-- 7) Members only.
do $$
declare ok boolean := false;
begin
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000fd"}';
  begin perform public.occasion_count(null); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a non-member counted occasions'; end if;
  raise notice 'PASS 7: non-member denied';
end $$;

do $$ begin raise notice 'PASS: 0134 a trip is one occasion, its places still count'; end $$;
rollback;
