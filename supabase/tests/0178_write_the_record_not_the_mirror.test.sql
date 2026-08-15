-- 0178 — membership written to the record survives; membership written to the mirror
-- does not.
--
-- §0.9 requires these to be permanent, not remembered. Everything runs inside one
-- transaction and rolls back; nothing here touches real data.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('bbbb0178-0000-0000-0000-000000000001', 'a0178@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0178-0000-0000-0000-000000000001', 'A0178', 'owner')
on conflict (id) do update set role = 'owner';
set local request.jwt.claims = '{"sub":"bbbb0178-0000-0000-0000-000000000001"}';

-- ---------------------------------------------------------------------------
-- 1. THE TRAP ITSELF, demonstrated. A membership row that is not backed by
--    part_of is deleted by the sync trigger the moment part_of is touched —
--    with no error. This is what the old add_place_to_visit produced.
-- ---------------------------------------------------------------------------
do $$
declare parent uuid; child uuid; other uuid; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T178 Parent', 38.9, -77.0, true)
    returning id into parent;
  insert into public.places (name, lat, lng, saved) values ('T178 Child', 38.91, -77.01, true)
    returning id into child;
  insert into public.places (name, lat, lng, saved) values ('T178 Other', 38.92, -77.02, true)
    returning id into other;

  -- a membership's parent must be a container (guard from 0150)
  update public.places set holds_children = true where id in (parent, other);

  -- write ONLY the mirror, the way the old code did
  insert into public.place_membership (child_id, parent_id, relationship_type)
  values (child, parent, 'contains') on conflict do nothing;

  select count(*) into n from public.place_membership
   where child_id = child and parent_id = parent;
  if n <> 1 then raise exception 'FAIL: setup — the mirror row should exist'; end if;

  -- ...now touch the child's containers for an unrelated reason.
  --
  -- THE TRAP IS GONE, ON PURPOSE (0192). This used to delete the row above: the array
  -- was the record and a trigger rebuilt the table from it, so a membership written
  -- straight into the table undid itself the next time anyone edited that place. The
  -- direction is now the other way about — the ROW is the record — so the row survives
  -- and it is the ARRAY that is merely stale until something rebuilds it.
  --
  -- The assertion is inverted rather than deleted, because the day this starts deleting
  -- rows again is a day somebody has put the old trigger back.
  update public.places set part_of = array[other] where id = child;

  select count(*) into n from public.place_membership
   where child_id = child and parent_id = parent;
  if n <> 1 then
    raise exception
      'FAIL: writing part_of destroyed a membership row. The old direction is back, and '
      'a row written on its own will silently undo itself again.'; end if;

  raise notice 'PASS 1: a mirror-only membership silently disappears (this is the bug)';
end $$;

-- ---------------------------------------------------------------------------
-- 2. add_place_to_visit writes the RECORD, so the membership survives the
--    exact edit that used to destroy it.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0178-0000-0000-0000-000000000001';
  parent uuid; unrelated uuid; v public.visits; child public.places; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T178 San Diego', 32.7, -117.1, true)
    returning id into parent;
  insert into public.places (name, lat, lng, saved) values ('T178 Elsewhere', 34.0, -118.2, true)
    returning id into unrelated;
  v := public.create_visit(parent, '2026-07-11', '2026-07-16', null, array[a_id]::uuid[]);

  child := public.add_place_to_visit(v.id, 'restaurant', 'Wonderland Ocean Pub');

  -- the RECORD carries it
  if not (select parent = any(coalesce(part_of, '{}'::uuid[]))
            from public.places where id = child.id) then
    raise exception 'FAIL: membership must be written to places.part_of'; end if;
  -- ...and the mirror follows from the trigger
  select count(*) into n from public.place_membership
   where child_id = child.id and parent_id = parent;
  if n <> 1 then raise exception 'FAIL: the trigger should have mirrored it, got %', n; end if;

  -- THE EDIT THAT USED TO DESTROY IT: add the child to something else as well.
  update public.places set holds_children = true where id = unrelated;
  update public.places
     set part_of = (select array_agg(distinct x)
                      from unnest(coalesce(part_of,'{}'::uuid[]) || unrelated) x)
   where id = child.id;

  select count(*) into n from public.place_membership
   where child_id = child.id and parent_id = parent;
  if n <> 1 then
    raise exception 'FAIL: the restaurant silently left the trip when its containers changed'; end if;

  raise notice 'PASS 2: membership written to the record survives an unrelated edit';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Adding the same place twice does not duplicate the membership, and the
--    array does not grow a second copy of the parent.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0178-0000-0000-0000-000000000001';
  parent uuid; v public.visits; c1 public.places; c2 public.places; n int; arr uuid[];
begin
  insert into public.places (name, lat, lng, saved) values ('T178 Twice', 39.5, -76.5, true)
    returning id into parent;
  v := public.create_visit(parent, '2026-09-01', '2026-09-04', null, array[a_id]::uuid[]);

  c1 := public.add_place_to_visit(v.id, 'winery', 'Some Winery');
  c2 := public.add_place_to_visit(v.id, 'winery', 'some winery');
  if c1.id <> c2.id then raise exception 'FAIL: the same-named child was duplicated'; end if;

  select part_of into arr from public.places where id = c1.id;
  if (select count(*) from unnest(arr) x where x = parent) <> 1 then
    raise exception 'FAIL: the parent appears % times in part_of',
      (select count(*) from unnest(arr) x where x = parent); end if;

  select count(*) into n from public.place_membership where child_id = c1.id;
  if n <> 1 then raise exception 'FAIL: expected one membership row, got %', n; end if;

  raise notice 'PASS 3: adding twice is idempotent in both the record and the mirror';
end $$;

rollback;
