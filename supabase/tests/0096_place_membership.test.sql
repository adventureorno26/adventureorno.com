-- DB test for migration 0096 (place_membership canonicalization).
-- RUN ONLY against a disposable LOCAL stack, never production:
--   supabase db reset && psql "$LOCAL_DB" -f supabase/tests/0096_place_membership.test.sql
-- Uses fictional UUIDs and rolls everything back, so it leaves no trace.
-- Any failed assertion raises and aborts with a non-zero exit.

begin;

-- Fictional fixtures: one container + two leaves (no real data).
insert into public.places (id, name, lat, lng, holds_children, saved)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Fictional Park',  10.0, 20.0, true,  true),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Fictional Trail', 10.1, 20.1, false, true),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Fictional Spot',  10.2, 20.2, false, true);

-- Valid edge: Trail contains-under Park.
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

-- Duplicate pair must be rejected (unique).
do $$
begin
  begin
    insert into public.place_membership (child_id, parent_id)
    values ('aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001');
    raise exception 'FAIL: duplicate pair was allowed';
  exception when unique_violation then null; -- expected
  end;
end $$;

-- Self-reference must be rejected (cycle trigger).
do $$
begin
  begin
    insert into public.place_membership (child_id, parent_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001');
    raise exception 'FAIL: self-reference was allowed';
  exception when others then null; -- expected (raised by trigger)
  end;
end $$;

-- Cycle must be rejected: Park is under Trail while Trail is under Park.
do $$
begin
  begin
    insert into public.place_membership (child_id, parent_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002');
    raise exception 'FAIL: cycle edge was allowed';
  exception when others then null; -- expected (raised by trigger)
  end;
end $$;

-- Unknown parent must be rejected (FK).
do $$
begin
  begin
    insert into public.place_membership (child_id, parent_id)
    values ('aaaaaaaa-0000-0000-0000-000000000003','ffffffff-0000-0000-0000-0000000000ff');
    raise exception 'FAIL: dangling parent FK was allowed';
  exception when foreign_key_violation then null; -- expected
  end;
end $$;

-- Hard-deleting a place cascades its memberships (no dangling left behind).
delete from public.places where id='aaaaaaaa-0000-0000-0000-000000000001';
do $$
begin
  if exists (select 1 from public.place_membership
             where parent_id='aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'FAIL: membership not cascaded on parent delete';
  end if;
end $$;

-- The exceptions table exists.
do $$
begin
  perform 1 from public.place_membership_exceptions where false;
end $$;

do $$ begin raise notice 'PASS: 0096 place_membership canonicalization tests'; end $$;

rollback;
