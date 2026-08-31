-- 0292 — the same run, counted once.
--
-- WHY THIS FILE EXISTS, AND WHY THE PRODUCTION REHEARSAL WAS NOT ENOUGH.
--
-- 0292 was rehearsed against production inside `begin … rollback`: every number on Erica's
-- screens identical before and after, and Josh's My Stats identical too — 61 places,
-- 1468.4 miles, 30 trips, before and after the fork. That is the right measurement and it
-- proves the migration is safe TO RUN ONCE, on the data that exists today.
--
-- It cannot prove the RULE. The migration no-ops on an empty schema, so on the chain CI
-- replays it does nothing at all and every assertion inside it is skipped. So this file
-- builds the situation by hand and asks the question Erica actually asked:
--
--     "we ran 15 miles together, but for each of us and for Our Stats that should only
--      increase our milage by 15 miles not 30."
--
-- A materialised copy has a FRESH id. Every reader collapses outings on
-- `coalesce(shared_group_id, id)`. So a copy whose `shared_group_id` is NULL is a second
-- canonical key for one run, and the run counts twice. Step 2 asserts it counts once;
-- step 3 then BREAKS the tie deliberately and asserts the number doubles, because a test
-- that cannot fail is not evidence. Step 4 is the structural guard: nothing anywhere
-- references a row in another space.
--
-- NO PRODUCTION COUNT IS ASSERTED ANYWHERE HERE. `scripts/db-test.sh` replays the whole
-- chain from an EMPTY schema where every production total is 0, and "expected exactly N"
-- has broken CI on this repository twice. Every number below is about rows this file
-- inserted, identified by its own ids.
begin;

-- ---- FIXTURES -------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaa0291-0000-0000-0000-000000000001','v291-ann@example.test')
  on conflict do nothing;

insert into public.profiles (id, role, display_name) values
  ('aaaa0291-0000-0000-0000-000000000001','owner','V291 Ann')
  on conflict do nothing;

insert into public.spaces (id, name, owner_profile) values
  ('11110291-0000-0000-0000-000000000001','V291 space one','aaaa0291-0000-0000-0000-000000000001'),
  ('22220291-0000-0000-0000-000000000002','V291 space two', null)
  on conflict do nothing;

-- ANN IS IN BOTH. That is the fixture: it is the only arrangement in which one run can be
-- reached through two different rows, which is the situation a materialised copy creates
-- and the only one in which the dedupe key is load-bearing.
delete from public.space_memberships where profile_id = 'aaaa0291-0000-0000-0000-000000000001';
insert into public.space_memberships (space_id, profile_id, role) values
  ('11110291-0000-0000-0000-000000000001','aaaa0291-0000-0000-0000-000000000001','owner'),
  ('22220291-0000-0000-0000-000000000002','aaaa0291-0000-0000-0000-000000000001','owner');

-- One place in each space — the fork gives each space its own place row, so the copy of a
-- shared outing sits at the copy of the shared place.
insert into public.places (id, name, lat, lng, saved, space_id, created_by) values
  ('a1110291-0000-0000-0000-000000000001','V291 Trailhead', 39.10, -77.20, true,
   '11110291-0000-0000-0000-000000000001','aaaa0291-0000-0000-0000-000000000001'),
  ('b1110291-0000-0000-0000-000000000002','V291 Trailhead', 39.10, -77.20, true,
   '22220291-0000-0000-0000-000000000002','aaaa0291-0000-0000-0000-000000000001')
  on conflict do nothing;

-- Ann, as a person. SHE ALREADY HAS ONE — 0262 gives every account exactly one person row,
-- and `people` carries unique (owner_profile, linked_profile) with NO space_id in it, which
-- is the constraint 0292's rehearsal ran into. So there is exactly one row for her however
-- many spaces she is in, and this file must find it rather than make a second.
update public.people set space_id = '11110291-0000-0000-0000-000000000001'
 where linked_profile = 'aaaa0291-0000-0000-0000-000000000001';

-- ---- 1. ONE RUN, TWO ROWS -------------------------------------------------
-- 15 miles = 24140.16 metres. The original in space one; the materialised copy in space
-- two, with a fresh id and `shared_group_id` pointing at the original — which is exactly
-- what 0292 section 6 writes, and section 7 writes the same value back onto the original.
-- `original_source` is left NULL so `visible_activities`' Strava rule is not what is under
-- test here.
insert into public.activities
  (id, type, name, distance, start_date, lat, lng, place_id, source, owner_profile, shared_group_id, space_id)
