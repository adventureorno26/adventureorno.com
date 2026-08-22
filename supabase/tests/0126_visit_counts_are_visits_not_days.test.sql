-- DB test for 0126 — visit_count means VISITS, and the badge respects the view.
-- LOCAL disposable stack only. Shapes taken from real production data.

begin;

insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-00000000c001', 'v126-erica@example.test'),
  ('eeeeeeee-0000-0000-0000-00000000c002', 'v126-josh@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('eeeeeeee-0000-0000-0000-00000000c001', 'owner',  'V126 Erica'),
  ('eeeeeeee-0000-0000-0000-00000000c002', 'editor', 'Josh') on conflict do nothing;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-00000000c001"}';

-- 1) DAYS -> TIMES. Five photo days across one trip window is ONE visit, so the
--    badge must read 1, not 5. This is the exact Cape Cod complaint.
do $$
declare p uuid; c int; t uuid; tw uuid;
begin
  insert into public.places (name, lat, lng, saved) values ('V126 Cape Cod', 41.7, -70.0, true) returning id into p;
  insert into public.places (name, lat, lng, saved) values ('V126 CC trip', 41.71, -70.01, true) returning id into tw;
  insert into public.visits (place_id, start_date, end_date, manual) values (tw, '2026-08-02', '2026-08-07', true) returning id into t;
  perform public.set_visit_is_trip(t, true);
  insert into public.photos (place_id, lat, lng, taken_at, r2_key, thumb_key, sha256) values
    (p,41.7,-70.0,'2026-08-02T12:00:00Z','a1','b1','s1'),
    (p,41.7,-70.0,'2026-08-03T12:00:00Z','a2','b2','s2'),
    (p,41.7,-70.0,'2026-08-05T12:00:00Z','a3','b3','s3'),
    (p,41.7,-70.0,'2026-08-06T12:00:00Z','a4','b4','s4'),
    (p,41.7,-70.0,'2026-08-07T12:00:00Z','a5','b5','s5');

  perform public.rebuild_place_visits(p);
  perform public.recompute_place_stats(p);
  select visit_count into c from public.places where id = p;
  if c <> 1 then raise exception 'FAIL: badge should read 1 visit (5 days), got %', c; end if;
  raise notice 'PASS 1: five days across one trip counts as ONE visit';
end $$;

-- 2) visit_count always equals the number of visit ROWS — the old value was not
--    even self-consistent (Potomac Station showed 67 against 39 rows).
do $$
declare bad int;
begin
  select count(*) into bad
    from public.places p
   where p.visit_count <> (select count(*) from public.visits v where v.place_id = p.id);
  if bad > 0 then raise exception 'FAIL: % place(s) have visit_count <> their visit rows', bad; end if;
  raise notice 'PASS 2: visit_count equals visit rows everywhere';
end $$;

-- 3) THE PER-VIEW BADGE. Reproduces Potomac Station: every visit is Josh's.
--    Erica must NOT see a count for a place she has never been to.
do $$
declare p uuid; c_both int; c_erica int; c_josh int;
begin
  insert into public.places (name, lat, lng, saved) values ('V126 Potomac Station', 39.11, -77.55, true) returning id into p;
  -- Attribution is participant ROWS since 0188; solo_profile is gone.
  insert into public.visits (place_id, start_date, end_date, manual) values
    (p,'2026-03-01','2026-03-01', true),
    (p,'2026-03-05','2026-03-05', true),
    (p,'2026-03-09','2026-03-09', true);
  delete from public.memory_people mp using public.memory_subjects s, public.visits v
   where s.id = mp.subject_id and s.visit_id = v.id and v.place_id = p;
  insert into public.memory_people (subject_id, person_id)
  select public.subject_for_visit(t.visit_id::uuid), public.person_for_profile(t.profile_id::uuid)
    from (select v.id, 'eeeeeeee-0000-0000-0000-00000000c002' from public.visits v where v.place_id = p) t(visit_id, profile_id)
  on conflict do nothing;

  select coalesce((select visits from public.place_visit_counts(null) where place_id=p),0) into c_both;
  select coalesce((select visits from public.place_visit_counts('eeeeeeee-0000-0000-0000-00000000c001') where place_id=p),0) into c_erica;
  select coalesce((select visits from public.place_visit_counts('eeeeeeee-0000-0000-0000-00000000c002') where place_id=p),0) into c_josh;

  if c_both  <> 0 then raise exception 'FAIL: Both view should show 0, got %', c_both; end if;
  if c_erica <> 0 then raise exception 'FAIL: Erica has never been here — expected 0, got %', c_erica; end if;
  if c_josh  <> 3 then raise exception 'FAIL: Josh view should show 3, got %', c_josh; end if;
  raise notice 'PASS 3: a Josh-only place shows 0 for Erica, 3 for Josh';
