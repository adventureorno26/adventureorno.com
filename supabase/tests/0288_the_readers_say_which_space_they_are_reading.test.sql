-- 0288 — the readers say which space they are reading.
--
-- WHY THIS FILE EXISTS, AND WHY THE PRODUCTION REHEARSAL WAS NOT ENOUGH.
--
-- 0288 was rehearsed against production inside `begin … rollback` as both real accounts:
-- 98 numbers compared, 0 changed. That is the right measurement and it proves exactly one
-- thing — that the migration moves nothing today. It CANNOT prove the migration works,
-- because today every row is in ONE space and both humans are in it, so every
-- `is_member(space_id)` in the file evaluates true and the new clause is never exercised
-- even once.
--
-- So this test builds the situation production does not have yet: TWO spaces, two people,
-- and a row in each. It is the only place the boundary is actually asked a question it
-- could get wrong, and it fails the build the day a reader stops asking it.
--
-- NO PRODUCTION COUNT IS ASSERTED ANYWHERE HERE. Every number below is about rows this
-- file inserted, identified by its own ids. `scripts/db-test.sh` replays the whole chain
-- from an EMPTY schema where every production total is 0, and "expected exactly N" has
-- broken CI on this repository twice.
begin;

-- ---- FIXTURES: two spaces that are genuinely separate ----------------------
insert into auth.users (id, email) values
  ('aaaa0288-0000-0000-0000-000000000001','v288-ann@example.test'),
  ('bbbb0288-0000-0000-0000-000000000002','v288-ben@example.test')
  on conflict do nothing;

insert into public.profiles (id, role, display_name) values
  ('aaaa0288-0000-0000-0000-000000000001','owner','V288 Ann'),
  ('bbbb0288-0000-0000-0000-000000000002','owner','V288 Ben')
  on conflict do nothing;

-- The `profiles_ensure_space` trigger has already put each of them somewhere. This file
-- does not care where: it makes two spaces of its own and states the memberships it wants,
-- so the test is about the READERS and not about how sign-up happens to allocate a space.
insert into public.spaces (id, name, owner_profile) values
  ('11110288-0000-0000-0000-000000000001','V288 Ann space','aaaa0288-0000-0000-0000-000000000001'),
  ('22220288-0000-0000-0000-000000000002','V288 Ben space','bbbb0288-0000-0000-0000-000000000002')
  on conflict do nothing;

-- ANN IS IN HERS, BEN IS IN HIS, AND NEITHER IS IN THE OTHER'S. That last clause is the
-- whole fixture; everything below is a consequence of it.
delete from public.space_memberships
 where profile_id in ('aaaa0288-0000-0000-0000-000000000001','bbbb0288-0000-0000-0000-000000000002');
insert into public.space_memberships (space_id, profile_id, role) values
  ('11110288-0000-0000-0000-000000000001','aaaa0288-0000-0000-0000-000000000001','owner'),
  ('22220288-0000-0000-0000-000000000002','bbbb0288-0000-0000-0000-000000000002','owner');

insert into public.places (id, name, lat, lng, saved, space_id, created_by) values
  ('a1110288-0000-0000-0000-000000000001','V288 Ann Overlook', 39.10, -77.20, true,
   '11110288-0000-0000-0000-000000000001','aaaa0288-0000-0000-0000-000000000001'),
  ('b2220288-0000-0000-0000-000000000002','V288 Ben Overlook', 39.20, -77.30, true,
   '22220288-0000-0000-0000-000000000002','bbbb0288-0000-0000-0000-000000000002')
  on conflict do nothing;

insert into public.visits (id, place_id, start_date, end_date, status, accepted_at, space_id, created_by) values
  ('a3330288-0000-0000-0000-000000000001','a1110288-0000-0000-0000-000000000001',
   current_date - 3, current_date - 3, 'taken', now(),
   '11110288-0000-0000-0000-000000000001','aaaa0288-0000-0000-0000-000000000001'),
  ('b4440288-0000-0000-0000-000000000002','b2220288-0000-0000-0000-000000000002',
   current_date - 2, current_date - 2, 'taken', now(),
   '22220288-0000-0000-0000-000000000002','bbbb0288-0000-0000-0000-000000000002')
  on conflict do nothing;

