-- 0299 — an accepted tag becomes my own record.
--
-- LOCAL disposable stack only (scripts/db-test.sh). Replays from an EMPTY schema.
--
-- ⚠️ PRODUCTION'S `default_space()` IS INSTALLED BELOW and the file is worthless without it
-- (see 0295/0297): a replay keeps 0289's "biggest space" fallback, which fills `space_id`
-- non-null and, with two spaces, WRONG.
--
-- Two spaces that stay apart — so this file must NOT call test_support.share_one_space().
--
--   1. Accepting materialises a row owned by ME, in MY space.
--   2. IT STILL COUNTS ONCE. Both rows collapse to one `coalesce(shared_group_id, id)`.
--      This is the assertion the whole design turns on; without it the 15-mile run is 30.
--   3. THEIR DELETION CANNOT REACH IT. Delete the original card and mine survives.
--   4. Declining materialises nothing.
--   5. Accepting twice does not make a second copy.
--   6. Their route and their identity stayed theirs.
--
-- NOTE ON `reset role`. It is not enough on its own: `set local request.jwt.claims` is
-- TRANSACTION-scoped, so the caller stays in scope after the role is reset and the setup
-- writes below are then cross-space writes that 0293 correctly refuses. The claims are
-- cleared explicitly each time. This is the same trap 0295's test hit from the other side.

begin;

create or replace function public.default_space()
returns uuid language sql stable security definer set search_path to 'public' as $fn$
  select public.current_space();
$fn$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('a0299000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ann0299@x.test','x',now(),now()),
       ('a0299000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ben0299@x.test','x',now(),now());

insert into public.profiles (id, display_name, role) values ('a0299000-0000-0000-0000-000000000001','Ann 0299','owner');
insert into public.spaces (name, owner_profile) values ('0299 spare', null);
insert into public.profiles (id, display_name, role) values ('a0299000-0000-0000-0000-000000000002','Ben 0299','editor');

do $$
declare
  v_ann uuid := 'a0299000-0000-0000-0000-000000000001';
  v_ben uuid := 'a0299000-0000-0000-0000-000000000002';
  v_a_space uuid; v_b_space uuid;
  v_act uuid; v_subject uuid; v_ben_person uuid;
  v_mine uuid; v_group uuid; v_keys integer; v_n integer;
  v_poly text;
