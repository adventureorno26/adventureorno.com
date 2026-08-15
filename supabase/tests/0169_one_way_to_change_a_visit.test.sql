-- 0169 — the visit mutation RPCs enforce §0.3's rules in the DATABASE, not in JSX.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('dddd0169-0000-0000-0000-000000000001', 't169a@example.invalid'),
  ('dddd0169-0000-0000-0000-000000000002', 't169b@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('dddd0169-0000-0000-0000-000000000001', 'T169 Owner', 'owner'),
  ('dddd0169-0000-0000-0000-000000000002', 'T169 Other', 'editor')
on conflict (id) do nothing;
set local request.jwt.claims = '{"sub":"dddd0169-0000-0000-0000-000000000001"}';

-- 1. An edit is one statement, and an invalid range never lands.
do $$
declare p uuid; v uuid; r public.visits;
begin
  insert into public.places (name, lat, lng, saved) values ('T169 Place', 38.9, -77.4, true)
    returning id into p;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-05-10', '2026-05-14', 'taken', true) returning id into v;

  -- moving only the END earlier, past the start, must be refused outright
  begin
    r := public.edit_visit(v, null, '2026-05-01');
    raise exception 'FAIL: an inverted date range was accepted';
  exception when others then
    if position('end date is before' in sqlerrm) = 0 then raise; end if;
  end;

  select * into r from public.visits where id = v;
  if r.start_date <> '2026-05-10' or r.end_date <> '2026-05-14' then
    raise exception 'FAIL: the refused edit still changed the row (% -> %)', r.start_date, r.end_date;
  end if;

  r := public.edit_visit(v, '2026-05-11', '2026-05-15', 'a note', true);
  if r.start_date <> '2026-05-11' or r.end_date <> '2026-05-15' or not r.trip_marked then
    raise exception 'FAIL: the valid edit did not apply'; end if;
  if not r.is_trip then raise exception 'FAIL: the legacy flag did not follow trip_marked'; end if;

  raise notice 'PASS 1: an edit is atomic; an invalid range never reaches the row';
end $$;

-- 2. Participants are replaced as a set, and the legacy column follows.
do $$
declare p uuid; v uuid; n int; solo uuid;
begin
  insert into public.places (name, lat, lng, saved) values ('T169 Who', 38.9, -77.4, true)
    returning id into p;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-05-20', '2026-05-20', 'taken', true) returning id into v;

  perform public.set_visit_participants(v, array['dddd0169-0000-0000-0000-000000000001',
                                                 'dddd0169-0000-0000-0000-000000000002']::uuid[]);
  select count(*) into n from public.visit_profiles where visit_id = v;
  if n <> 2 then raise exception 'FAIL: expected 2 participants, got %', n; end if;
  -- 0188 removed the solo_profile mirror; the rows ARE the attribution now, so what
  -- was asserted about the column is asserted about them.
  if exists (select 1 from public.visit_profiles where visit_id = v
              and profile_id = 'dddd0169-0000-0000-0000-000000000001') = false then
    raise exception 'FAIL: the first participant is missing'; end if;

  perform public.set_visit_participants(v, array['dddd0169-0000-0000-0000-000000000002']::uuid[]);
  select count(*) into n from public.visit_profiles where visit_id = v;
  if n <> 1 then raise exception 'FAIL: the set was not replaced, got %', n; end if;
  select min(profile_id::text)::uuid into solo from public.visit_profiles where visit_id = v;
  if solo <> 'dddd0169-0000-0000-0000-000000000002' then
    raise exception 'FAIL: the remaining participant is the wrong one'; end if;

  begin
    perform public.set_visit_participants(v, array[]::uuid[]);
    raise exception 'FAIL: an empty participant list was accepted';
  exception when others then
    if position('at least one participant' in sqlerrm) = 0 then raise; end if;
  end;

  raise notice 'PASS 2: participants replace as a set and the legacy column follows';
end $$;

-- 3. Grouping is explicit and guarded (§0.3/§0.9).
do $$
declare p uuid; trip uuid; child uuid; outside uuid; r public.visits;
begin
  insert into public.places (name, lat, lng, saved) values ('T169 Trip', 41.7, -70.0, true)
    returning id into p;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-08-02', '2026-08-07', 'taken', true) returning id into trip;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-08-04', '2026-08-04', 'taken', true) returning id into child;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-09-01', '2026-09-01', 'taken', true) returning id into outside;

  perform public.set_visit_participants(trip,  array['dddd0169-0000-0000-0000-000000000001']::uuid[]);
  perform public.set_visit_participants(child, array['dddd0169-0000-0000-0000-000000000001']::uuid[]);

  r := public.attach_child_visit(child, trip);
  if r.parent_visit_id <> trip then raise exception 'FAIL: the child was not grouped'; end if;

  -- a child grouped under a trip is not a second headline visit
  if (select count(*) from public.accepted_visits where id = child and is_headline) <> 0 then
    raise exception 'FAIL: a grouped child still counts as a headline visit'; end if;

  begin
    r := public.attach_child_visit(outside, trip);
    raise exception 'FAIL: a visit outside the dates was grouped';
  exception when others then
    if position('outside the trip' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    r := public.attach_child_visit(trip, trip);
    raise exception 'FAIL: a visit was allowed to contain itself';
  exception when others then
    if position('cannot contain itself' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    r := public.attach_child_visit(trip, child);   -- child is now inside trip → a loop
    raise exception 'FAIL: a cycle was allowed';
  exception when others then
    if position('loop' in sqlerrm) = 0 and position('does not qualify' in sqlerrm) = 0 then raise; end if;
  end;

  -- participant compatibility: someone not on the trip cannot be swallowed by it
  perform public.set_visit_participants(child, array['dddd0169-0000-0000-0000-000000000002']::uuid[]);
  perform public.detach_child_visit(child);
  begin
    r := public.attach_child_visit(child, trip);
    raise exception 'FAIL: a visit with a different person was grouped under the trip';
  exception when others then
    if position('was not on the trip' in sqlerrm) = 0 then raise; end if;
  end;

  raise notice 'PASS 3: grouping is explicit, date-bounded, cycle-free and participant-checked';
end $$;

-- 4. Moving a visit takes its activities with it. And anon reaches none of this.
do $$
declare a_place uuid; b_place uuid; v uuid; act uuid; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T169 From', 39.0, -77.0, true)
    returning id into a_place;
  insert into public.places (name, lat, lng, saved) values ('T169 To', 39.5, -77.5, true)
    returning id into b_place;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (a_place, '2026-06-01', '2026-06-01', 'taken', true) returning id into v;
  act := (public.add_activity_to_visit(v, 'walk', 'A walk', 1000, 'mv-1')).id;

  perform public.move_visit_to_place(v, b_place);
  select count(*) into n from public.activities where id = act and place_id = b_place;
  if n <> 1 then raise exception 'FAIL: the activity did not move with its visit'; end if;

  if has_function_privilege('anon','public.edit_visit(uuid,date,date,text,boolean,text,boolean)','EXECUTE')
  or has_function_privilege('anon','public.set_visit_participants(uuid,uuid[])','EXECUTE')
  or has_function_privilege('anon','public.attach_child_visit(uuid,uuid)','EXECUTE')
  or has_function_privilege('anon','public.move_visit_to_place(uuid,uuid)','EXECUTE') then
    raise exception 'FAIL: anon can execute the visit mutation RPCs';
  end if;

  raise notice 'PASS 4: a moved visit takes its activities; anon reaches none of the RPCs';
end $$;

rollback;
