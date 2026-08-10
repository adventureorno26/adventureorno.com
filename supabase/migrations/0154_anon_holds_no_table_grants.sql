-- ANON HOLDS NO TABLE GRANTS.
--
-- Rule #8 is "no public routes; every table has RLS requiring a profiles row", and
-- that has been true — but only at the RLS layer. Auditing the authz matrix showed
-- `anon` still held SELECT/INSERT/UPDATE/DELETE **grants** on ~35 public tables. Every
-- policy is written `to public` with an is_member()/is_owner() predicate, so anon is
-- refused by the predicate and no data has been exposed.
--
-- The problem is that it leaves exactly one thing standing between the anon key —
-- which ships in the client bundle and is readable by anyone — and the data: a
-- correctly-written USING clause on every table, forever. Migration 0093 already made
-- this argument for FUNCTIONS and revoked EXECUTE from anon on all 83 SECDEF ones.
-- Tables were never given the same treatment.
--
-- After this, a table shipped with a missing or wrong policy still fails closed for
-- anon, because anon cannot reach the table at all. Defence in depth, not a fix for a
-- live hole.
--
-- `authenticated` and `service_role` are untouched: the SPA and the edge functions
-- keep working exactly as they do now.

begin;

do $$
declare r record; n int := 0;
begin
  for r in
    select c.relname
      from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
     where n2.nspname = 'public'
       and c.relkind = 'r'
       -- PostGIS owns spatial_ref_sys; it is public reference data (EPSG codes), it
       -- contains nothing of Erica's, and it is not ours to re-grant.
       and c.relname <> 'spatial_ref_sys'
  loop
    execute format('revoke all on table public.%I from anon', r.relname);
    n := n + 1;
  end loop;
  raise notice 'revoked anon grants on % tables', n;
end $$;

-- THE LEDGER IS NOT DIRECTLY WRITABLE, at the grant layer either.
--
-- 0148/0149/0151 each did `revoke all ... from public, anon` and then granted SELECT
-- to authenticated — and that is not enough. Supabase's DEFAULT PRIVILEGES give
-- `authenticated` its own direct grant of ALL on new tables in this schema, and
-- revoking from PUBLIC does not touch a role's own grant. So every ledger table has
-- been INSERT/UPDATE/DELETE-able by any member at the privilege layer this whole time.
--
-- RLS still refused it — those tables have a SELECT policy and no write policy, so
-- writes were denied — which is why the 0148 test passed: an RLS refusal and a missing
-- grant both raise 42501, and that test could not tell them apart. The audit trail for
-- "a person decided this" should not rest on a single policy.
do $$
declare t text;
begin
  foreach t in array array['suggestions','approved_fields','ingest_runs',
                           'naming_rules','approval_undo'] loop
    execute format('revoke insert, update, delete, truncate on table public.%I from authenticated', t);
  end loop;
end $$;

-- Future tables too: stop the DEFAULT grant that hands anon access to anything
-- created later in this schema. Without this, the next `create table` silently
-- re-opens the door and only the policy stands again.
alter default privileges in schema public revoke all on tables from anon;

commit;