begin
  v_a_space := public.home_space_of(v_ann);
  v_b_space := public.home_space_of(v_ben);
  if v_a_space is null or v_b_space is null or v_a_space = v_b_space then
    raise exception 'FAIL: needed two distinct spaces, got % and %', v_a_space, v_b_space;
  end if;

  -- ANN'S 15-MILE RUN, in Ann's space, with a route of her own.
  insert into public.activities (type, name, distance, start_date, owner_profile, space_id,
                                 source, summary_polyline, strava_id)
  values ('Run', '0299 fifteen miles', 15.0, now(), v_ann, v_a_space, 'strava', 'ANNS_ROUTE', 902990001)
  returning id into v_act;

  v_subject := public.subject_for_activity(v_act);

  -- A person row in ANN's space that IS Ben, tagged proposed. This is the cross-account
  -- shape item 7b will produce; it is constructed by hand because 7b is not built yet.
  insert into public.people (display_name, kind, owner_profile, linked_profile, created_by, space_id)
  values ('Ben 0299', 'person', v_ann, v_ben, v_ann, v_a_space)
  returning id into v_ben_person;
  insert into public.memory_people (subject_id, person_id, participation_status, tagged_by, space_id)
  values (v_subject, v_ben_person, 'proposed', v_ann, v_a_space);

  -- 4. DECLINING FIRST — it must leave nothing of Ann's in Ben's space.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0299000-0000-0000-0000-000000000002","role":"authenticated"}';
  perform public.respond_to_memory_tag(v_subject, false);
  reset role;
  perform set_config('request.jwt.claims', '{}', true);  -- claims are TRANSACTION-scoped
  select count(*) into v_n from public.activities where space_id = v_b_space;
  if v_n <> 0 then raise exception 'FAIL: declining materialised % row(s)', v_n; end if;
  raise notice 'PASS 0299/4: declining materialises nothing';

  -- Put the tag back so it can be accepted.
  update public.memory_people set participation_status = 'proposed', decided_by = null, decided_at = null
   where subject_id = v_subject and person_id = v_ben_person;

  -- 1. ACCEPT.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0299000-0000-0000-0000-000000000002","role":"authenticated"}';
  perform public.respond_to_memory_tag(v_subject, true);
  reset role;
  perform set_config('request.jwt.claims', '{}', true);  -- claims are TRANSACTION-scoped

  select id into v_mine from public.activities where space_id = v_b_space;
  if v_mine is null then raise exception 'FAIL: accepting materialised nothing'; end if;
  if (select owner_profile from public.activities where id = v_mine) <> v_ben then
    raise exception 'FAIL: the materialised row is not owned by the accepter';
  end if;
  raise notice 'PASS 0299/1: accepting materialises a row owned by me, in my space';

  -- 2. IT STILL COUNTS ONCE.
  select coalesce(shared_group_id, id) into v_group from public.activities where id = v_act;
  select count(distinct coalesce(a.shared_group_id, a.id)) into v_keys
    from public.activities a where a.id in (v_act, v_mine);
  if v_keys <> 1 then
    raise exception 'FAIL: % canonical keys for one outing — 15 miles would count as 30', v_keys;
  end if;
  if (select sum(distance) from public.activities where id in (v_act, v_mine)) <> 30.0 then
    raise exception 'FAIL: the fixture is wrong — the two rows should hold 15 each';
  end if;
  raise notice 'PASS 0299/2: two rows, ONE canonical key — the 15-mile run counts once, not 30';

  -- 6. Their route and identity stayed theirs.
  select summary_polyline into v_poly from public.activities where id = v_mine;
  if v_poly is not null then raise exception 'FAIL: their route was copied into my space'; end if;
  if (select strava_id from public.activities where id = v_mine) is not null then
    raise exception 'FAIL: the copy carries their strava_id';
  end if;
  if (select place_id from public.activities where id = v_mine) is not null then
    raise exception 'FAIL: the copy points at a place in their space';
  end if;
  raise notice 'PASS 0299/6: their route, their strava id and their place stayed theirs';

  -- 5. Accepting again makes no second copy.
  update public.memory_people set participation_status = 'proposed'
   where subject_id = v_subject and person_id = v_ben_person;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0299000-0000-0000-0000-000000000002","role":"authenticated"}';
  perform public.respond_to_memory_tag(v_subject, true);
  reset role;
  perform set_config('request.jwt.claims', '{}', true);  -- claims are TRANSACTION-scoped
  select count(*) into v_n from public.activities where space_id = v_b_space;
  if v_n <> 1 then raise exception 'FAIL: accepting twice produced % rows', v_n; end if;
  raise notice 'PASS 0299/5: accepting twice does not make a second copy';

  -- 3. THEIR DELETION CANNOT REACH IT. This is the sentence the whole item exists for.
  delete from public.activities where id = v_act;
  select count(*) into v_n from public.activities where id = v_mine;
  if v_n <> 1 then
    raise exception 'FAIL: deleting THEIR card destroyed MY record — the tag was still hostage';
  end if;
  select count(*) into v_n
    from public.memory_people mp
    join public.memory_subjects s on s.id = mp.subject_id
   where s.kind = 'outing' and s.activity_id = v_mine and mp.participation_status = 'accepted';
  if v_n < 1 then raise exception 'FAIL: my row survived but my participation did not'; end if;
  raise notice 'PASS 0299/3: they deleted the card and MY record survived, still accepted';
end $$;

rollback;
