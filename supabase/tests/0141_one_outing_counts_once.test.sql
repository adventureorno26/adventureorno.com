-- DB test for 0140/0141 — one outing counts once, however many times it was
-- recorded, and NOTHING is deleted to achieve that.
--
-- Seeded with the real SHAPE that was wrong — Erica's Purcellville run, recorded
-- three times (her Strava, a file import of the same run, and Josh's record of the
-- same outing), counted as 134.7 miles. The fixture deliberately uses 2031 dates:
-- an earlier draft reused the real 2026-03-07 date and distances, and the fixtures
-- were grouped WITH the production run, so the test measured nothing. Never seed a
-- shape that can collide with live rows.
begin;

insert into auth.users (id, email) values
  ('aaaa7777-0000-0000-0000-00000000f001','v141-erica@example.test'),
  ('aaaa7777-0000-0000-0000-00000000f002','v141-josh@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('aaaa7777-0000-0000-0000-00000000f001','owner','V141 Erica'),
  ('aaaa7777-0000-0000-0000-00000000f002','editor','Josh') on conflict do nothing;
set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000f001"}';

-- 1) THE THREE-WAY RUN. One 45-mile outing, three records, must count ONCE — and
--    all three records must survive.
do $$
declare p uuid; m_before double precision; m_after double precision;
        n_groups int; n_rows int; base double precision;
begin
  insert into public.places (name, lat, lng, saved) values ('V141 W&OD', 39.13, -77.55, true)
    returning id into p;
  insert into public.visits (place_id, start_date, end_date, manual) values (p,'2031-03-07','2031-03-07',true);

  select miles into base from public.wander_stats(null);

  -- 72420 m = 45.0 mi. Three records of the SAME run, within minutes of each other.
  insert into public.activities (type, name, distance, start_date, lat, lng, place_id,
                                 source, owner_profile, summary_polyline) values
    ('Run','V141 Purcellville to Arlington', 72582, '2031-03-07T13:10:00Z', 39.13, -77.55, p,
     'strava','aaaa7777-0000-0000-0000-00000000f001', 'abc'),
    ('Run','V141 running 13:21',             72260, '2031-03-07T13:21:00Z', 39.13, -77.55, p,
     'file',  'aaaa7777-0000-0000-0000-00000000f001', null),
    ('Run','V141 Purcellville Running',      71940, '2031-03-07T13:10:00Z', 39.13, -77.55, p,
     'file',  'aaaa7777-0000-0000-0000-00000000f002', null);
  -- these were all "everyone's", which a bare insert now means by default (0188)

  -- CONTROL: ungrouped, all three count — this is the bug, reproduced.
  select miles into m_before from public.wander_stats(null);
  if (m_before - base) < 130 then
    raise exception 'FAIL: control broken — three 45mi records should add ~135 mi, added %',
      round((m_before - base)::numeric,1);
  end if;

  perform public.group_duplicate_activities(20, 0.10, true);

  select miles into m_after from public.wander_stats(null);
  if (m_after - base) > 46 or (m_after - base) < 44 then
    raise exception 'FAIL: after grouping the run must count ~45 mi once, counted %',
      round((m_after - base)::numeric,1);
  end if;

  -- ALL THREE RECORDS SURVIVE. Grouping is not deleting.
  select count(*) into n_rows from public.activities where name like 'V141%';
  if n_rows <> 3 then raise exception 'FAIL: grouping deleted records (% left of 3)', n_rows; end if;

  -- And they are ONE group, not two overlapping pairs — the 0140 bug.
  select count(distinct coalesce(shared_group_id, id)) into n_groups
    from public.activities where name like 'V141%';
  if n_groups <> 1 then
    raise exception 'FAIL: a three-way duplicate made % groups, expected 1', n_groups;
  end if;
  raise notice 'PASS 1: three records of one run count once, all three survive, one group';
end $$;

-- 2) TWO REAL WALKS ON ONE DAY ARE NOT DUPLICATES. The 2024-09-03 shape: a
--    "Morning Walk" and an "Evening Walk", both 1.4 miles, twelve hours apart.
--    A same-day rule would have merged them; the time window must protect them.
do $$
declare p uuid; n_groups int;
begin
  insert into public.places (name, lat, lng, saved) values ('V141 Neighborhood', 39.05, -77.48, true)
    returning id into p;
  insert into public.activities (type, name, distance, start_date, lat, lng, place_id, source, owner_profile) values
    ('Walk','V141 Morning Walk', 2253, '2031-09-03T12:00:00Z', 39.05, -77.48, p, 'strava','aaaa7777-0000-0000-0000-00000000f001'),
    ('Walk','V141 Evening Walk', 2253, '2031-09-04T00:00:00Z', 39.05, -77.48, p, 'strava','aaaa7777-0000-0000-0000-00000000f001');

  perform public.group_duplicate_activities(20, 0.10, true);

  select count(distinct coalesce(shared_group_id, id)) into n_groups
    from public.activities where name in ('V141 Morning Walk','V141 Evening Walk');
  if n_groups <> 2 then
    raise exception 'FAIL: two real walks 12h apart were merged (% group)', n_groups;
  end if;
  raise notice 'PASS 2: same day, same distance, hours apart — left alone';
end $$;

-- 3) THE NIGHTLY JOB NO LONGER DELETES. dedupe_joint_outings runs at 04:20 every
--    night and used to `delete from public.activities`. Erica's standing rule is
--    that nothing mass-deletes her data.
do $$
declare n_before int; n_after int;
begin
  select count(*) into n_before from public.activities;
  perform public.dedupe_joint_outings();
  select count(*) into n_after from public.activities;
  if n_after <> n_before then
    raise exception 'FAIL: the nightly job deleted % activities', n_before - n_after;
  end if;
  raise notice 'PASS 3: the nightly job groups and never deletes';
end $$;

-- 4) IDEMPOTENT. Running it again must not change anything — a nightly job that
--    churns is a nightly job that eventually corrupts.
do $$
declare m1 double precision; m2 double precision; g1 int; g2 int;
begin
  select miles into m1 from public.wander_stats(null);
  select count(distinct coalesce(shared_group_id,id)) into g1 from public.activities;
  perform public.group_duplicate_activities(20, 0.10, true);
  select miles into m2 from public.wander_stats(null);
  select count(distinct coalesce(shared_group_id,id)) into g2 from public.activities;
  if m1 is distinct from m2 or g1 <> g2 then
    raise exception 'FAIL: re-running changed things (miles % -> %, groups % -> %)', m1, m2, g1, g2;
  end if;
  raise notice 'PASS 4: re-running is a no-op';
end $$;

-- 5) Members only.
do $$
declare ok boolean := false;
begin
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000fd"}';
  begin perform public.group_duplicate_activities(20, 0.10, false); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a non-member ran the grouper'; end if;
  raise notice 'PASS 5: non-member denied';
end $$;

do $$ begin raise notice 'PASS: 0141 one outing counts once'; end $$;
rollback;
