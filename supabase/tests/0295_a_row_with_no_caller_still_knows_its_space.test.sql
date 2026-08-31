-- 0295 — a row with no caller still knows its space.
--
-- LOCAL disposable stack only (scripts/db-test.sh). Replays from an EMPTY schema, so
-- nothing here asserts a production count; every assertion is a relation between two
-- answers or a property of a row this transaction created.
--
-- ⚠️ THE ONE THING THIS FILE HAS TO DO THAT NO OTHER TEST DOES.
--
-- The bug 0295 fixes was invisible to CI because `default_space()` is a DIFFERENT FUNCTION
-- on production than in a replay. 0292 §8 replaces it inside the branch that actually
-- forks, and an empty schema never forks — so every existing test exercises the 0289 body
-- with its "biggest space" fallback, while production runs `select current_space()`.
--
-- So this file INSTALLS PRODUCTION'S BODY ITSELF, inside the transaction, and asserts
-- against that. Testing under the fallback would prove nothing: the fallback fills
-- `space_id` on its own and every assertion below would pass with 0295 deleted.
--
-- What is pinned here:
--
--   1. Under production's `default_space()`, a caller-less write with an owner column
--      lands in THAT OWNER's space — not "a" space, not the first one.
--   2. Two owners in two spaces do not collide. This is the assertion that would have
--      caught the old "biggest space" fallback, and it is why 0292 deleted it.
--   3. Creating a profile still works. `profile_self_person()` writes `public.people`
--      with no space of its own, so a new signup died on NOT NULL before 0295.
--   4. A SIGNED-IN caller is untouched — 0295 stands down and `default_space()` answers,
--      so this changes nothing for the app.
--   5. The test can fail. With the trigger disabled, section 1 raises.

begin;

-- Production's default_space(). See the header — without this the whole file is vacuous.
create or replace function public.default_space()
returns uuid language sql stable security definer set search_path to 'public' as $fn$
  select public.current_space();
$fn$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('a0295000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ann0295@x.test','x',now(),now()),
       ('a0295000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ben0295@x.test','x',now(),now());

-- ---------------------------------------------------------------------------
-- 3 first, because it is the one that has to succeed for the rest to exist.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.profiles (id, display_name, role)
  values ('a0295000-0000-0000-0000-000000000001','Ann 0295','owner');
  raise notice 'PASS: a profile can be created with no caller — profile_self_person() finds a space';
exception when not_null_violation then
  raise exception 'FAIL: creating a profile still dies on NOT NULL — %', sqlerrm;
end $$;

-- Ben gets his OWN space, so section 2 has two to tell apart. `ensure_profile_space()`
-- only hands a non-owner their own when more than one space exists, so make one first.
insert into public.spaces (name, owner_profile) values ('0295 second space', null);
do $$
begin
  insert into public.profiles (id, display_name, role)
  values ('a0295000-0000-0000-0000-000000000002','Ben 0295','editor');
end $$;

-- ---------------------------------------------------------------------------
-- 1 + 2. A caller-less write lands in ITS OWN owner's space, and two owners differ.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ann   uuid := 'a0295000-0000-0000-0000-000000000001';
  v_ben   uuid := 'a0295000-0000-0000-0000-000000000002';
  v_a_sp  uuid;
  v_b_sp  uuid;
  v_got_a uuid;
  v_got_b uuid;
begin
  v_a_sp := public.home_space_of(v_ann);
  v_b_sp := public.home_space_of(v_ben);
  if v_a_sp is null or v_b_sp is null then
    raise exception 'FAIL: a profile resolves to no space (ann=%, ben=%)', v_a_sp, v_b_sp;
  end if;

  -- Exactly what supabase/functions/ingest-overland/index.ts:125 writes.
  insert into public.location_pings (lat, lng, recorded_at, source, profile_id)
  values (39.1, -77.5, now(), '0295-test', v_ann) returning space_id into v_got_a;
  insert into public.location_pings (lat, lng, recorded_at, source, profile_id)
  values (40.1, -78.5, now(), '0295-test', v_ben) returning space_id into v_got_b;

  if v_got_a is distinct from v_a_sp then
    raise exception 'FAIL: Ann''s ping landed in %, not her space %', v_got_a, v_a_sp;
  end if;
  raise notice 'PASS: a caller-less ping lands in its own owner''s space';

  if v_a_sp is not distinct from v_b_sp then
    raise notice 'SKIP: both profiles resolved to one space — section 2 needs two';
  elsif v_got_b is not distinct from v_got_a then
    raise exception 'FAIL: two owners in two spaces both landed in % — this is the guess 0292 deleted', v_got_a;
  else
    raise notice 'PASS: two owners in two spaces do not collide';
  end if;

  -- The photo gateway (workers/photo-gateway/src/supa.ts:143) and strava-auth:86 —
  -- different owner columns, same rule.
  insert into public.photos (r2_key, thumb_key, sha256, width, height, uploaded_by, source)
  values ('k0295','t0295','sha0295',10,10, v_ann, 'shortcut') returning space_id into v_got_a;
  if v_got_a is distinct from v_a_sp then
    raise exception 'FAIL: a gateway photo landed in %, not %', v_got_a, v_a_sp;
  end if;

  insert into public.source_connections (provider, external_id, owner_profile, label, connected_at)
  values ('strava','0295', v_ben, 'Strava', now()) returning space_id into v_got_b;
  if v_got_b is distinct from v_b_sp then
    raise exception 'FAIL: a strava connection landed in %, not %', v_got_b, v_b_sp;
  end if;
  raise notice 'PASS: uploaded_by and owner_profile resolve the same way profile_id does';
