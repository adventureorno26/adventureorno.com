-- 0291 — a mountain is a fact; your tags are yours.
--
-- WHY THIS FILE EXISTS. 0291 was rehearsed against production inside `begin … rollback`,
-- and that rehearsal proves it is safe to run once on the data that exists today. It cannot
-- prove the RULE, for the same reason 0292's test file cannot: the interesting situation —
-- two spaces, each with its own copy of the same vocabulary, and an outing that has been
-- materialised into both — does not exist until the fork creates it. So this file builds it
-- by hand and asks the four questions that actually decide whether Josh keeps what he can
-- see today.
--
--   1. CAN a second space hold `slug = 'trail'` at all? Before 0291 the answer was no, and
--      that single fact is the whole reason his space had no category vocabulary.
--   2. Does a person in TWO spaces read ONE vocabulary? Josh is in both until 0292 removes
--      him. Under the old plural read rule, seeding his space would have doubled his picker
--      and made `.maybeSingle()` on `map_projection` error on a screen he uses.
--   3. Is a mountain readable by somebody who did not import it? `peaks` and `parks` leave
--      the space boundary here, and a fact nobody can read is not a fact.
--   4. THE ONE THAT MATTERS: does a COPIED outing in a second space still find the peak bag
--      that hangs off the original? All six of Josh's summits are a `peak_bags` row with
--      `profile_id` NULL on a both-tagged activity. 0292 copies the activity and moves no
--      bag, so without step 4's rule he reads zero peaks no matter what `peaks` looks like.
--
-- Each step that can be satisfied by accident has a NEGATIVE CONTROL that breaks the
-- mechanism and asserts the number moves. A test that cannot fail is not evidence.
--
-- NO PRODUCTION COUNT IS ASSERTED ANYWHERE HERE. `scripts/db-test.sh` replays the whole
-- chain from an EMPTY schema where every production total is 0, and "expected exactly N"
-- has broken CI on this repository twice. Every number below is about rows this file
-- inserted, identified by its own ids.
begin;

set local check_function_bodies = off;

-- ---- FIXTURES -------------------------------------------------------------
-- Two spaces and three people, arranged to mirror production exactly:
--
--   Ann  owns space ONE                          — Erica
--   Bo   EDITOR in space ONE, OWNER of space TWO — Josh, as he is today, in both
--   Cam  editor in space TWO only                — Josh, as he is after 0292 removes him
insert into auth.users (id, email) values
  ('a0291000-0000-0000-0000-0000000000a1','v0291-ann@example.test'),
  ('a0291000-0000-0000-0000-0000000000b2','v0291-bo@example.test'),
  ('a0291000-0000-0000-0000-0000000000c3','v0291-cam@example.test')
  on conflict do nothing;

insert into public.profiles (id, role, display_name) values
  ('a0291000-0000-0000-0000-0000000000a1','owner', 'V0291 Ann'),
  ('a0291000-0000-0000-0000-0000000000b2','editor','V0291 Bo'),
  ('a0291000-0000-0000-0000-0000000000c3','editor','V0291 Cam')
  on conflict (id) do nothing;

insert into public.spaces (id, name, owner_profile) values
  ('50291000-0000-0000-0000-000000000001','V0291 space one','a0291000-0000-0000-0000-0000000000a1'),
  ('50291000-0000-0000-0000-000000000002','V0291 space two','a0291000-0000-0000-0000-0000000000b2')
  on conflict do nothing;

-- `ensure_profile_space()` gives a new profile a space of its own, or joins the only one
-- there is. Clear what it decided and state the arrangement explicitly, exactly as 0289's
-- own test does — the fixture is the point, not the trigger's default.
delete from public.space_memberships where profile_id in (
  'a0291000-0000-0000-0000-0000000000a1',
  'a0291000-0000-0000-0000-0000000000b2',
  'a0291000-0000-0000-0000-0000000000c3');
insert into public.space_memberships (space_id, profile_id, role) values
  ('50291000-0000-0000-0000-000000000001','a0291000-0000-0000-0000-0000000000a1','owner'),
  ('50291000-0000-0000-0000-000000000001','a0291000-0000-0000-0000-0000000000b2','editor'),
  ('50291000-0000-0000-0000-000000000002','a0291000-0000-0000-0000-0000000000b2','owner'),
  ('50291000-0000-0000-0000-000000000002','a0291000-0000-0000-0000-0000000000c3','editor');

