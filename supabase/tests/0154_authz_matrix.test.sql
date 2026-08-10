-- THE AUTHZ MATRIX — what each role may reach, asserted as a grid.
--
-- The backlog called this "pgTAP authz matrices". pgTAP is AVAILABLE on this project
-- (1.3.3) but deliberately NOT installed: it adds ~200 functions to a PRODUCTION
-- database purely so tests can say ok() instead of raise exception, and these tests
-- run against production inside a rolled-back transaction because there is no local
-- Docker. The grid is the deliverable; the framework is not. This matches the five
-- existing test files exactly.
--
-- What this guards, in one sentence: a table shipped without RLS, without a policy, or
-- reachable by the anon key that ships in the client bundle, is a bug — and it should
-- fail here rather than in the wild.
begin;

insert into auth.users (id, email) values
  ('aaaa7777-0000-0000-0000-00000000a154','v154-member@example.test'),
  ('bbbb7777-0000-0000-0000-00000000a154','v154-outsider@example.test')
  on conflict do nothing;
-- A member and a signed-in NON-member. The second is the interesting one: an account
-- exists, so auth.uid() is set, but there is no profiles row.
insert into public.profiles (id, role, display_name) values
  ('aaaa7777-0000-0000-0000-00000000a154','owner','V154 Member') on conflict do nothing;

-- Fixtures of our OWN, so the checks below hold in CI's empty disposable database as
-- well as against production. Asserting "a member sees more than 0 places" only worked
-- where production data happened to exist; a test that passes on one database and
-- fails on another is measuring the database, not the code.
insert into public.places (id, name, lat, lng, saved)
values ('cccc7777-0000-0000-0000-00000000a154','V154 Somewhere', 39.05, -77.31, true)
  on conflict do nothing;
insert into public.approved_fields (subject_type, subject_id, field, value, approved_by, via)
values ('place','cccc7777-0000-0000-0000-00000000a154','name',
        to_jsonb('V154 Somewhere'::text),'aaaa7777-0000-0000-0000-00000000a154','inbox')
  on conflict do nothing;

-- 1) EVERY TABLE HAS RLS. A new table without it is the whole ballgame.
do $$
declare bad text := '';
begin
  select string_agg(c.relname, ' ')
    into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not c.relrowsecurity
     -- PostGIS reference data (EPSG codes). Public by nature, none of it is hers.
     and c.relname <> 'spatial_ref_sys';
  if coalesce(bad, '') <> '' then
    raise exception 'FAIL: public tables without RLS: %', bad;
  end if;
  raise notice 'PASS 1: every public table has RLS enabled';
end $$;

-- 2) ANON REACHES NOTHING. The anon key is in the client bundle; treat it as public.
do $$
declare bad text := '';
begin
  -- has_table_privilege by OID, never by "public."||name: PostgreSQL is free to
  -- reorder WHERE clauses, so the name form got evaluated against catalog tables
  -- before the schema filter and blew up on "public.pg_statistic".
  select string_agg(format('%s(%s)', t.relname,
           concat_ws(',',
             case when has_table_privilege('anon', t.oid, 'SELECT') then 'select' end,
             case when has_table_privilege('anon', t.oid, 'INSERT') then 'insert' end,
             case when has_table_privilege('anon', t.oid, 'UPDATE') then 'update' end,
             case when has_table_privilege('anon', t.oid, 'DELETE') then 'delete' end)), ' ')
    into bad
    from (
      select c.oid, c.relname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'spatial_ref_sys'
    ) t
   where has_table_privilege('anon', t.oid, 'SELECT')
      or has_table_privilege('anon', t.oid, 'INSERT')
      or has_table_privilege('anon', t.oid, 'UPDATE')
      or has_table_privilege('anon', t.oid, 'DELETE');
  if coalesce(bad, '') <> '' then
    raise exception 'FAIL: anon still holds table grants: %', bad;
  end if;
  raise notice 'PASS 2: anon holds no grant on any public table';
end $$;