end $$;

-- ---------------------------------------------------------------------------
-- 4. A SIGNED-IN caller is not touched. 0295 returns early; default_space() answers.
-- ---------------------------------------------------------------------------
do $$
declare v_got uuid; v_expect uuid;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0295000-0000-0000-0000-000000000001","role":"authenticated"}';
  v_expect := public.current_space();
  insert into public.location_pings (lat, lng, recorded_at, source, profile_id)
  values (41.0, -79.0, now(), '0295-authed', 'a0295000-0000-0000-0000-000000000001')
  returning space_id into v_got;
  reset role;
  if v_got is distinct from v_expect then
    raise exception 'FAIL: a signed-in write landed in %, not current_space() %', v_got, v_expect;
  end if;
  raise notice 'PASS: a signed-in caller is unaffected — default_space() still answers';
exception when others then
  reset role;
  raise;
end $$;

-- ---------------------------------------------------------------------------
-- 5. THE TEST CAN FAIL. Disable the trigger and watch section 1 break, so a green run
--    is evidence rather than a tautology.
-- ---------------------------------------------------------------------------
--    Section 4 used `set local request.jwt.claims`, which is TRANSACTION-scoped, not
--    block-scoped — it outlives the `do` block that set it. Leaving it set made the first
--    draft of this section pass with the trigger disabled, because `default_space()` was
--    still answering as Ann. The negative control caught its own test, which is the whole
--    argument for having one.
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- 6. Rows with no profile of their own, that are ABOUT something with a space.
--    purge_trash (04:30) and dedupe_joint_outings (04:20) write these nightly.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ann    uuid := 'a0295000-0000-0000-0000-000000000001';
  v_a_sp   uuid := public.home_space_of('a0295000-0000-0000-0000-000000000001');
  v_photo  uuid;
  v_act    uuid;
  v_got    uuid;
begin
  select id into v_photo from public.photos where r2_key = 'k0295';
  if v_photo is null then raise exception 'FAIL: section 1 photo missing'; end if;

  -- purge_trash -> purged_media, which names only the photo it is about.
  insert into public.purged_media (media_key, photo_id, sha256)
  values ('k0295', v_photo, 'sha0295') returning space_id into v_got;
  if v_got is distinct from v_a_sp then
    raise exception 'FAIL: purged_media landed in %, not the photo''s space %', v_got, v_a_sp;
  end if;
  raise notice 'PASS: a purged-media row inherits the space of the photo it is about';

  -- dedupe_joint_outings -> suggestions, polymorphic on subject_type.
  insert into public.activities (owner_profile, type, name, start_date)
  values (v_ann, 'Run', '0295 run', now()) returning id into v_act;
  insert into public.suggestions (subject_type, subject_id, field, proposed_value, label, source, group_key, rank)
  values ('activity', v_act, 'name', to_jsonb('Better name'::text), 'Call it Better name', '0295-test', '0295-group', 1)
  returning space_id into v_got;
  if v_got is distinct from v_a_sp then
    raise exception 'FAIL: a suggestion landed in %, not its subject''s space %', v_got, v_a_sp;
  end if;
  raise notice 'PASS: a suggestion inherits the space of the activity it is about';
end $$;

do $$
declare v_raised boolean := false;
begin
  if auth.uid() is not null then
    raise exception 'FAIL: a caller is still in scope (%), so this section would test nothing', auth.uid();
  end if;
  alter table public.location_pings disable trigger fill_space_from_the_row_owner;
  begin
    insert into public.location_pings (lat, lng, recorded_at, source, profile_id)
    values (42.0, -80.0, now(), '0295-red', 'a0295000-0000-0000-0000-000000000001');
  exception when not_null_violation then
    v_raised := true;
  end;
  alter table public.location_pings enable trigger fill_space_from_the_row_owner;
  if not v_raised then
    raise exception 'FAIL: with the trigger off the insert still succeeded — this test cannot fail, so it proves nothing';
  end if;
  raise notice 'PASS: with the trigger off the insert dies on NOT NULL — the test is real';
end $$;

rollback;
