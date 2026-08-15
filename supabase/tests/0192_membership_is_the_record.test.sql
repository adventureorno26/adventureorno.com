-- 0192 — the ROWS are the record now, and the array follows them.
--
-- §8 recorded the opposite as a fact that must not be relearned: "a membership row alone
-- does nothing and undoes itself. Write part_of." That was true, and this migration is
-- what makes it stop being true. The first test is that exact sentence, inverted — a row
-- inserted on its own must now STICK, and reach the array.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('bbbb0192-0000-0000-0000-000000000001', 'a0192@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0192-0000-0000-0000-000000000001', 'A0192', 'owner')
on conflict (id) do update set role = 'owner';
set local request.jwt.claims = '{"sub":"bbbb0192-0000-0000-0000-000000000001"}';

-- ---------------------------------------------------------------------------
-- 1. THE INVERTED FACT. A membership row alone is now enough, and the array
--    follows it. Under 0155 this row was deleted again by the old trigger.
-- ---------------------------------------------------------------------------
do $$
declare trail uuid; seg uuid; arr uuid[];
begin
  insert into public.places (name, lat, lng, saved, is_trail)
    values ('T192 Trail', 39.0, -77.7, true, true) returning id into trail;
  insert into public.places (name, lat, lng, saved)
    values ('T192 Section', 39.1, -77.8, true) returning id into seg;

  insert into public.place_membership (child_id, parent_id) values (seg, trail);

  select part_of into arr from public.places where id = seg;
  if arr is null or not (trail = any(arr)) then
    raise exception 'FAIL: the row did not reach part_of — the array is no longer the record';
  end if;
  raise notice 'PASS 1: a membership row sticks, and the array follows it';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Removing the row removes it from the array too.
-- ---------------------------------------------------------------------------
do $$
declare trail uuid; seg uuid; arr uuid[];
begin
  select id into trail from public.places where name = 'T192 Trail';
  select id into seg from public.places where name = 'T192 Section';

  delete from public.place_membership where child_id = seg and parent_id = trail;

  select part_of into arr from public.places where id = seg;
  if arr is not null and trail = any(arr) then
    raise exception 'FAIL: deleting the row left the array claiming the membership';
  end if;
  raise notice 'PASS 2: deleting the row clears the array';
end $$;

-- ---------------------------------------------------------------------------
-- 3. The RPCs the app calls go through rows.
-- ---------------------------------------------------------------------------
do $$
declare trail uuid; seg uuid; n int; arr uuid[];
begin
  select id into trail from public.places where name = 'T192 Trail';
  select id into seg from public.places where name = 'T192 Section';

  perform public.add_to_container(seg, trail);
  select count(*) into n from public.place_membership where child_id = seg and parent_id = trail;
  if n <> 1 then raise exception 'FAIL: add_to_container wrote % rows', n; end if;
  select part_of into arr from public.places where id = seg;
  if not (trail = any(coalesce(arr, '{}'::uuid[]))) then
    raise exception 'FAIL: add_to_container did not reach the array';
  end if;

  -- twice is once
  perform public.add_to_container(seg, trail);
  select count(*) into n from public.place_membership where child_id = seg and parent_id = trail;
  if n <> 1 then raise exception 'FAIL: adding twice made % rows', n; end if;

  perform public.remove_from_container(seg, trail);
  select count(*) into n from public.place_membership where child_id = seg and parent_id = trail;
  if n <> 0 then raise exception 'FAIL: remove_from_container left % rows', n; end if;

  raise notice 'PASS 3: add/remove_to_container write and delete rows, idempotently';
end $$;

-- ---------------------------------------------------------------------------
-- 4. A place put inside another from the CARD lands as a row.
--    This is the path 0178 fixed by writing the array; it now writes the row.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0192-0000-0000-0000-000000000001';
  parent uuid; v public.visits; child public.places; n int; arr uuid[];
begin
  insert into public.places (name, lat, lng, saved) values ('T192 San Diego', 32.7, -117.1, true)
    returning id into parent;
  v := public.create_visit(parent, '2026-07-11', '2026-07-16', null, array[a_id]::uuid[]);

  child := public.add_place_to_visit(v.id, 'restaurant', 'T192 Ocean Pub', null, null,
                                     'k192-a', '2026-07-13');

  select count(*) into n from public.place_membership
   where child_id = child.id and parent_id = parent;
  if n <> 1 then
    raise exception 'FAIL: add_place_to_visit wrote % membership rows, expected 1', n; end if;

  select part_of into arr from public.places where id = child.id;
  if not (parent = any(coalesce(arr, '{}'::uuid[]))) then
    raise exception 'FAIL: the mirror did not follow add_place_to_visit';
  end if;
  raise notice 'PASS 4: adding a place to a visit writes the row and the array follows';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Nothing can contain itself, whichever door it comes through.
-- ---------------------------------------------------------------------------
do $$
declare p uuid; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T192 Alone', 40.0, -75.0, true)
    returning id into p;
  perform public.add_to_container(p, p);
  select count(*) into n from public.place_membership where child_id = p and parent_id = p;
  if n <> 0 then raise exception 'FAIL: a place was put inside itself'; end if;
  raise notice 'PASS 5: a place cannot contain itself';
end $$;

-- ---------------------------------------------------------------------------
-- 6. The old direction is gone. If both triggers existed they would fight,
--    and the row-writer would lose — silently, which is how 0164 went wrong.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and c.relname = 'places' and t.tgname = 'places_sync_membership';
  if n <> 0 then
    raise exception 'FAIL: places_sync_membership is still there and will delete rows again';
  end if;

  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and c.relname = 'place_membership'
     and t.tgname = 'membership_sync_part_of';
  if n <> 1 then raise exception 'FAIL: the new mirror trigger is missing'; end if;

  raise notice 'PASS 6: one direction only — rows to array';
end $$;

rollback;