-- ---- 1. TWO SPACES, THE SAME SLUG -----------------------------------------
-- The thing that was physically impossible before 0291. `place_categories` was
-- `primary key (slug)`, so this second insert raised a unique violation and that is why the
-- fork could give Josh's space no vocabulary at all.
do $$
declare n int; conflicted boolean := false;
begin
  insert into public.place_categories
    (space_id, slug, label, icon, color, review, sort_order, is_custom)
  values
    ('50291000-0000-0000-0000-000000000001','v0291-trail','V0291 Trail','','#0d9488','V0291 Notes',900,true),
    ('50291000-0000-0000-0000-000000000002','v0291-trail','V0291 Trail','','#0d9488','V0291 Notes',900,true);

  select count(*) into n from public.place_categories where slug = 'v0291-trail';
  if n <> 2 then
    raise exception 'FAIL 1: two spaces cannot both hold slug v0291-trail (got % rows)', n;
  end if;

  -- NEGATIVE CONTROL. The key still binds INSIDE a space — this is a re-keying, not a
  -- loosening, and a per-space table that accepts the same slug twice in one space would be
  -- worse than the global key it replaced.
  begin
    insert into public.place_categories
      (space_id, slug, label, icon, color, review, sort_order, is_custom)
    values
      ('50291000-0000-0000-0000-000000000001','v0291-trail','V0291 Trail again','','#0d9488','V0291 Notes',900,true);
  exception when unique_violation then
    conflicted := true;
  end;
  if not conflicted then
    raise exception 'FAIL 1: the same slug was accepted twice in ONE space — the key no longer binds';
  end if;

  raise notice 'PASS 1: two spaces each hold their own v0291-trail, and neither may hold it twice';
end $$;

-- ---- 2. A PERSON IN TWO SPACES READS ONE VOCABULARY ------------------------
-- Bo is in BOTH spaces, which is exactly Josh's position until 0292 section 9 removes him.
-- Under `is_member(space_id)` he would read both copies of every tag. Under `home_space()`
-- he reads the space he OWNS, and reads it once.
do $$
declare n int; got uuid;
begin
  -- Both settings rows exist, one per space, with the same key. Also impossible before 0291.
  insert into public.settings (space_id, key, value) values
    ('50291000-0000-0000-0000-000000000001','v0291_projection','{"type":"globe"}'::jsonb),
    ('50291000-0000-0000-0000-000000000002','v0291_projection','{"type":"mercator"}'::jsonb);

  -- SETUP GUARD. If there were not two rows to choose between, the assertion below would
  -- pass for the wrong reason and prove nothing.
  select count(*) into n from public.settings where key = 'v0291_projection';
  if n <> 2 then
    raise exception 'FAIL 2 setup: expected two settings rows to choose between, got %', n;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub','a0291000-0000-0000-0000-0000000000b2','role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.place_categories where slug = 'v0291-trail';
  if n <> 1 then
    reset role;
    raise exception 'FAIL 2: a member of two spaces read % copies of one tag, not 1', n;
  end if;

  -- And it is HIS — the space he owns, not the one he is merely an editor in. This is the
  -- difference between Josh reading his own vocabulary and reading Erica's.
  select space_id into got from public.place_categories where slug = 'v0291-trail';
  if got <> '50291000-0000-0000-0000-000000000002' then
    reset role;
    raise exception 'FAIL 2: the tag he read came from space %, not the space he owns', got;
  end if;

  -- `settings` is the one that proves the rule rather than arguing it: the client reads the
  -- projection with `.maybeSingle()`, which ERRORS on more than one row.
  select count(*) into n from public.settings where key = 'v0291_projection';
  if n <> 1 then
    reset role;
    raise exception 'FAIL 2: map_projection returned % rows — .maybeSingle() would error', n;
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS 2: a member of two spaces reads one vocabulary, and it is the one he owns';
end $$;

