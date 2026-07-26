-- 0093 — Lock every SECURITY DEFINER function in `public` away from `anon` / PUBLIC.
--
-- Audit (2026-07-26) found 42 SECURITY DEFINER functions that `anon` could
-- EXECUTE. Because the publishable anon key ships in the client bundle, anyone
-- could call e.g. geo_coverage / mileage_by_person / trip_timeline / place_days
-- WITHOUT logging in and read private travel data — a direct violation of
-- business rule #8 (every page requires an authenticated session; no public
-- routes). SECURITY DEFINER functions bypass RLS, so the table policies do not
-- save us here.
--
-- Fix: every one of these functions ALSO carries an explicit `authenticated`
-- grant, so revoking EXECUTE from `anon` and PUBLIC closes the hole with zero
-- impact on the app (the SPA always operates as `authenticated`). Trigger
-- functions are revoked from `authenticated` too — triggers fire them as the
-- definer regardless of the caller's grants, so no role should call them
-- directly.
--
-- This is the ingest/read attack-surface half of the "Audit SECURITY DEFINER
-- functions" backlog item. Per-function is_member() body guards (defense in
-- depth against a logged-in-but-not-yet-member session) remain as follow-up;
-- with signups disabled and invite-only access, the only authenticated
-- principals today are members.

do $$
declare
  r record;
  is_trigger boolean;
begin
  for r in
    select p.oid,
           p.oid::regprocedure as sig,
           pg_get_function_result(p.oid) as result_type
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname <> 'st_estimatedextent'   -- PostGIS builtin, leave as shipped
  loop
    -- Always strip anonymous + PUBLIC access.
    execute format('revoke execute on function %s from anon', r.sig);
    execute format('revoke execute on function %s from public', r.sig);

    -- Trigger functions must not be directly callable by ANY client role.
    is_trigger := (r.result_type = 'trigger');
    if is_trigger then
      execute format('revoke execute on function %s from authenticated', r.sig);
    end if;
  end loop;
end $$;
