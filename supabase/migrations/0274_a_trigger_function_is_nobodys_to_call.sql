-- 0274 — take back the EXECUTE that `0273` handed out without meaning to.
--
-- `0273` created `visits_sync_place_visit_count()` as SECURITY DEFINER and stopped there.
-- Postgres default-grants EXECUTE on a new function to PUBLIC, so `anon` — an unauthenticated
-- caller — came away able to execute a definer function. `0154_authz_matrix.test.sql` failed
-- on exactly that, by name, in CI.
--
-- This is a REPEAT, not a novelty, and the repo already said so: `scripts/lockdown.sql`
-- opens with *"run after EVERY migration deploy (newly created SECURITY DEFINER functions
-- default-grant EXECUTE to PUBLIC, silently reopening what 0093/0105 closed — this happened
-- in 0101)"*, and `db-test.sh`'s guard prints *"run scripts/lockdown.sql after the offending
-- migration (and revoke anon in it)."* The instruction existed; 0273 did not follow it.
--
-- WHY IT WAS NOT ACTUALLY EXPLOITABLE, and why that is not a reason to leave it: calling
-- this function outside a trigger raises immediately — a plpgsql trigger function reads
-- `tg_op`, `old` and `new`, which do not exist in a direct call. So the practical risk was
-- nil. The rule is still worth keeping absolute, because "it happens to be harmless" is a
-- judgement someone has to re-make every time, and 0101 is what that costs.
--
-- WHY IT STAYS SECURITY DEFINER. The mirror has to be maintained no matter who writes the
-- visit. As INVOKER this would run under the writer's RLS on `public.places`, so whether the
-- count got fixed would depend on who did the writing — which is the class of bug 0273
-- exists to end, reintroduced through a different door.
--
-- REVOKING DOES NOT STOP THE TRIGGER. Postgres checks EXECUTE on a trigger function when the
-- trigger is CREATED, not each time it fires; the trigger already exists. Asserted below
-- rather than trusted, by counting on a table whose triggers fire under `authenticated`.

begin;

revoke execute on function public.visits_sync_place_visit_count() from public, anon;
-- Trigger functions get authenticated revoked too — the `ret = 'trigger'` branch in
-- scripts/lockdown.sql. Nobody calls this by hand; the table calls it.
revoke execute on function public.visits_sync_place_visit_count() from authenticated;

do $$
declare bad text;
begin
  -- The exact assertion 0154 makes, scoped to first-party functions. Extension-owned
  -- definers (PostGIS's st_estimatedextent) are excluded the same way 0154 excludes them.
  select string_agg(t.sig, ', ') into bad
    from (
      select p.oid, p.oid::regprocedure::text as sig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and not exists (
           select 1 from pg_depend d
            where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e')
    ) t
   where has_function_privilege('anon', t.oid, 'EXECUTE');
  if coalesce(bad, '') <> '' then
    raise exception 'anon can still execute SECURITY DEFINER function(s): %', bad;
  end if;

  if has_function_privilege('authenticated', 'public.visits_sync_place_visit_count()', 'EXECUTE') then
    raise exception 'authenticated can still execute the trigger function';
  end if;

  -- And the trigger is still attached and still covers all three operations, so this
  -- file cannot be read later as having quietly disarmed 0273.
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.visits'::regclass
       and t.tgname = 'visits_sync_place_visit_count'
       and not t.tgisinternal
       and (t.tgtype & 4) <> 0 and (t.tgtype & 8) <> 0 and (t.tgtype & 16) <> 0
  ) then
    raise exception 'the visit_count trigger is no longer attached for insert, delete and update';
  end if;
end $$;

commit;
