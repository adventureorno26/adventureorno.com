-- 0174 — the grants are closed, and creating/deleting/restoring a visit goes through
-- a function that knows the rules.
--
-- §0.9 requires these to be permanent, not remembered. Everything runs inside one
-- transaction and rolls back; nothing here touches real data.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('bbbb0174-0000-0000-0000-000000000001', 'a0174@example.invalid'),
  ('bbbb0174-0000-0000-0000-000000000002', 'b0174@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0174-0000-0000-0000-000000000001', 'A0174', 'owner'),
  ('bbbb0174-0000-0000-0000-000000000002', 'B0174', 'editor')
on conflict (id) do update set role = excluded.role;
set local request.jwt.claims = '{"sub":"bbbb0174-0000-0000-0000-000000000001"}';

-- ---------------------------------------------------------------------------
-- 1. NOBODY CAN EMPTY A TABLE. TRUNCATE ignores every RLS policy we have.
--
-- SCOPED TO WHAT WE OWN, and that scope is not a convenience. Applying 0174 to
-- production revealed three objects this cannot close: PostGIS's own
-- `spatial_ref_sys`, `geometry_columns` and `geography_columns`. They are owned by
-- `supabase_admin` and their grants were issued by `supabase_admin`, and Postgres only
-- lets the GRANTOR revoke — so `postgres`, which is what our migrations run as, cannot
-- touch them. An unscoped assertion passed locally (where PostGIS belongs to postgres)
-- and would have been a false all-clear about production.
--
-- They hold no data of ours. Truncating spatial_ref_sys would break coordinate
-- transforms until it were reloaded; it would not lose a single visit or photo.
-- ---------------------------------------------------------------------------
do $$
declare t text; bad text[] := '{}';
begin
  for t in
    select g.table_name
      from information_schema.role_table_grants g
      join pg_class c on c.relname = g.table_name
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where g.table_schema = 'public' and g.privilege_type = 'TRUNCATE'
       and g.grantee in ('authenticated','anon')
       and pg_get_userbyid(c.relowner) <> 'supabase_admin'   -- see the note above
  loop
    bad := bad || t;
  end loop;

  if array_length(bad,1) > 0 then
    raise exception 'FAIL: % of OUR table(s) still grant TRUNCATE to a browser role, e.g. %',
      array_length(bad,1), bad[1];
  end if;

  raise notice 'PASS 1: no table we own lets a browser role TRUNCATE';
end $$;

-- ---------------------------------------------------------------------------
-- 2. anon holds nothing, and a NEW table is closed by default — which is the
--    actual fix. Every migration used to have to remember to revoke.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n
    from information_schema.role_table_grants g
    join pg_class c on c.relname = g.table_name
    join pg_namespace nn on nn.oid = c.relnamespace and nn.nspname = 'public'
   where g.table_schema = 'public' and g.grantee = 'anon'
     and pg_get_userbyid(c.relowner) <> 'supabase_admin';   -- PostGIS's own, see part 1
  if n > 0 then raise exception 'FAIL: anon still holds % privilege(s) on our tables', n; end if;

  create table public.t0174_default_grants (id int);
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 't0174_default_grants' and grantee = 'anon';
  if n > 0 then
    raise exception 'FAIL: a NEW table was published to anon by default (% privileges)', n; end if;

  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 't0174_default_grants'
     and grantee = 'authenticated' and privilege_type = 'TRUNCATE';
  if n > 0 then raise exception 'FAIL: a NEW table granted TRUNCATE to authenticated'; end if;

  drop table public.t0174_default_grants;
  raise notice 'PASS 2: anon holds nothing and new tables arrive closed';
end $$;

-- ---------------------------------------------------------------------------
-- 3. create_visit validates, attributes, and cannot double-log a retry.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0174-0000-0000-0000-000000000001';
  p uuid; v public.visits; again public.visits; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T174 Place', 38.8, -77.1, true)
    returning id into p;

  v := public.create_visit(p, '2026-09-10', '2026-09-12', '  a note  ',
                           array[a_id]::uuid[], false, null, 'key-0174');
  if v.start_date <> '2026-09-10' or v.end_date <> '2026-09-12' then
    raise exception 'FAIL: the dates were not stored'; end if;
  if v.note <> 'a note' then raise exception 'FAIL: the note was not trimmed, got %', v.note; end if;
  if not v.manual then raise exception 'FAIL: a visit a person logged must be manual'; end if;

  select count(*) into n from public.visit_profiles where visit_id = v.id;
  if n <> 1 then raise exception 'FAIL: participants must be exactly what was asked for, got %', n; end if;

  -- a dropped connection, retried
  again := public.create_visit(p, '2026-09-10', '2026-09-12', 'a note',
                               array[a_id]::uuid[], false, null, 'key-0174');
  if again.id <> v.id then raise exception 'FAIL: a retry logged a SECOND visit'; end if;

  begin
    v := public.create_visit(p, '2026-09-12', '2026-09-10');
    raise exception 'FAIL: an inverted range was accepted';
  exception when others then
    if position('end date is before' in sqlerrm) = 0 then raise; end if;
  end;

  raise notice 'PASS 3: create_visit validates, attributes explicitly, and is idempotent';
