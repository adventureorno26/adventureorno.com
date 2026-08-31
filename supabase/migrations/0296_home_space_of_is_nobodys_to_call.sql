-- 0296 — `home_space_of()` is nobody's to call.
--
-- APPLIED TO PRODUCTION 2026-08-31, rehearsed against production first in a transaction
-- forced to abort, with the grant re-checked afterwards to prove the rollback.
--
-- IT USED TO SAY: "DRAFT — REHEARSED LOCALLY, NOT APPLIED.
--
-- 0295 added `home_space_of(uuid)` and granted execute to `authenticated`. That grant was
-- copied from `default_space()` without asking whether it was needed, and it was not.
--
-- `default_space()` genuinely needs it: it is a COLUMN DEFAULT, and a default expression is
-- evaluated as the caller inserting the row. `home_space_of()` is different — it is only
-- ever called from inside `fill_space_from_the_row_owner()` and
-- `fill_space_from_the_parent_row()`, both of which are SECURITY DEFINER and therefore run
-- as the owner regardless of what the caller may execute. Nothing outside them calls it.
--
-- WHAT THE GRANT LET ANYBODY DO. `home_space_of(<profile>)` answers *"which space is this
-- person in"* for ANY profile id, and profile ids are discoverable — `find_profiles()`
-- (0287) is the directory and returns them. After the partition the space IS the boundary,
-- so the profile-to-space mapping is exactly the thing the boundary is made of. It is not a
-- data leak — no row of anybody's history comes back — but it is a fact about the shape of
-- the boundary handed to people who have no business with it, and 0289's whole argument is
-- that the boundary should be stated deliberately rather than fall out of a default.
--
-- NOTICED WHILE READING `npm run gen:types` — and the first version of this paragraph got
-- the reason wrong, which is worth recording rather than quietly fixing. It claimed the
-- new line `home_space_of: { Args: { p_profile: string }; Returns: string }` appeared
-- BECAUSE `authenticated` could execute it. That is false: `scripts/gen-types.mjs` calls
-- the Management API's `/types/typescript`, which generates from the CATALOGUE, not from
-- grants — the line appears because the function exists, and it is still there after this
-- migration revokes the grant. The types diff drew attention to the new function; reading
-- the grant is what found the fault. The fault was real either way.
--
-- 0295 IS NOT EDITED. It is applied and recorded, and a migration production has already
-- replayed stays byte-identical (`apply-migration.mjs` refuses a re-apply for the same
-- reason). The next numbered file corrects it, which is the house rule.
begin;

revoke all on function public.home_space_of(uuid) from public, anon, authenticated;
grant execute on function public.home_space_of(uuid) to service_role;

-- Say it out loud, and fail rather than drift. `has_function_privilege` is the same
-- question PostgREST asks, so this asserts precisely what the generated types will show.
do $do$
begin
  if has_function_privilege('authenticated', 'public.home_space_of(uuid)', 'execute')
     or has_function_privilege('anon', 'public.home_space_of(uuid)', 'execute') then
    raise exception '0296: home_space_of is still callable by a client role';
  end if;

  -- The trigger functions must keep working, and they will: they are SECURITY DEFINER and
  -- run as the owner. Asserted rather than assumed, because "it should still work" is how
  -- a revoke breaks an ingest path at 04:20 rather than at review time.
  if not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'fill_space_from_the_row_owner') then
    raise exception '0296: fill_space_from_the_row_owner is not SECURITY DEFINER — the revoke would break it';
  end if;

  raise notice '0296: home_space_of is service_role only; the definer triggers are unaffected';
end
$do$;

commit;
