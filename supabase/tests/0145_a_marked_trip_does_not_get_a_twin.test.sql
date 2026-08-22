-- DB test for 0145 — a visit you MARKED must not grow a derived twin beside it.
--
-- Real shape: Cape Cod, photos on Aug 2-6, a marked trip Aug 2-7. rebuild deletes
-- derived visits and rebuilds them from the days with evidence; the marked visit is
-- manual so it survives, and the same days produced a SECOND "Aug 2-7" next to it.
-- Fixtures use 2032 so they cannot collide with live rows (see 0141's note).
begin;

insert into auth.users (id, email) values
  ('aaaa7777-0000-0000-0000-00000000a145','v145@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('aaaa7777-0000-0000-0000-00000000a145','owner','V145 Erica') on conflict do nothing;
set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000a145"}';

-- 1) THE CAPE COD SHAPE. Evidence entirely inside a marked trip yields ONE visit.
do $$
declare p uuid; v uuid; n int; man int;
begin
  insert into public.places (name, lat, lng, saved) values ('V145 Cape Cod', 41.7, -70.0, true)
    returning id into p;
  insert into public.photos (place_id, taken_at, r2_key, thumb_key, sha256) values
    (p,'2032-08-02T16:00:00Z','v145/a','v145/at',repeat('1',64)),
    (p,'2032-08-04T16:00:00Z','v145/b','v145/bt',repeat('2',64)),
    (p,'2032-08-06T16:00:00Z','v145/c','v145/ct',repeat('3',64));

  -- CONTROL: only ADJACENT days fuse, so Aug 2 / 4 / 6 are three separate islands
  -- and therefore three visits. This is the state the marked trip has to collapse.
  perform public.rebuild_place_visits(p);
  select count(*) into n from public.visits where place_id = p;
  if n <> 3 then
    raise exception 'FAIL: control — 3 non-adjacent photo days should make 3 visits, got %', n;
  end if;

  -- Mark the week as a trip, the way Erica does on the card.
  insert into public.visits (place_id, start_date, end_date, manual)
    values (p, '2032-08-02', '2032-08-07', true) returning id into v;
  perform public.set_visit_is_trip(v, true);

  perform public.rebuild_place_visits(p);
  select count(*) into n from public.visits where place_id = p;
  -- All three islands are inside Aug 2-7, so they fold into the marked trip and
  -- leave exactly ONE visit: the trip itself.
  if n <> 1 then
    raise exception 'FAIL: expected only the marked trip, got % visits (twin is back)', n;
  end if;

  select count(*) into man from public.visits where place_id = p and manual;
  if man <> 1 then raise exception 'FAIL: the MARKED visit is not the one that survived'; end if;
  raise notice 'PASS 1: evidence inside a marked trip does not create a twin';
end $$;

-- 2) A DAY OUTSIDE THE MARKED SPAN STILL GETS ITS OWN VISIT. The rule is
--    "fully covered", not "anywhere near" — going back months later is a real,
--    separate visit and must not be swallowed.
do $$
declare p uuid; n int;
begin
  select id into p from public.places where name = 'V145 Cape Cod';
  insert into public.photos (place_id, taken_at, r2_key, thumb_key, sha256) values
    (p,'2032-11-20T16:00:00Z','v145/d','v145/dt',repeat('4',64));
  perform public.rebuild_place_visits(p);
  select count(*) into n from public.visits where place_id = p;
  if n <> 2 then
    raise exception 'FAIL: a later day must be its own visit, got % visits', n;
  end if;
  raise notice 'PASS 2: a day outside the marked trip keeps its own visit';
end $$;

-- 3) NOTHING MANUAL IS EVER DELETED. rebuild removes derived visits; a visit a
--    person created or edited must survive untouched, including its attribution.
do $$
declare p uuid; v uuid; still int; solo uuid;
begin
  insert into public.places (name, lat, lng, saved) values ('V145 Handmade', 38.0, -78.0, true)
    returning id into p;
  insert into public.visits (place_id, start_date, end_date, manual, solo_override)
    values (p, '2032-05-01','2032-05-01', true, true)
    returning id into v;
  -- Attribution is participant rows since 0188; replace the everyone-by-default.
  delete from public.memory_people mp using public.memory_subjects s
   where s.id = mp.subject_id and s.visit_id = v;
  insert into public.memory_people (subject_id, person_id)
  select public.subject_for_visit(t.visit_id::uuid), public.person_for_profile(t.profile_id::uuid)
    from (values (v, 'aaaa7777-0000-0000-0000-00000000a145')) t(visit_id, profile_id);

  perform public.rebuild_place_visits(p);

  select count(*) into still from public.visits where id = v;
  if still <> 1 then raise exception 'FAIL: rebuild deleted a manual visit'; end if;
  select case when count(*) = 1 then min(profile_id::text)::uuid end into solo
    from public.visit_profiles where visit_id = v;
  if solo is distinct from 'aaaa7777-0000-0000-0000-00000000a145'::uuid then
    raise exception 'FAIL: rebuild changed a manual visit''s attribution';
  end if;
  raise notice 'PASS 3: manual visits and their attribution survive a rebuild';
end $$;

do $$ begin raise notice 'PASS: 0145 a marked trip does not get a twin'; end $$;
rollback;
