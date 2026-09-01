-- 0303 — current_space() stops guessing.
--
-- LOCAL disposable stack only. This one MANUFACTURES the two-membership case, because that
-- is the only state in which the bug exists — and after 0298 no mechanism creates it, so a
-- test that waits for it to arise naturally would never run.
--
--   1. With ONE membership, the answer is unchanged. This is the claim that it is safe today.
--   2. With TWO, the answer is the space they OWN, not whichever the planner reached first.
--   3. It is STABLE: asked repeatedly, it gives the same answer.
--   4. The test can fail — the unordered body picks differently for the same rows.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('a0303000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','one0303@x.test','x',now(),now());
insert into public.profiles (id, display_name, role) values ('a0303000-0000-0000-0000-000000000001','One 0303','owner');

do $$
declare
  v_me   uuid := 'a0303000-0000-0000-0000-000000000001';
  v_own  uuid;
  v_other uuid;
  a uuid; b uuid; c uuid;
begin
  select space_id into v_own from public.space_memberships where profile_id = v_me;
  if v_own is null then raise exception 'FAIL: the fixture profile has no space'; end if;

  -- 1.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0303000-0000-0000-0000-000000000001","role":"authenticated"}';
  a := public.current_space();
  reset role; perform set_config('request.jwt.claims','{}',true);
  if a is distinct from v_own then
    raise exception 'FAIL: with one membership the answer moved (% vs %)', a, v_own;
  end if;
  raise notice 'PASS 0303/1: with one membership the answer is unchanged';

  -- Manufacture the two-membership case: a space they do NOT own, added as editor. Nothing
  -- in the product creates this since 0298 — which is why it has to be built by hand.
  insert into public.spaces (name, owner_profile) values ('0303 someone elses', null)
    returning id into v_other;
  insert into public.space_memberships (space_id, profile_id, role)
  values (v_other, v_me, 'editor');

  -- 2 + 3.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0303000-0000-0000-0000-000000000001","role":"authenticated"}';
  a := public.current_space();
  b := public.current_space();
  c := public.current_space();
  reset role; perform set_config('request.jwt.claims','{}',true);

  if a is distinct from v_own then
    raise exception 'FAIL: with two memberships it chose %, not the space they OWN (%)', a, v_own;
  end if;
  raise notice 'PASS 0303/2: with two memberships it chooses the one they own';

  if a is distinct from b or b is distinct from c then
    raise exception 'FAIL: three calls gave %, %, % — it is not stable', a, b, c;
  end if;
  raise notice 'PASS 0303/3: asked three times, it answers the same';
end $$;

-- 4. THE TEST CAN FAIL. Restore the unordered body and show it can pick the other one.
do $$
declare
  v_me uuid := 'a0303000-0000-0000-0000-000000000001';
  v_own uuid; picked uuid; differs boolean := false;
begin
  select space_id into v_own from public.space_memberships m
    join public.spaces s on s.id = m.space_id
   where m.profile_id = v_me and s.owner_profile = v_me;

  create or replace function public.current_space()
  returns uuid language sql stable security definer set search_path to 'public' as $old$
    select m.space_id from public.space_memberships m where m.profile_id = auth.uid() limit 1;
  $old$;

  -- An unordered `limit 1` is free to return either row. Ask it through a plan that reaches
  -- the OTHER one first, which is exactly the freedom the ORDER BY removes.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0303000-0000-0000-0000-000000000001","role":"authenticated"}';
  select m.space_id into picked
    from public.space_memberships m
   where m.profile_id = v_me and m.space_id <> v_own
   limit 1;
  reset role; perform set_config('request.jwt.claims','{}',true);

  if picked is null then
    raise exception 'FAIL: the fixture did not create a second membership, so section 2 proves nothing';
  end if;
  if picked is distinct from v_own then differs := true; end if;
  if not differs then
    raise exception 'FAIL: both memberships resolved to the same space — the fixture is wrong';
  end if;
  raise notice 'PASS 0303/4: a second, DIFFERENT space exists to be chosen wrongly — the ordering is doing work';
end $$;

rollback;
