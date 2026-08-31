-- Test-harness prelude. NOT a test — `db-test.sh` globs `*.test.sql`, so this file is only
-- ever prepended, never run on its own. It defines helpers in a `test_support` schema that
-- exists ONLY in a disposable local stack; nothing here is in the migration chain and
-- nothing here reaches production.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS
-- ---------------------------------------------------------------------------
--
-- Until 0298, `ensure_profile_space()` ended with a heuristic: any new non-owner joined
-- "the" space whenever exactly one existed. Thirteen test files were written against that
-- and never said so — they create an owner, an editor and a viewer and then assert what each
-- may do to the SAME rows, which only means anything if the three share a space.
--
-- 0298 removed the heuristic, because it also meant that after any restore the next
-- non-owner to sign up silently became an EDITOR of whatever space happened to exist. The
-- product rule is now: nobody joins somebody else's space (Erica, 2026-08-31 — *"tagging is
-- the link"*).
--
-- So the fixture has to say what it needs. `share_one_space()` is that sentence, and making
-- it explicit is an improvement on its own: a test that depended on a trigger heuristic was
-- testing two things at once and only claiming to test one.
--
-- IT IS OPT-IN, DELIBERATELY. The space-boundary tests (0289, 0290, 0293, 0295, 0297, 0298)
-- need two spaces that stay apart, and calling this would destroy exactly what they check.

create schema if not exists test_support;

-- Collapse every profile into the OLDEST space, with each person's `profiles.role` as their
-- membership role. That is what the old heuristic did, said out loud.
create or replace function test_support.share_one_space()
returns void language plpgsql as $fn$
declare v_space uuid;
begin
  select id into v_space from public.spaces order by created_at, id limit 1;
  if v_space is null then
    raise exception 'share_one_space(): there are no spaces yet — call this AFTER creating the profiles';
  end if;

  delete from public.space_memberships m
   where m.space_id <> v_space;

  insert into public.space_memberships (space_id, profile_id, role)
  select v_space, p.id,
         case when p.role in ('owner','editor','viewer') then p.role else 'editor' end
    from public.profiles p
  on conflict (space_id, profile_id) do update set role = excluded.role;

  -- Any space that is now empty would otherwise leave `default_space()`'s CI fallback
  -- ("the space with the most members") picking between an occupied one and a husk.
  delete from public.spaces s
   where s.id <> v_space
     and not exists (select 1 from public.space_memberships m where m.space_id = s.id)
     and not exists (select 1 from public.places   p where p.space_id = s.id)
     and not exists (select 1 from public.visits   v where v.space_id = s.id);
end
$fn$;
