-- scripts/lockdown.sql — repeatable SECDEF grant hygiene. Run after EVERY
-- migration deploy (newly created SECURITY DEFINER functions default-grant
-- EXECUTE to PUBLIC, silently reopening what 0093/0105 closed — this happened
-- in 0101). Idempotent; preserves authenticated access exactly where it exists.
do $do$
declare r record;
begin
  for r in
    select p.oid, p.oid::regprocedure as sig, p.prorettype::regtype::text as ret
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    if r.ret <> 'trigger' and has_function_privilege('authenticated', r.oid, 'execute') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    execute format('revoke execute on function %s from public, anon', r.sig);
    if r.ret = 'trigger' then
      execute format('revoke execute on function %s from authenticated', r.sig);
    end if;
  end loop;
end $do$;
-- CI assertion (run on the disposable stack; fails the build on regression):
--   select count(*) = 0 as ok
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   join pg_roles o on o.oid = p.proowner
--   where n.nspname = 'public' and p.prosecdef and o.rolname <> 'supabase_admin'
--     and has_function_privilege('anon', p.oid, 'execute');
