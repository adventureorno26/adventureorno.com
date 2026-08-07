-- DB test for 0123 — the OAuth token tables must be unreachable by any client role.
-- LOCAL disposable stack only.

begin;

-- 1) No client role may hold ANY privilege on either token table.
do $$
declare bad text;
begin
  select string_agg(format('%s->%s(%s)', table_name, grantee, privilege_type), ', ')
    into bad
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('google_tokens', 'strava_accounts')
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if bad is not null then
    raise exception 'FAIL: client roles still hold grants on the OAuth token tables: %', bad;
  end if;
  raise notice 'PASS 1: no anon/authenticated/PUBLIC grants on google_tokens or strava_accounts';
end $$;

-- 2) service_role keeps the access the Edge Functions need.
do $$
declare n int;
begin
  select count(*) into n
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('google_tokens', 'strava_accounts')
     and grantee = 'service_role'
     and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  if n < 8 then
    raise exception 'FAIL: service_role lost access the Edge Functions need (% of 8 grants)', n;
  end if;
  raise notice 'PASS 2: service_role retains full access';
end $$;

-- 3) RLS stays enabled with no permissive policy — deny-all by default, so even a
--    future accidental grant does not expose refresh tokens.
do $$
declare r record;
begin
  for r in
    select c.relname, c.relrowsecurity,
           (select count(*) from pg_policies p
             where p.schemaname='public' and p.tablename=c.relname) as policies
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname in ('google_tokens','strava_accounts')
  loop
    if not r.relrowsecurity then
      raise exception 'FAIL: RLS is off on %', r.relname;
    end if;
    if r.policies <> 0 then
      raise exception 'FAIL: % gained % policy/policies — token tables must stay deny-all',
        r.relname, r.policies;
    end if;
  end loop;
  raise notice 'PASS 3: RLS on and deny-all on both token tables';
end $$;

-- 4) The same lockdown still holds for oauth_states (0120), so this stays consistent.
do $$
declare bad text;
begin
  select string_agg(grantee, ', ') into bad
    from information_schema.role_table_grants
   where table_schema='public' and table_name='oauth_states'
     and grantee in ('anon','authenticated','PUBLIC');
  if bad is not null then
    raise exception 'FAIL: oauth_states regained client grants: %', bad;
  end if;
  raise notice 'PASS 4: oauth_states still locked down';
end $$;

do $$ begin raise notice 'PASS: 0123 OAuth token tables locked to service_role'; end $$;

rollback;
