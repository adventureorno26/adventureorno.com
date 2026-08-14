-- 0176 — the RPCs are the only door, and they still work.
--
-- §0.9 requires these to be permanent, not remembered. Everything runs inside one
-- transaction and rolls back; nothing here touches real data.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('bbbb0176-0000-0000-0000-000000000001', 'a0176@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0176-0000-0000-0000-000000000001', 'A0176', 'owner')
on conflict (id) do update set role = 'owner';
set local request.jwt.claims = '{"sub":"bbbb0176-0000-0000-0000-000000000001"}';

-- ---------------------------------------------------------------------------
-- 1. A BROWSER CANNOT WRITE THESE TABLES DIRECTLY.
--    Every rule the RPCs enforce was walkable past with a plain INSERT.
-- ---------------------------------------------------------------------------
do $$
declare t text; p text; bad text[] := '{}';
begin
  foreach t in array array['visits','visit_profiles','visit_people','visit_evidence'] loop
    foreach p in array array['INSERT','UPDATE','DELETE'] loop
      if has_table_privilege('authenticated', 'public.' || t, p) then
        bad := bad || (t || '.' || p);
      end if;
    end loop;
    -- reading is still allowed; the app has to show the visit
    if not has_table_privilege('authenticated', 'public.' || t, 'SELECT') then
      raise exception 'FAIL: authenticated can no longer READ %', t;
    end if;
  end loop;

  if array_length(bad,1) > 0 then
    raise exception 'FAIL: a browser can still write directly: %', array_to_string(bad, ', ');
  end if;

  raise notice 'PASS 1: visits and its tables are read-only to a browser';
end $$;

-- ---------------------------------------------------------------------------
-- 2. AND THE RPCs STILL WORK — the point is one door, not no door.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0176-0000-0000-0000-000000000001';
  p uuid; v public.visits; snap jsonb; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T176 Place', 38.7, -77.0, true)
    returning id into p;

  v := public.create_visit(p, '2026-12-01', '2026-12-03', 'note',
                           array[a_id]::uuid[], false, null, 'key-0176');
  if v.id is null then raise exception 'FAIL: create_visit stopped working'; end if;

  v := public.edit_visit(v.id, null, null, null, null, null, true);  -- clear the note
  if v.note is not null then raise exception 'FAIL: edit_visit stopped clearing notes'; end if;

  perform public.set_visit_participants(v.id, array[a_id]::uuid[]);
  select count(*) into n from public.visit_profiles where visit_id = v.id;
  if n <> 1 then raise exception 'FAIL: set_visit_participants stopped working (%)', n; end if;

  snap := public.delete_visit(v.id);
  if exists (select 1 from public.visits where id = v.id) then
    raise exception 'FAIL: delete_visit stopped working'; end if;
  v := public.restore_visit(snap);
  if v.id is null then raise exception 'FAIL: restore_visit stopped working'; end if;

  raise notice 'PASS 2: create, edit, participants, delete and restore all still work';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Companions are replaced ATOMICALLY. The browser used to DELETE then
--    INSERT, so a dropped connection between them emptied the visit.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0176-0000-0000-0000-000000000001';
  p uuid; v public.visits; k1 uuid; k2 uuid; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T176 Companions', 38.75, -77.05, true)
    returning id into p;
  v := public.create_visit(p, '2026-12-10', null, null, array[a_id]::uuid[]);

  insert into public.people (display_name, kind) values ('T176 Kid', 'child') returning id into k1;
  insert into public.people (display_name, kind) values ('T176 Dog', 'pet')   returning id into k2;

  perform public.set_visit_people(v.id, array[k1, k2]);
  select count(*) into n from public.visit_people where visit_id = v.id;
  if n <> 2 then raise exception 'FAIL: both companions should be on the visit, got %', n; end if;

  -- replacing with a subset removes only what left
  perform public.set_visit_people(v.id, array[k1]);
  select count(*) into n from public.visit_people where visit_id = v.id;
  if n <> 1 then raise exception 'FAIL: expected one companion left, got %', n; end if;
  if not exists (select 1 from public.visit_people where visit_id = v.id and person_id = k1) then
    raise exception 'FAIL: the wrong companion was removed'; end if;

  -- and an empty list clears them, deliberately
  perform public.set_visit_people(v.id, '{}'::uuid[]);
  select count(*) into n from public.visit_people where visit_id = v.id;
  if n <> 0 then raise exception 'FAIL: an empty list should clear companions, got %', n; end if;

  raise notice 'PASS 3: companions replace atomically';
end $$;

-- ---------------------------------------------------------------------------
-- 4. anon reaches none of it.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.set_visit_people(uuid,uuid[])', 'EXECUTE')
  or has_table_privilege('anon', 'public.visits', 'SELECT') then
    raise exception 'FAIL: anon can reach visits';
  end if;

  raise notice 'PASS 4: anon reaches none of it';
end $$;

rollback;