-- 3) THE SECRETS ARE SERVICE-ROLE ONLY — not even a signed-in owner may read them.
--    These hold OAuth refresh tokens and device ingest tokens; a leak is permanent.
do $$
declare t text; bad text := '';
begin
  foreach t in array array['google_tokens','strava_accounts','oauth_states'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    if has_table_privilege('authenticated', 'public.' || quote_ident(t), 'SELECT') then
      bad := bad || t || ' ';
    end if;
  end loop;
  if bad <> '' then
    raise exception 'FAIL: authenticated can read secret tables: %', bad;
  end if;
  raise notice 'PASS 3: token tables are service-role only';
end $$;

-- 4) THE LEDGER IS READ-ONLY FROM THE CLIENT. Every write goes through a SECDEF RPC,
--    because a decision that can be edited directly is not an audit trail.
do $$
declare t text; bad text := '';
begin
  foreach t in array array['suggestions','approved_fields','ingest_runs','naming_rules','approval_undo'] loop
    if not has_table_privilege('authenticated', 'public.' || quote_ident(t), 'SELECT') then
      bad := bad || t || '(no read) ';
    end if;
    if has_table_privilege('authenticated', 'public.' || quote_ident(t), 'INSERT')
    or has_table_privilege('authenticated', 'public.' || quote_ident(t), 'UPDATE')
    or has_table_privilege('authenticated', 'public.' || quote_ident(t), 'DELETE') then
      bad := bad || t || '(writable) ';
    end if;
  end loop;
  if bad <> '' then
    raise exception 'FAIL: ledger grants wrong: %', bad;
  end if;
  raise notice 'PASS 4: the ledger is member-readable and client-unwritable';
end $$;

-- 5) EVERY RLS TABLE EITHER HAS A POLICY OR IS UNREACHABLE. RLS with no policy and a
--    live grant denies everything — correct but by accident; assert it is deliberate.
do $$
declare bad text := '';
begin
  select string_agg(t.relname, ' ') into bad
    from (
      select c.oid, c.relname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
         and not exists (select 1 from pg_policies p
                          where p.schemaname = 'public' and p.tablename = c.relname)
    ) t
   where has_table_privilege('authenticated', t.oid, 'SELECT');
  if coalesce(bad,'') <> '' then
    raise exception 'FAIL: readable by authenticated but has no policy at all: %', bad;
  end if;
  raise notice 'PASS 5: no table is reachable with zero policies';
end $$;

-- 6) BEHAVIOUR, NOT JUST GRANTS. A signed-in NON-member sees nothing anywhere.
do $$
declare n bigint; bad text := ''; t text;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbb7777-0000-0000-0000-00000000a154"}';
  foreach t in array array['places','photos','visits','activities','entries','videos',
                           'location_pings','people','suggestions','approved_fields',
                           'naming_rules','settings','profiles'] loop
    execute format('select count(*) from public.%I', t) into n;
    if n <> 0 then bad := bad || format('%s=%s ', t, n); end if;
  end loop;
  if bad <> '' then
    raise exception 'FAIL: a signed-in non-member read rows: %', bad;
  end if;
  raise notice 'PASS 6: a session without a profile sees nothing';
end $$;
reset role;
set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000a154"}';

-- 7) NEGATIVE CONTROL. If test 6 passed because the tables are empty, it proved
--    nothing — so a real MEMBER must see rows through the very same policies.
do $$
declare n bigint;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000a154"}';
  -- The fixtures inserted at the top are enough on their own, so this holds anywhere.
  select count(*) into n from public.places
   where id = 'cccc7777-0000-0000-0000-00000000a154';
  if n = 0 then
    raise exception 'FAIL: a member cannot see a saved place — test 6 proved nothing';
  end if;
  select count(*) into n from public.approved_fields
   where subject_id = 'cccc7777-0000-0000-0000-00000000a154';
  if n = 0 then
    raise exception 'FAIL: a member cannot read the ledger — test 6 proved nothing';
  end if;
  raise notice 'PASS 7: a member reads through the same policies';
end $$;
reset role;
set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000a154"}';

-- 8) NO SECURITY DEFINER FUNCTION IS ANON-EXECUTABLE. 0093 established this; assert
--    it still holds, because a new SECDEF function grants EXECUTE to PUBLIC by default.
do $$
declare bad text := '';
begin
  select string_agg(distinct t.proname, ' ') into bad
    from (
      select p.oid, p.proname
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         -- Functions owned by an EXTENSION are not ours to re-grant. PostGIS installs
         -- st_estimatedextent as SECURITY DEFINER and anon-executable; it reads
         -- planner statistics for a table the caller must already be able to see, so
         -- it leaks nothing. 0093 reached the same conclusion.
         and not exists (
           select 1 from pg_depend d
            where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e')
    ) t
   where has_function_privilege('anon', t.oid, 'EXECUTE');
  if coalesce(bad,'') <> '' then
    raise exception 'FAIL: anon can execute SECURITY DEFINER functions: %', bad;
  end if;
  raise notice 'PASS 8: no SECDEF function is anon-executable';
end $$;

do $$ begin raise notice 'PASS: 0154 authz matrix'; end $$;
rollback;
