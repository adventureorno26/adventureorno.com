-- 0170 — the parent/child rules, the RLS fix, and clearing a note.
begin;
set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('eeee0170-0000-0000-0000-000000000001','t170a@example.invalid'),
  ('eeee0170-0000-0000-0000-000000000002','t170b@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('eeee0170-0000-0000-0000-000000000001','T170 Owner','owner'),
  ('eeee0170-0000-0000-0000-000000000002','T170 Other','editor')
on conflict (id) do nothing;
set local request.jwt.claims = '{"sub":"eeee0170-0000-0000-0000-000000000001"}';

-- 1. The rules hold against a DIRECT update, not just through the RPC.
do $$
declare p uuid; trip uuid; child uuid; far uuid;
begin
  insert into public.places (name, lat, lng, saved) values ('T170 Place', 41.7, -70.0, true)
    returning id into p;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-08-02', '2026-08-07', 'taken', true) returning id into trip;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-08-04', '2026-08-04', 'taken', true) returning id into child;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-12-01', '2026-12-01', 'taken', true) returning id into far;

  -- outside the dates, written DIRECTLY — the trigger must refuse it
  begin
    update public.visits set parent_visit_id = trip where id = far;
    raise exception 'FAIL: a direct update grouped a visit outside the trip dates';
  exception when others then
    if position('outside the trip' in sqlerrm) = 0 then raise; end if;
  end;

  -- itself. Two things forbid this: the CHECK constraint from 0163 and the trigger
  -- here. The constraint fires first, which is fine — the point is that it is refused,
  -- not which guard gets there first.
  begin
    update public.visits set parent_visit_id = trip where id = trip;
    raise exception 'FAIL: a visit was allowed to contain itself';
  exception when others then
    if position('cannot contain itself' in sqlerrm) = 0
       and position('visits_not_own_parent' in sqlerrm) = 0 then raise; end if;
  end;

  -- a non-qualifying parent
  begin
    update public.visits set parent_visit_id = far where id = child;
    raise exception 'FAIL: a single-day non-trip was accepted as a parent';
  exception when others then
    if position('qualifies as a trip' in sqlerrm) = 0 then raise; end if;
  end;

  -- the legitimate one still works
  update public.visits set parent_visit_id = trip where id = child;

  -- and moving the child's dates out from under the parent is refused
  begin
    update public.visits set start_date = '2026-09-01', end_date = '2026-09-01' where id = child;
    raise exception 'FAIL: a child was moved outside its trip';
  exception when others then
    if position('outside the trip' in sqlerrm) = 0 then raise; end if;
  end;

  raise notice 'PASS 1: the parent/child rules hold against direct writes';
end $$;

-- 2. Participant compatibility, both directions.
do $$
declare p uuid; trip uuid; child uuid;
begin
  insert into public.places (name, lat, lng, saved) values ('T170 Who', 41.7, -70.0, true)
    returning id into p;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-03-02', '2026-03-07', 'taken', true) returning id into trip;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-03-04', '2026-03-04', 'taken', true) returning id into child;

  -- WRITTEN DIRECTLY, not through the picker. Since 0240 naming somebody else raises a
  -- question and writes no row, and this section is about the parent/child PARTICIPANT rules
  -- — it needs two visits that already have different people on them, not a tagging dance.
  perform public.set_visit_participants(trip, array['eeee0170-0000-0000-0000-000000000001']::uuid[]);
  insert into public.memory_people (subject_id, person_id, participation_status, evidence, created_by)
  select public.subject_for_visit(t.visit_id::uuid), public.person_for_profile(t.profile_id::uuid), t.claim_status, t.evidence, t.created_by
    from (values (child, 'eeee0170-0000-0000-0000-000000000002', 'accepted', 'created_with', 'user')) t(visit_id, profile_id, claim_status, evidence, created_by)
  on conflict (subject_id, person_id) do nothing;
  delete from public.memory_people mp using public.memory_subjects s, public.people pe
   where s.id = mp.subject_id and pe.id = mp.person_id and s.visit_id = child
     and pe.linked_profile is distinct from 'eeee0170-0000-0000-0000-000000000002';

  begin
    update public.visits set parent_visit_id = trip where id = child;
    raise exception 'FAIL: a visit with a different person was grouped under the trip';
  exception when others then
    if position('was not on the trip' in sqlerrm) = 0 then raise; end if;
  end;

  raise notice 'PASS 2: a trip cannot swallow a visit with someone who was not on it';
end $$;

-- 3. A note can be cleared, and an unmentioned note is left alone.
do $$
declare p uuid; v uuid; r public.visits;
begin
  insert into public.places (name, lat, lng, saved) values ('T170 Note', 39.0, -77.0, true)
    returning id into p;
  insert into public.visits (place_id, start_date, end_date, status, manual, note)
    values (p, '2026-04-01', '2026-04-01', 'taken', true, 'the original note') returning id into v;

  -- extend the END; the visit is a single day, so moving the START past it would
  -- (correctly) be refused, which is a different test.
  r := public.edit_visit(v, null, '2026-04-02');    -- note not mentioned
  if r.note <> 'the original note' then
    raise exception 'FAIL: an unmentioned note was lost'; end if;

  r := public.edit_visit(v, null, null, null, null, null, true);   -- clear it
  if r.note is not null then
    raise exception 'FAIL: the note could not be cleared, got %', r.note; end if;

  raise notice 'PASS 3: a note can be cleared, and is otherwise left alone';
end $$;

-- 4. The view no longer bypasses RLS.
do $$
declare opts text;
begin
  select array_to_string(reloptions, ',') into opts from pg_class where oid='public.accepted_visits'::regclass;
  if coalesce(opts,'') !~ 'security_invoker=(true|on)' then
    raise exception 'FAIL: accepted_visits still runs as its owner (reloptions=%)', coalesce(opts,'none');
  end if;
  raise notice 'PASS 4: accepted_visits filters through the caller''s RLS';
end $$;

rollback;