values
  ('d1110291-0000-0000-0000-000000000001','Run','V291 the same run', 24140.16, now(), 39.10, -77.20,
   'a1110291-0000-0000-0000-000000000001','manual','aaaa0291-0000-0000-0000-000000000001',
   'd1110291-0000-0000-0000-000000000001','11110291-0000-0000-0000-000000000001'),
  ('d2220291-0000-0000-0000-000000000002','Run','V291 the same run', 24140.16, now(), 39.10, -77.20,
   'b1110291-0000-0000-0000-000000000002','manual','aaaa0291-0000-0000-0000-000000000001',
   'd1110291-0000-0000-0000-000000000001','22220291-0000-0000-0000-000000000002')
  on conflict do nothing;

-- Ann is on both rows. `activities_default_participants` may already have said so for the
-- owner; `on conflict do nothing` makes this indifferent to that, which is the same
-- accommodation 0292 makes.
insert into public.memory_people (subject_id, person_id, participation_status, evidence, created_by, space_id)
select public.subject_for_activity(a.id), pe.id,
       'accepted', 'own_recording', 'import', a.space_id
  from public.activities a
  cross join (select id from public.people
               where linked_profile = 'aaaa0291-0000-0000-0000-000000000001' limit 1) pe
 where a.id in ('d1110291-0000-0000-0000-000000000001','d2220291-0000-0000-0000-000000000002')
  on conflict do nothing;

-- THE SAME TRIGGERS 0292 TURNS OFF FIRE HERE, AND THIS IS WHAT THEY DO.
-- `activities_sync_visit` rebuilt each place's visits when the two rows above were
-- inserted, and `activities_default_participants` wrote a participation row of its own.
-- Both landed through `default_space()`, which has no caller here — so a visit derived from
-- space two's place, and a tag on a space-two subject, were filed in space one. Step 4
-- caught exactly that, on this file's own fixture, which is a fair demonstration of why the
-- migration disables them by name for the length of the copy.
--
-- Here they are simply put right: a derived row belongs with the row it was derived from.
update public.visits v set space_id = p.space_id
  from public.places p
 where p.id = v.place_id
   and p.space_id in ('11110291-0000-0000-0000-000000000001','22220291-0000-0000-0000-000000000002');

update public.memory_subjects s set space_id = a.space_id
  from public.activities a
 where a.id = s.activity_id
   and a.space_id in ('11110291-0000-0000-0000-000000000001','22220291-0000-0000-0000-000000000002');

update public.memory_subjects s set space_id = v.space_id
  from public.visits v
 where v.id = s.visit_id
   and v.space_id in ('11110291-0000-0000-0000-000000000001','22220291-0000-0000-0000-000000000002');

update public.memory_people mp set space_id = s.space_id
  from public.memory_subjects s
 where s.id = mp.subject_id
   and s.space_id in ('11110291-0000-0000-0000-000000000001','22220291-0000-0000-0000-000000000002');

-- ---- 2. THE RULE: FIFTEEN MILES, NOT THIRTY -------------------------------
set local request.jwt.claims = '{"sub":"aaaa0291-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  n_rows int;
  n_keys int;
  mi     numeric;
begin
  -- Both rows really are visible to her; if they were not, step 2 would pass for the wrong
  -- reason and prove nothing.
  select count(*) into n_rows from public.visible_activities
   where id in ('d1110291-0000-0000-0000-000000000001','d2220291-0000-0000-0000-000000000002');
  if n_rows <> 2 then
    raise exception 'FAIL setup: Ann can see % of the 2 rows for one run, so the dedupe is not being asked anything', n_rows;
  end if;

  -- One canonical key for the two rows.
  select count(distinct coalesce(shared_group_id, id)) into n_keys from public.activities
   where id in ('d1110291-0000-0000-0000-000000000001','d2220291-0000-0000-0000-000000000002');
  if n_keys <> 1 then
    raise exception 'FAIL: the two rows for one run carry % canonical keys, not 1', n_keys;
  end if;

  -- And the reader agrees. Filtered to this file's own outing, so nothing production holds
  -- can affect the number.
  select coalesce(sum(k.miles), 0) into mi
    from (select round((a.distance/1609.344)::numeric, 2) as miles
            from (select distinct on (coalesce(a.shared_group_id, a.id)) a.id, a.distance
                    from public.visible_activities a
                   where a.id in ('d1110291-0000-0000-0000-000000000001','d2220291-0000-0000-0000-000000000002')
                   order by coalesce(a.shared_group_id, a.id), a.id) a) k;

  if mi <> 15.00 then
    raise exception 'FAIL: one 15-mile run counted as % miles', mi;
  end if;
  raise notice 'PASS 0292 step 2: one run in two spaces counts once — % miles, not 30', mi;
