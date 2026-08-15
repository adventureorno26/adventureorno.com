-- 0184 — the map and the type lists scope by participants, not by a null.
--
-- §0.9 requires these to be permanent, not remembered. Everything runs inside one
-- transaction and rolls back; nothing here touches real data.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('bbbb0184-0000-0000-0000-000000000001', 'a0184@example.invalid'),
  ('bbbb0184-0000-0000-0000-000000000002', 'b0184@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0184-0000-0000-0000-000000000001', 'A0184', 'owner'),
  ('bbbb0184-0000-0000-0000-000000000002', 'B0184', 'editor')
on conflict (id) do update set role = excluded.role;
set local request.jwt.claims = '{"sub":"bbbb0184-0000-0000-0000-000000000001"}';

do $$
declare
  a_id uuid := 'bbbb0184-0000-0000-0000-000000000001';
  b_id uuid := 'bbbb0184-0000-0000-0000-000000000002';
  p uuid; v public.visits; shared_act uuid; solo_act uuid; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T184 Trail', 39.1, -77.5, true)
    returning id into p;
  v := public.create_visit(p, '2026-04-10', null, null, array[a_id, b_id]::uuid[]);

  -- one both of them did, one only B did
  insert into public.activities (name, type, distance, start_date, place_id, visit_id,
                                 source, owner_profile, summary_polyline)
    values ('T184 Together', 'Hike', 5000, '2026-04-10T10:00:00Z', p, v.id,
            'manual', a_id, 'abc') returning id into shared_act;
  insert into public.activities (name, type, distance, start_date, place_id, visit_id,
                                 source, owner_profile, summary_polyline)
    values ('T184 B only', 'Hike', 6000, '2026-04-10T14:00:00Z', p, v.id,
            'manual', b_id, 'def') returning id into solo_act;
  -- only B did the second one (0188: rows, not a column)
  perform public.set_activity_solo(solo_act, b_id);

  -- THE SHARED VIEW is what everyone did, not what a null says.
  select count(*) into n from public.activities_of_type('Hike', null) where id = shared_act;
  if n <> 1 then raise exception 'FAIL: the shared hike should appear in the Both view'; end if;
  select count(*) into n from public.activities_of_type('Hike', null) where id = solo_act;
  if n <> 0 then raise exception 'FAIL: a hike only B did must not appear in the Both view'; end if;

  -- A PERSON sees theirs, shared or not.
  select count(*) into n from public.activities_of_type('Hike', b_id);
  if n <> 2 then raise exception 'FAIL: B did both hikes, got %', n; end if;
  select count(*) into n from public.activities_of_type('Hike', a_id);
  if n <> 1 then raise exception 'FAIL: A did one of them, got %', n; end if;

  -- and the map lines answer identically
  select count(*) into n from public.activity_lines(null);
  if n <> 1 then raise exception 'FAIL: the map''s Both view should draw one line, got %', n; end if;
  select count(*) into n from public.activity_lines(b_id);
  if n <> 2 then raise exception 'FAIL: B''s map should draw two lines, got %', n; end if;

  -- the place name rides along, so the list needs no second request
  if (select place_name from public.activities_of_type('Hike', b_id) where id = solo_act)
     <> 'T184 Trail' then
    raise exception 'FAIL: the place name should come back with the row'; end if;

  raise notice 'PASS: both readers scope by who was actually there';
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.activities_of_type(text,uuid)', 'EXECUTE')
  or has_function_privilege('anon', 'public.activity_lines(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can read activities';
  end if;
  raise notice 'PASS: anon reaches neither';
end $$;

rollback;