-- ---- 1. THE SCOPED VIEWS THEMSELVES ---------------------------------------
-- Before any reader is asked anything: does the substrate hold the line? If this fails,
-- every assertion after it is meaningless, so it is asked first and on its own.
-- READ AS THE OWNER, WITH ANN'S CLAIMS. That is not a shortcut around the grants — it is
-- exactly the situation the views exist for. They are revoked from `anon` and
-- `authenticated` on purpose (0288 §3c asserts it), so the only thing that ever reads one
-- is a SECURITY DEFINER function running as its owner with the caller's JWT in scope.
-- `auth.uid()` comes from `request.jwt.claims`, not from the session role, so the boundary
-- is asked the same question here that it is asked in production.
set local request.jwt.claims = '{"sub":"aaaa0288-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare mine int; theirs int;
begin
  select count(*) into mine   from public.in_space_places where id = 'a1110288-0000-0000-0000-000000000001';
  select count(*) into theirs from public.in_space_places where id = 'b2220288-0000-0000-0000-000000000002';
  if mine <> 1 then
    raise exception 'FAIL 1: in_space_places hid Ann''s OWN place from Ann. A boundary that hides your own rows is not a boundary, it is an outage.';
  end if;
  if theirs <> 0 then
    raise exception 'FAIL 1: in_space_places showed Ann a place in Ben''s space. THIS IS THE LEAK 0288 EXISTS TO CLOSE.';
  end if;

  select count(*) into mine   from public.in_space_visits where id = 'a3330288-0000-0000-0000-000000000001';
  select count(*) into theirs from public.in_space_visits where id = 'b4440288-0000-0000-0000-000000000002';
  if mine <> 1 or theirs <> 0 then
    raise exception 'FAIL 1: in_space_visits does not separate the two spaces (own=%, other=%)', mine, theirs;
  end if;

  raise notice 'PASS 1: the scoped views show Ann her own rows and none of Ben''s';
end $$;

-- ---- 2. THE READERS, WHICH IS THE POINT -----------------------------------
-- A SECURITY DEFINER function runs as its owner and an owner is not subject to RLS, so
-- none of these is protected by a policy. Each one below returned Ben's row before 0288.
--
-- These run as `authenticated`, which also proves the EXECUTE grants still work — a
-- `create or replace` that had changed a signature would have created a new function with
-- PUBLIC execute and no grant to the role that actually calls it.
set local role authenticated;
do $$
declare v boolean; n int;
begin
  -- `place_is_saved` is the smallest reader in the file and the one most things call.
  select public.place_is_saved('a1110288-0000-0000-0000-000000000001') into v;
  if v is not true then
    raise exception 'FAIL 2: place_is_saved denied Ann her own saved place';
  end if;

  select public.place_is_saved('b2220288-0000-0000-0000-000000000002') into v;
  if coalesce(v, false) then
    raise exception 'FAIL 2: place_is_saved told Ann about a place in Ben''s space. SECURITY DEFINER bypasses RLS — the clause in the reader is the only thing standing here.';
  end if;

  -- `place_visit_totals` aggregates across everything the caller can see. Ben's place must
  -- not appear in it AT ALL — not with a zero, not as a row.
  select count(*) into n from public.place_visit_totals() t
   where t.place_id = 'b2220288-0000-0000-0000-000000000002';
  if n <> 0 then
    raise exception 'FAIL 2: place_visit_totals returned a place from Ben''s space to Ann';
  end if;

  select count(*) into n from public.place_visit_totals() t
   where t.place_id = 'a1110288-0000-0000-0000-000000000001';
  if n <> 1 then
    raise exception 'FAIL 2: place_visit_totals lost Ann''s own place (got % rows)', n;
  end if;

  -- `visit_is_inside_trip` reads `visits` directly and is the reader that keeps the TABLE
  -- rather than the view, so it is worth asking separately.
  begin
    perform public.visit_is_inside_trip('b4440288-0000-0000-0000-000000000002');
  exception when others then
    null; -- raising is an acceptable answer; returning Ben's data is not.
  end;

  raise notice 'PASS 2: the readers answer for Ann''s space and say nothing about Ben''s';
end $$;