end $$;

-- 4) A person's view = their own visits PLUS Both — matching place_ids_for_view.
--    Reproduces Lake of the Red Rocks (Both 2, Erica 41, Josh 0) in miniature.
do $$
declare p uuid; c_both int; c_erica int; c_josh int;
begin
  insert into public.places (name, lat, lng, saved) values ('V126 Red Rocks', 39.12, -77.56, true) returning id into p;
  insert into public.visits (place_id, start_date, end_date, manual) values
    (p,'2026-04-01','2026-04-01', true),   -- Both
    (p,'2026-04-05','2026-04-05', true),   -- Both
    (p,'2026-04-09','2026-04-09', true),   -- Erica
    (p,'2026-04-13','2026-04-13', true);   -- Erica
  -- Both = every real member on the visit; a person = only them.
  delete from public.memory_people mp using public.memory_subjects s, public.visits v
   where s.id = mp.subject_id and s.visit_id = v.id and v.place_id = p;
  insert into public.memory_people (subject_id, person_id)
  select public.subject_for_visit(t.visit_id::uuid), public.person_for_profile(t.profile_id::uuid)
    from (select v.id, x
    from public.visits v
    cross join lateral unnest(
      case when v.start_date <= '2026-04-05'
           then array['eeeeeeee-0000-0000-0000-00000000c001'::uuid,
                      'eeeeeeee-0000-0000-0000-00000000c002'::uuid]
           else array['eeeeeeee-0000-0000-0000-00000000c001'::uuid] end) x
   where v.place_id = p) t(visit_id, profile_id)
  on conflict do nothing;

  select visits into c_both  from public.place_visit_counts(null) where place_id=p;
  select visits into c_erica from public.place_visit_counts('eeeeeeee-0000-0000-0000-00000000c001') where place_id=p;
  select coalesce((select visits from public.place_visit_counts('eeeeeeee-0000-0000-0000-00000000c002') where place_id=p),0) into c_josh;

  if c_both  <> 2 then raise exception 'FAIL: Both should be 2, got %', c_both; end if;
  if c_erica <> 4 then raise exception 'FAIL: Erica should be 4 (2 both + 2 hers), got %', c_erica; end if;
  if c_josh  <> 2 then raise exception 'FAIL: Josh should be 2 (the Both visits), got %', c_josh; end if;
  raise notice 'PASS 4: person view = own visits + Both';
end $$;

-- 5) The badge must never disagree with which pins are shown. Every place
--    place_ids_for_view returns must have a positive count in that same view.
do $$
declare mismatch int;
begin
  select count(*) into mismatch
    from (select public.place_ids_for_view(null) as id) v
   where coalesce((select c.visits from public.place_visit_counts(null) c where c.place_id = v.id), 0) = 0;
  if mismatch > 0 then
    raise exception 'FAIL: % place(s) are visible in Both view but count 0', mismatch; end if;

  select count(*) into mismatch
    from (select public.place_ids_for_view('eeeeeeee-0000-0000-0000-00000000c002') as id) v
   where coalesce((select c.visits from public.place_visit_counts('eeeeeeee-0000-0000-0000-00000000c002') c where c.place_id = v.id), 0) = 0;
  if mismatch > 0 then
    raise exception 'FAIL: % place(s) visible in Josh view but count 0', mismatch; end if;
  raise notice 'PASS 5: badge and visible pins agree in every view';
end $$;

-- 6) Members only.
do $$
declare ok boolean := false;
begin
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ff"}';
  begin
    perform * from public.place_visit_counts(null);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: a non-member read place_visit_counts'; end if;
  raise notice 'PASS 6: non-member denied';
end $$;

do $$ begin raise notice 'PASS: 0126 visit counts are visits, per view'; end $$;

rollback;