end $$;

-- ---- 3. THE NEGATIVE CONTROL ----------------------------------------------
-- Break the tie the way a fork that forgot `shared_group_id` would break it, and prove the
-- number doubles. Without this, step 2 could be passing because the fixture is wrong.
do $$
declare mi numeric;
begin
  update public.activities set shared_group_id = null
   where id = 'd2220291-0000-0000-0000-000000000002';

  select coalesce(sum(k.miles), 0) into mi
    from (select round((a.distance/1609.344)::numeric, 2) as miles
            from (select distinct on (coalesce(a.shared_group_id, a.id)) a.id, a.distance
                    from public.visible_activities a
                   where a.id in ('d1110291-0000-0000-0000-000000000001','d2220291-0000-0000-0000-000000000002')
                   order by coalesce(a.shared_group_id, a.id), a.id) a) k;

  if mi <> 30.00 then
    raise exception 'FAIL: the negative control did not double (got % miles). Step 2 proves nothing '
                    'unless a copy with a NULL shared_group_id really is counted twice', mi;
  end if;
  raise notice 'PASS 0292 step 3: a copy with no shared_group_id doubles to % miles — the guard bites', mi;

  update public.activities set shared_group_id = 'd1110291-0000-0000-0000-000000000001'
   where id = 'd2220291-0000-0000-0000-000000000002';
end $$;

-- ---- 4. NOTHING THIS FILE PUT IN A SPACE REFERENCES A ROW IN ANOTHER ------
-- The structural invariant the fork exists to create, walked over the REAL foreign key
-- graph rather than a list somebody keeps up to date by hand: every single-column FK
-- between two space-owned tables must join rows that agree about their space.
--
-- SCOPED TO THIS FILE'S OWN TWO SPACES, and that is not timidity. Run unscoped against the
-- schema `scripts/db-bootstrap.sh` builds, it fails on three rows the BOOTSTRAP SEED itself
-- creates -- seeded rows land through `default_space()`, which answers differently before
-- and after the first profile exists, so a seeded parent and its child can disagree. That
-- is a real finding about the bootstrap and it is written down here, but it is not this
-- file's to assert: a test that fails on data it did not create is the "expected exactly N"
-- mistake in another costume, and that has broken CI on this repository twice.
--
-- `people` IS EXCLUDED, WITH A REASON. It carries unique (owner_profile, linked_profile)
-- and no space_id in that key, so one human has exactly ONE person row however many spaces
-- they are in -- this file's fixture deliberately has Ann's row in space one while she is
-- tagged on an outing in space two. The readers cope because `visit_profiles` and
-- `activity_profiles` join `people` unscoped and key on `linked_profile`. Making `people`
-- per-space is the follow-up migration 0292's header names; until then this cannot hold for
-- that one table, and pretending otherwise would be a lie in a test.
do $$
declare
  r record;
  n bigint;
  bad text := '';
begin
  for r in
    select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
           (select a.attname from unnest(c.conkey) k(att)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.att limit 1) as child_col,
           (select a.attname from unnest(c.confkey) k(att)
              join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.att limit 1) as parent_col
      from pg_constraint c
      join pg_class ch on ch.oid = c.conrelid
      join pg_namespace ns on ns.oid = ch.relnamespace
     where c.contype = 'f' and ns.nspname = 'public'
       and array_length(c.conkey, 1) = 1
       and c.confrelid::regclass::text <> 'people'
       and exists (select 1 from information_schema.columns ic
                    where ic.table_schema='public' and ic.table_name = c.conrelid::regclass::text
                      and ic.column_name = 'space_id')
       and exists (select 1 from information_schema.columns ic
                    where ic.table_schema='public' and ic.table_name = c.confrelid::regclass::text
                      and ic.column_name = 'space_id')
  loop
    execute format(
      'select count(*) from public.%I c join public.%I p on p.%I = c.%I
        where c.space_id is distinct from p.space_id
          and c.space_id in (%L, %L)',
      r.child, r.parent, r.parent_col, r.child_col,
      '11110291-0000-0000-0000-000000000001', '22220291-0000-0000-0000-000000000002') into n;
    if n > 0 then
      bad := bad || format('%s.%s -> %s (%s rows); ', r.child, r.child_col, r.parent, n);
    end if;
  end loop;

  if bad <> '' then
    raise exception 'FAIL: rows reference another space across the boundary: %', bad;
  end if;
  raise notice 'PASS 0292 step 4: nothing in either test space references a row in the other';
end $$;

rollback;
