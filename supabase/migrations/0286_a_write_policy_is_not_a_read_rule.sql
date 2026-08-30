-- 0286 — the owner could see through a block, because a WRITE policy was doing READ duty.
--
-- Erica, 2026-08-30: *"Blocking is bidirectional."* And, ruling on the definer views the
-- same day: *"roles govern WRITES only; visibility belongs to the space boundary, never to
-- the role. Two parallel visibility systems is how this class of bug gets rebuilt."*
--
-- Both were violated by one policy. `0284` blocked reads correctly:
--
--     profiles_select   cmd=SELECT   id = auth.uid()
--                                    or (is_member() and not is_blocked_between(id, auth.uid()))
--
-- but `profiles_owner_write` is declared **cmd = ALL**, and FOR ALL INCLUDES SELECT. RLS
-- policies are OR-ed, so an owner matched `is_owner()` and read every profile regardless of
-- any block. Measured before this migration, with a block in place:
--
--     Josh  -> Erica   HIDDEN     (editor: the block held)
--     Erica -> Josh    VISIBLE    (owner: the block did not)
--
-- That is not a blocking bug; it is the same shape as `memory_subjects_write`, found hours
-- earlier on the same day — a policy written to govern writing, quietly deciding what may be
-- read. Postgres has no "FOR ALL EXCEPT SELECT", so the fix is to say the write commands out
-- loud and let `profiles_select` be the only thing that grants a read.
--
-- Nothing about who may WRITE changes: INSERT, UPDATE and DELETE still require `is_owner()`.

begin;

drop policy if exists profiles_owner_write on public.profiles;

create policy profiles_owner_insert on public.profiles
  for insert with check (public.is_owner());

create policy profiles_owner_update on public.profiles
  for update using (public.is_owner()) with check (public.is_owner());

create policy profiles_owner_delete on public.profiles
  for delete using (public.is_owner());

do $$
declare n int;
begin
  -- No policy on `profiles` may grant a read except the one that considers blocks.
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'profiles'
     and cmd in ('ALL','SELECT') and policyname <> 'profiles_select';
  if n <> 0 then
    raise exception '% policy/policies other than profiles_select can still grant a SELECT on profiles', n;
  end if;

  -- And the three write doors are still there.
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'profiles'
     and policyname in ('profiles_owner_insert','profiles_owner_update','profiles_owner_delete');
  if n <> 3 then
    raise exception 'expected the three owner write policies, found %', n;
  end if;
end $$;

commit;