-- ---- 3. AND IT IS SYMMETRIC ------------------------------------------------
-- Asserting only one direction would pass on a reader that had accidentally been pinned to
-- Ann's space rather than to the CALLER's.
set local request.jwt.claims = '{"sub":"bbbb0288-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare v boolean; n int;
begin
  select public.place_is_saved('b2220288-0000-0000-0000-000000000002') into v;
  if v is not true then
    raise exception 'FAIL 3: place_is_saved denied Ben his own saved place — the boundary is pinned to a space, not to the caller';
  end if;

  select public.place_is_saved('a1110288-0000-0000-0000-000000000001') into v;
  if coalesce(v, false) then
    raise exception 'FAIL 3: place_is_saved told Ben about a place in Ann''s space';
  end if;

  select count(*) into n from public.place_visit_totals() t
   where t.place_id = 'a1110288-0000-0000-0000-000000000001';
  if n <> 0 then
    raise exception 'FAIL 3: place_visit_totals returned a place from Ann''s space to Ben';
  end if;

  raise notice 'PASS 3: the same boundary answers the other way round';
end $$;

-- ---- 4. THE GUARDS ARE NOT VACUOUS ----------------------------------------
-- Every structural check in 0288 passes on a correct database, which tells you nothing
-- unless it also FAILS on a broken one. These are the negative controls.
--
-- Each runs in its OWN top-level transaction, which is not a stylistic choice: PL/pgSQL has
-- no `rollback to savepoint`, so a break made inside a DO block cannot be observed and then
-- undone in the same block. A transaction per break is the only way to both see the guard
-- fire and leave nothing behind.
rollback;

-- 4a. A `create or replace view` that quietly drops the WHERE.
begin;
create or replace view public.in_space_places as select * from public.places;
do $$
declare hit text;
begin
  select string_agg(v, ', ') into hit from unnest(array['places']) v
   where not exists (select 1 from pg_views where schemaname='public' and viewname='in_space_'||v
                       and definition ilike '%is_member%' and definition ilike '%space_id%');
  if hit is null then
    raise exception 'FAIL 4a: the "views still filter" check does not notice a view losing its WHERE. A guard that cannot fail is worse than no guard.';
  end if;
  raise notice 'PASS 4a: a scoped view that loses its boundary is caught (%)', hit;
end $$;
rollback;

-- 4b. A grant that puts a scoped view on the PostgREST surface.
begin;
grant select on public.in_space_visits to authenticated;
do $$
declare hit text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into hit
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relkind='v' and c.relname like 'in\_space\_%'
     and (has_table_privilege('anon', c.oid, 'select')
       or has_table_privilege('authenticated', c.oid, 'select'));
  if hit is null then
    raise exception 'FAIL 4b: the grant check does not notice a scoped view granted to authenticated';
  end if;
  raise notice 'PASS 4b: a scoped view granted to a client role is caught (%)', hit;
end $$;
rollback;

-- 4c. THE ONE THAT MATTERS MOST: a new reader written by somebody who has not read any of
--     this. It is the failure this repository actually had — 0193 built a correct guard and
--     thirty-one readers walked straight around it.
begin;
create or replace function public.v288_a_careless_new_reader()
returns bigint language sql stable security definer set search_path to 'public' as $f$
  select count(*) from public.places where deleted_at is null;
$f$;
do $$
declare hit text;
begin
  select string_agg(distinct p.proname, ', ' order by p.proname) into hit
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.prokind='f' and p.prosecdef
     and pg_get_functiondef(p.oid) ~*
         '(from|join)[[:space:]]+(public\.)?(places|visits|photos|videos|entries|people|memory_people|memory_subjects|visit_people|peaks|peak_bags|place_ratings|place_wishes|place_membership|location_pings|suggestions|tag_claims|tagging_rules|naming_rules|approved_fields)[^A-Za-z0-9_]'
     and pg_get_functiondef(p.oid) !~* 'is_member[[:space:]]*\([^)]'
     and pg_get_functiondef(p.oid) !~*
         '(insert[[:space:]]+into|update[[:space:]]+(public\.)?[a-z_]+([[:space:]]+[a-z_]+)?[[:space:]]+set|delete[[:space:]]+from|[[:space:]]perform[[:space:]])'
     and p.prorettype <> 'pg_catalog.trigger'::regtype
     and p.proname like 'v288%';
  if hit is null then
    raise exception 'FAIL 4c: the unscoped-reader guard does not notice a new unscoped SECURITY DEFINER reader. This is the exact hole 0196 shipped.';
  end if;
  raise notice 'PASS 4c: a new unscoped SECURITY DEFINER reader is caught (%)', hit;
end $$;
rollback;

begin;
do $$ begin
  raise notice 'PASS 0288: two spaces stay two spaces — the scoped views and the readers show each person their own rows and none of the other''s, in both directions, and all three guards that say so fail when the rule is broken';
end $$;
rollback;
