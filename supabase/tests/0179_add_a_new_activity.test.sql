-- 0179 — the dropdown's list can grow, and growing it decides the right thing.
--
-- §0.9 requires these to be permanent, not remembered. Everything runs inside one
-- transaction and rolls back; nothing here touches real data.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('bbbb0179-0000-0000-0000-000000000001', 'a0179@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0179-0000-0000-0000-000000000001', 'A0179', 'owner')
on conflict (id) do update set role = 'owner';
set local request.jwt.claims = '{"sub":"bbbb0179-0000-0000-0000-000000000001"}';

-- ---------------------------------------------------------------------------
-- 1. The eight Erica named are there, in the order she said them.
-- ---------------------------------------------------------------------------
do $$
declare got text;
begin
  select string_agg(slug, ',' order by sort, slug) into got
    from public.activity_options where active and sort <= 80;
  if got <> 'run,walk,hike,bike,winery,brewery,restaurant,bar' then
    raise exception 'FAIL: the dropdown order changed — got %', got; end if;

  raise notice 'PASS 1: run, walk, hike, bike, winery, brewery, restaurant, bar';
end $$;

-- ---------------------------------------------------------------------------
-- 2. A NEW OPTION THAT IS SOMETHING YOU DID becomes a route, and immediately
--    works in the dropdown it was added for.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0179-0000-0000-0000-000000000001';
  opt public.activity_options; p uuid; v public.visits; act public.activities; n int;
begin
  opt := public.add_activity_option('Paddle', 'route');
  if opt.slug <> 'paddle' then raise exception 'FAIL: slug should be paddle, got %', opt.slug; end if;
  if opt.kind <> 'route' then raise exception 'FAIL: kind should be route'; end if;
  if opt.activity_type <> 'Paddle' then
    raise exception 'FAIL: a route needs an activity type, got %', coalesce(opt.activity_type,'(null)'); end if;
  if opt.sort <= 80 then raise exception 'FAIL: a new option goes after the seeded ones'; end if;

  -- and it is usable straight away
  insert into public.places (name, lat, lng, saved) values ('T179 Lake', 39.0, -77.0, true)
    returning id into p;
  v := public.create_visit(p, '2026-08-01', null, null, array[a_id]::uuid[]);
  act := public.add_activity_to_visit(v.id, 'paddle', 'Sunset paddle', 3000, 'key-0179-a');
  if act.visit_id <> v.id then raise exception 'FAIL: the new option did not attach'; end if;
  if act.type <> 'Paddle' then raise exception 'FAIL: expected type Paddle, got %', act.type; end if;

  select count(*) into n from public.activity_profiles where activity_id = act.id;
  if n < 1 then raise exception 'FAIL: the new activity got no participants'; end if;

  raise notice 'PASS 2: a new "something we did" works end to end';
end $$;

-- ---------------------------------------------------------------------------
-- 3. A NEW OPTION THAT IS SOMEWHERE YOU WENT becomes a place with its own card
--    and its own visit — the distinction that is the whole model.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0179-0000-0000-0000-000000000001';
  opt public.activity_options; parent uuid; v public.visits; child public.places; n int;
begin
  opt := public.add_activity_option('Distillery', 'place');
  if opt.kind <> 'place' then raise exception 'FAIL: kind should be place'; end if;
  if opt.place_category is null then raise exception 'FAIL: a place option needs a category'; end if;

  insert into public.places (name, lat, lng, saved) values ('T179 Town', 38.0, -78.0, true)
    returning id into parent;
  v := public.create_visit(parent, '2026-08-10', '2026-08-12', null, array[a_id]::uuid[]);

  child := public.add_place_to_visit(v.id, 'distillery', 'Catoctin Creek');
  -- it is a PLACE, grouped under the one we were at
  if not (select parent = any(coalesce(part_of,'{}'::uuid[])) from public.places where id = child.id) then
    raise exception 'FAIL: the new place was not grouped under the visit''s place'; end if;
  -- ...with its own visit
  select count(*) into n from public.visits where place_id = child.id;
  if n <> 1 then raise exception 'FAIL: the child place needs its own visit, got %', n; end if;

  raise notice 'PASS 3: a new "somewhere we went" is a place with its own visit';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Adding the same option twice is not an error, and a retired one comes back
--    rather than colliding.
-- ---------------------------------------------------------------------------
do $$
declare o1 public.activity_options; o2 public.activity_options; n int;
begin
  o1 := public.add_activity_option('Snowshoe', 'route');
  o2 := public.add_activity_option('  snowshoe  ', 'route');
  if o1.slug <> o2.slug then raise exception 'FAIL: the same name made two options'; end if;
  select count(*) into n from public.activity_options where slug = 'snowshoe';
  if n <> 1 then raise exception 'FAIL: expected one row, got %', n; end if;

  update public.activity_options set active = false where slug = 'snowshoe';
  o2 := public.add_activity_option('Snowshoe', 'route');
  if not o2.active then raise exception 'FAIL: adding it again should bring it back'; end if;

  begin
    o2 := public.add_activity_option('Nonsense', 'neither');
    raise exception 'FAIL: kind must be route or place';
  exception when others then
    if position('something you did' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    o2 := public.add_activity_option('   ', 'route');
    raise exception 'FAIL: an unnamed option was accepted';
  exception when others then
    if position('give the activity a name' in sqlerrm) = 0 then raise; end if;
  end;

  raise notice 'PASS 4: idempotent, revivable, and it refuses nonsense';
end $$;

-- ---------------------------------------------------------------------------
-- 5. anon cannot change the app's vocabulary.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.add_activity_option(text,text,text)', 'EXECUTE')
  or has_table_privilege('anon', 'public.activity_options', 'SELECT') then
    raise exception 'FAIL: anon can reach the activity options';
  end if;
  -- and a signed-in member still cannot write the table directly
  if has_table_privilege('authenticated', 'public.activity_options', 'INSERT') then
    raise exception 'FAIL: the options table should only be written through the RPC';
  end if;

  raise notice 'PASS 5: the vocabulary is changed through the RPC, by a member, only';
end $$;

rollback;