end $$;

-- ---------------------------------------------------------------------------
-- 4. DELETING A TRIP MUST NOT SILENTLY ORPHAN WHAT WAS INSIDE IT.
--    parent_visit_id is ON DELETE SET NULL, so the database would have done it
--    quietly and returned success.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0174-0000-0000-0000-000000000001';
  tp uuid; cp uuid; tv public.visits; cv public.visits; snap jsonb; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T174 Trip', 41.7, -70.3, true)
    returning id into tp;
  insert into public.places (name, lat, lng, saved) values ('T174 Dinner', 41.6, -70.2, true)
    returning id into cp;

  tv := public.create_visit(tp, '2026-10-01', '2026-10-07', null, array[a_id]::uuid[]);
  cv := public.create_visit(cp, '2026-10-03', '2026-10-03', 'clam shack',
                            array[a_id]::uuid[], false, tv.id);
  if cv.parent_visit_id <> tv.id then raise exception 'FAIL: the child was not grouped'; end if;

  begin
    snap := public.delete_visit(tv.id);
    raise exception 'FAIL: deleting a trip with visits inside it was allowed silently';
  exception when others then
    if position('still contains' in sqlerrm) = 0 then raise; end if;
  end;

  -- saying so explicitly is allowed, and the child survives, unattached
  snap := public.delete_visit(tv.id, 'detach');
  if exists (select 1 from public.visits where id = tv.id) then
    raise exception 'FAIL: the trip was not deleted'; end if;
  if not exists (select 1 from public.visits where id = cv.id) then
    raise exception 'FAIL: deleting the trip must not delete what was inside it'; end if;
  if (select parent_visit_id from public.visits where id = cv.id) is not null then
    raise exception 'FAIL: the child should have been detached'; end if;

  -- ...and Undo puts the whole thing back, including the grouping
  tv := public.restore_visit(snap);
  if tv.start_date <> '2026-10-01' or tv.end_date <> '2026-10-07' then
    raise exception 'FAIL: restore lost the dates'; end if;
  select count(*) into n from public.visit_profiles where visit_id = tv.id;
  if n <> 1 then raise exception 'FAIL: restore lost the participants, got %', n; end if;
  if (select parent_visit_id from public.visits where id = cv.id) <> tv.id then
    raise exception 'FAIL: restore must put back what the trip contained'; end if;

  raise notice 'PASS 4: a delete cannot quietly orphan children, and Undo restores everything';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Evidence has a write path, and it is idempotent.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0174-0000-0000-0000-000000000001';
  p uuid; v public.visits; e public.visit_evidence; again public.visit_evidence;
  fake uuid := gen_random_uuid(); n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T174 Evidence', 39.0, -77.2, true)
    returning id into p;
  v := public.create_visit(p, '2026-11-02', null, null, array[a_id]::uuid[]);

  e := public.attach_visit_evidence(v.id, 'photo', fake, '2026-11-02', 'src-0174');
  if e.visit_id <> v.id then raise exception 'FAIL: evidence did not attach'; end if;

  again := public.attach_visit_evidence(v.id, 'photo', fake, '2026-11-02', 'src-0174');
  select count(*) into n from public.visit_evidence where visit_id = v.id;
  if n <> 1 then raise exception 'FAIL: a re-import duplicated the evidence, got % rows', n; end if;

  -- removing the reason must NOT remove the decision (§0.9)
  perform public.detach_visit_evidence(v.id, 'photo', fake);
  if not exists (select 1 from public.visits where id = v.id) then
    raise exception 'FAIL: detaching evidence deleted the visit'; end if;

  raise notice 'PASS 5: evidence attaches idempotently and the visit outlives it';
end $$;

-- ---------------------------------------------------------------------------
-- 6. None of the writers is reachable anonymously.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.create_visit(uuid,date,date,text,uuid[],boolean,uuid,text)', 'EXECUTE')
  or has_function_privilege('anon', 'public.delete_visit(uuid,text)', 'EXECUTE')
  or has_function_privilege('anon', 'public.restore_visit(jsonb)', 'EXECUTE')
  or has_function_privilege('anon', 'public.attach_visit_evidence(uuid,text,uuid,date,text)', 'EXECUTE') then
    raise exception 'FAIL: anon can write visits';
  end if;

  raise notice 'PASS 6: anon can reach none of the writers';
end $$;

rollback;
