-- 0298 — nobody joins somebody else's space.
--
-- LOCAL disposable stack only (scripts/db-test.sh). Replays from an EMPTY schema.
--
-- The hazard 0298 removes is invisible with two spaces and live with one, so the test has to
-- MANUFACTURE THE ONE-SPACE CASE — the state a restore produces — and show that a new
-- non-owner still does not land inside the existing space. Testing it with two spaces would
-- pass with 0298 reverted and prove nothing.
--
--   1. A fresh install: the first owner CLAIMS the unowned seeded space rather than
--      stranding its reference rows. (Kept deliberately; not the same as joining someone.)
--   2. WITH EXACTLY ONE SPACE, a new non-owner gets their OWN space — the hazard.
--   3. They own it, rather than arriving as somebody's editor.
--   4. Nobody's existing membership moved.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('a0298000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','own0298@x.test','x',now(),now()),
       ('a0298000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','new0298@x.test','x',now(),now());

do $$
declare
  v_owner uuid := 'a0298000-0000-0000-0000-000000000001';
  v_new   uuid := 'a0298000-0000-0000-0000-000000000002';
  v_before integer;
  v_spaces integer;
  v_owner_space uuid;
  v_new_space   uuid;
  v_new_role    text;
begin
  select count(*) into v_before from public.space_memberships;

  -- 1. The first owner claims the unowned seeded space.
  insert into public.profiles (id, display_name, role) values (v_owner, 'Owner 0298', 'owner');
  select m.space_id into v_owner_space from public.space_memberships m where m.profile_id = v_owner;
  if v_owner_space is null then
    raise exception 'FAIL: the first owner got no space at all';
  end if;
  raise notice 'PASS 0298/1: the first owner claims a space';

  -- THE STATE A RESTORE PRODUCES. Anything else and this test is vacuous.
  select count(*) into v_spaces from public.spaces;
  if v_spaces <> 1 then
    raise exception 'FAIL: needed exactly ONE space to test the hazard, found % — the test would prove nothing', v_spaces;
  end if;

  -- 2 + 3. A new non-owner arrives while exactly one space exists.
  insert into public.profiles (id, display_name, role) values (v_new, 'New 0298', 'editor');
  select m.space_id, m.role into v_new_space, v_new_role
    from public.space_memberships m where m.profile_id = v_new;

  if v_new_space is null then
    raise exception 'FAIL: the new profile got no space';
  end if;
  if v_new_space = v_owner_space then
    raise exception 'FAIL: a new non-owner LANDED IN THE EXISTING SPACE as % — this is the hazard', v_new_role;
  end if;
  raise notice 'PASS 0298/2: with exactly one space, a newcomer still gets their own';

  if v_new_role <> 'owner' then
    raise exception 'FAIL: they arrived as % of their own space, not owner', v_new_role;
  end if;
  raise notice 'PASS 0298/3: they own the space they got, rather than arriving as an editor';

  -- 4.
  if (select count(*) from public.space_memberships where profile_id not in (v_owner, v_new)) <> v_before then
    raise exception 'FAIL: an existing membership moved';
  end if;
  raise notice 'PASS 0298/4: no existing membership moved';
end $$;

rollback;
