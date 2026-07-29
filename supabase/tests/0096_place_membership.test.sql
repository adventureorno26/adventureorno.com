-- DB test for migration 0096 (place_membership canonicalization).
-- LOCAL disposable stack only. Fictional UUIDs, transaction-rolled-back.
-- Catches SPECIFIC exceptions (not `when others`, which would falsely pass on any
-- error). Trigger-raised errors are SQLSTATE P0001 → `when raise_exception`.

begin;

-- Two containers + one leaf. Container categories (city) keep holds_children=true
-- (a places trigger derives holds_children from the category).
insert into public.places (id, name, lat, lng, category, holds_children, saved) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Park',   10.0, 20.0, 'city',   true,  true),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Region', 10.1, 20.1, 'city',   true,  true),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Spot',   10.2, 20.2, 'dining', false, true);

-- Valid edge: Region under Park (parent Park is a container).
insert into public.place_membership (child_id, parent_id)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001');

-- relationship_type defaults to 'contains'.
do $$
begin
  if (select relationship_type from public.place_membership
      where child_id='aaaaaaaa-0000-0000-0000-000000000002'
        and parent_id='aaaaaaaa-0000-0000-0000-000000000001') <> 'contains' then
    raise exception 'FAIL: relationship_type default is not contains';
  end if;
end $$;

-- Negative assertions use an ok-flag set INSIDE the handler and checked OUTSIDE, so
-- the 'FAIL' raise can never be swallowed by the same handler.
-- Container enforcement: a NON-container parent (leaf) is rejected.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.place_membership (child_id, parent_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003');
  exception when raise_exception then ok := true;
  end;
  if not ok then raise exception 'FAIL: non-container parent was allowed'; end if;
end $$;

-- Self-reference rejected.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.place_membership (child_id, parent_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001');
  exception when raise_exception then ok := true;
  end;
  if not ok then raise exception 'FAIL: self-reference was allowed'; end if;
end $$;

-- Duplicate pair rejected (unique).
do $$
declare ok boolean := false;
begin
  begin
    insert into public.place_membership (child_id, parent_id)
    values ('aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001');
  exception when unique_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: duplicate pair was allowed'; end if;
end $$;

-- Cycle rejected: Park under Region (both containers) would close Region←Park.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.place_membership (child_id, parent_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002');
  exception when raise_exception then ok := true;
  end;
  if not ok then raise exception 'FAIL: cycle edge was allowed'; end if;
end $$;

-- FKs exist AND are validated (the container trigger fires before the FK, so this
-- is asserted via metadata rather than behaviorally).
do $$
begin
  if (select count(*) from pg_constraint
      where conname in ('place_membership_child_fk','place_membership_parent_fk') and convalidated) <> 2 then
    raise exception 'FAIL: place_membership FKs missing or not validated';
  end if;
end $$;

-- Hard-deleting the parent cascades its memberships.
delete from public.places where id='aaaaaaaa-0000-0000-0000-000000000001';
do $$
begin
  if exists (select 1 from public.place_membership
             where parent_id='aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'FAIL: membership not cascaded on parent delete';
  end if;
end $$;

-- Exceptions table has RLS + an editor/owner select policy (not readable by viewers).
do $$
begin
  if not (select relrowsecurity from pg_class where relname='place_membership_exceptions') then
    raise exception 'FAIL: place_membership_exceptions has no RLS';
  end if;
  if not exists (select 1 from pg_policies where tablename='place_membership_exceptions') then
    raise exception 'FAIL: place_membership_exceptions has no policy';
  end if;
end $$;

do $$ begin raise notice 'PASS: 0096 place_membership canonicalization tests'; end $$;

rollback;