-- ---- 3. A MOUNTAIN IS A FACT ----------------------------------------------
-- `peaks` and `parks` left the boundary in section 2 of the migration. The test of that is
-- not that the column is gone — section 8a of the migration asserts that — it is that
-- somebody who did not import the row can read it, and that `anon` still cannot.
--
-- The park is the sharper half. `set_place_park()` is `language plpgsql` and NOT SECURITY
-- DEFINER, so it reads `parks` under the CALLER'S OWN RLS. While parks were space-owned,
-- every place Cam created would have been stamped `park = null` — silently, with no error.
do $$
declare v_park text; n int;
begin
  insert into public.peaks (id, name, ele_m, lat, lng) values
    ('60291000-0000-0000-0000-000000000001','V0291 Old Rag', 998, 39.10, -77.20);

  insert into public.parks (id, name, boundary) values
    ('70291000-0000-0000-0000-000000000001','V0291 National Park',
     st_geomfromtext('MULTIPOLYGON(((-77.3 39.0, -77.1 39.0, -77.1 39.2, -77.3 39.2, -77.3 39.0)))', 4326));

  -- Cam is in space TWO only, and neither row above belongs to any space at all now.
  perform set_config('request.jwt.claims',
    json_build_object('sub','a0291000-0000-0000-0000-0000000000c3','role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.peaks where id = '60291000-0000-0000-0000-000000000001';
  if n <> 1 then
    reset role; raise exception 'FAIL 3: a member could not read a peak he did not import';
  end if;

  insert into public.places (id, name, lat, lng, saved, space_id, created_by) values
    ('80291000-0000-0000-0000-000000000001','V0291 Trailhead', 39.10, -77.20, true,
     '50291000-0000-0000-0000-000000000002','a0291000-0000-0000-0000-0000000000c3');

  select park into v_park from public.places
   where id = '80291000-0000-0000-0000-000000000001';
  reset role;
  if v_park is distinct from 'V0291 National Park' then
    raise exception 'FAIL 3: a place created in the second space was stamped park = %, not the containing park', coalesce(v_park, 'NULL');
  end if;

  -- …and the gazetteer is still closed to a caller with no account. `anon` holds no grant
  -- on either table, so the honest assertion is that it cannot GET AT them — which is
  -- stronger than "it reads zero rows", and shows up as insufficient_privilege rather than
  -- as an empty result. Leaving the boundary must not have handed anything to the public.
  begin
    set local role anon;
    select count(*) into n from public.peaks where id = '60291000-0000-0000-0000-000000000001';
    reset role;
    if n <> 0 then raise exception 'FAIL 3: anon read % peaks', n; end if;
  exception when insufficient_privilege then
    reset role;
  end;

  begin
    set local role anon;
    select count(*) into n from public.parks where id = '70291000-0000-0000-0000-000000000001';
    reset role;
    if n <> 0 then raise exception 'FAIL 3: anon read % parks', n; end if;
  exception when insufficient_privilege then
    reset role;
  end;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS 3: a member reads a peak and a park nobody filed in his space, anon reads neither, and his new place is stamped with the park that contains it';
end $$;

-- ---- 4. A COPIED OUTING STILL FINDS ITS PEAK BAG ---------------------------
-- THIS IS JOSH'S SIX. Measured on production: every one of his summits is a `peak_bags` row
-- with `profile_id` NULL, hanging off an activity Erica owns with Josh in `also_profiles`.
-- 0292 moves bags with `where profile_id = josh`, which matches NOTHING, and copies the
-- activity into his space with a fresh id and no bag attached. So the fixture is exactly
-- that: the bag stays with the original in space one, and the copy in space two has none.
do $$
declare n int;
begin
  insert into public.activities
    (id, type, name, distance, start_date, lat, lng, place_id, source, owner_profile,
     shared_group_id, space_id)
  values
    ('90291000-0000-0000-0000-000000000001','Hike','V0291 the same hike', 8000, now(), 39.10, -77.20,
     null,'manual','a0291000-0000-0000-0000-0000000000a1',
     '90291000-0000-0000-0000-000000000001','50291000-0000-0000-0000-000000000001'),
    ('90291000-0000-0000-0000-000000000002','Hike','V0291 the same hike', 8000, now(), 39.10, -77.20,
     null,'manual','a0291000-0000-0000-0000-0000000000a1',
     '90291000-0000-0000-0000-000000000001','50291000-0000-0000-0000-000000000002');

  -- The bag hangs off the ORIGINAL only, with profile_id NULL, and is filed in space one.
  insert into public.peak_bags (peak_id, activity_id, profile_id, place_id, space_id) values
    ('60291000-0000-0000-0000-000000000001','90291000-0000-0000-0000-000000000001', null, null,
     '50291000-0000-0000-0000-000000000001');

  -- SETUP GUARD. Cam must genuinely have no bag of his own in his own space, or step 4
  -- passes for the wrong reason.
  select count(*) into n from public.peak_bags
   where space_id = '50291000-0000-0000-0000-000000000002';
  if n <> 0 then
    raise exception 'FAIL 4 setup: the second space already holds % peak bags', n;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub','a0291000-0000-0000-0000-0000000000c3','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.peaks_bagged('a0291000-0000-0000-0000-0000000000c3')
   where id = '60291000-0000-0000-0000-000000000001';
  reset role;
  if n <> 1 then
    raise exception 'FAIL 4: the copied outing did not find its peak — this is Josh going 6 -> 0';
  end if;

  -- NEGATIVE CONTROL. Break the canonical key and the summit must disappear. `peaks_bagged`
  -- resolving through `coalesce(shared_group_id, id)` is the ONLY thing connecting Cam's
  -- copy to a bag filed in a space he is not in, so if the number survives this, step 4 was
  -- passing for some other reason and proves nothing.
  update public.activities set shared_group_id = null
   where id = '90291000-0000-0000-0000-000000000002';

  perform set_config('request.jwt.claims',
    json_build_object('sub','a0291000-0000-0000-0000-0000000000c3','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.peaks_bagged('a0291000-0000-0000-0000-0000000000c3')
   where id = '60291000-0000-0000-0000-000000000001';
  reset role;
  if n <> 0 then
    raise exception 'FAIL 4 control: the summit survived a broken canonical key, so step 4 proves nothing';
  end if;

  update public.activities set shared_group_id = '90291000-0000-0000-0000-000000000001'
   where id = '90291000-0000-0000-0000-000000000002';

  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS 4: a copied outing in a second space finds the peak bag left on the original, and stops finding it the moment the canonical key is broken';
end $$;

-- ---- 5. THE OWNER OF THE FIRST SPACE IS UNTOUCHED THROUGHOUT ---------------
-- The abort criterion is Erica's: *"Any row count that changes for either of them, on any
-- screen, that cannot be explained."* Ann is Erica in this fixture. Everything above added
-- rows to a SECOND space and rewrote the read rule; none of it may reach her.
do $$
declare n int; got uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','a0291000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.place_categories where slug = 'v0291-trail';
  if n <> 1 then
    reset role; raise exception 'FAIL 5: the first space''s owner reads % copies of her tag, not 1', n;
  end if;

  select space_id into got from public.place_categories where slug = 'v0291-trail';
  if got <> '50291000-0000-0000-0000-000000000001' then
    reset role; raise exception 'FAIL 5: she read the OTHER space''s tag';
  end if;

  select count(*) into n from public.settings where key = 'v0291_projection';
  if n <> 1 then
    reset role; raise exception 'FAIL 5: she reads % projection rows, not 1', n;
  end if;

  -- Her own summit is still hers, reached through the bag in her own space.
  select count(*) into n from public.peaks_bagged('a0291000-0000-0000-0000-0000000000a1')
   where id = '60291000-0000-0000-0000-000000000001';
  reset role;
  if n <> 1 then
    raise exception 'FAIL 5: the first space''s owner lost her summit';
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS 5: nothing the second space gained reached the first space''s owner — one tag, one projection, one summit, all still hers';
end $$;

do $$ begin
  raise notice 'PASS 0291: a mountain is a fact and every member can read it; a vocabulary is personal, one space holds one copy, and a person reads exactly one — and a copied outing keeps the summit that was bagged on the original';
end $$;

rollback;
