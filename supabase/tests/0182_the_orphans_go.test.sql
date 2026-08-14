-- 0182 — the retired trip-as-a-table model leaves no structure behind.
--
-- §0.9 requires these to be permanent, not remembered. Everything runs inside one
-- transaction and rolls back; nothing here touches real data.
begin;

do $$
declare leftover text[] := '{}'; t text; f text;
begin
  -- The tables themselves.
  foreach t in array array['trips','trip_stops','trip_places','trip_people','trip_notes'] loop
    if to_regclass('public.' || t) is not null then leftover := leftover || t; end if;
  end loop;

  -- ...and the helpers that only existed to write them.
  for f in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('add_trip_note','delete_trip_note','trip_timeline')
  loop
    leftover := leftover || (f || '()');
  end loop;

  if array_length(leftover,1) > 0 then
    raise exception 'FAIL: the trip-as-a-table model still has structure: %',
      array_to_string(leftover, ', ');
  end if;

  raise notice 'PASS: no trips/trip_stops/trip_people/trip_notes table, and no helper for them';
end $$;

-- A trip is still a VISIT, and still counts. Removing the tables changed nothing.
do $$
declare a_id uuid; p uuid; v public.visits;
begin
  insert into auth.users (id, email) values
    ('bbbb0182-0000-0000-0000-000000000001', 'a0182@example.invalid') on conflict do nothing;
  insert into public.profiles (id, display_name, role) values
    ('bbbb0182-0000-0000-0000-000000000001', 'A0182', 'owner')
  on conflict (id) do update set role = 'owner';
  a_id := 'bbbb0182-0000-0000-0000-000000000001';
  perform set_config('request.jwt.claims', '{"sub":"bbbb0182-0000-0000-0000-000000000001"}', true);

  insert into public.places (name, lat, lng, saved) values ('T182 Cape', 41.7, -70.3, true)
    returning id into p;
  v := public.create_visit(p, '2026-05-02', '2026-05-08', null, array[a_id]::uuid[]);

  if not public.counts_as_trip(v.*) then
    raise exception 'FAIL: a week away is still a trip'; end if;

  raise notice 'PASS: a trip is a qualifying visit, with no table behind it';
end $$;

rollback;
