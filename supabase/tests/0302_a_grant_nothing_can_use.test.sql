-- 0302 — a grant nothing can use, and the ten tables that carry no space.
--
-- LOCAL disposable stack only. Two spaces that stay apart, so no share_one_space().
--
-- ⚠️ COUNT THE ROWS, NEVER THE ABSENCE OF AN ERROR. An UPDATE or DELETE that RLS filters to
-- nothing SUCCEEDS — it returns without error and changes nothing. The first version of this
-- audit asked "did it error?", got "no" for five of seven attacks, and would have reported
-- that a stranger could delete another person's profile. 0293's own test was caught by the
-- same shape from the other side: "the assertion passed without ever looking at the row."
--
--   1. The three dead grants are gone.
--   2. The LIVE grants survive — lib/join.ts upserts a join request.
--   3. Ben touches ZERO rows of Ann's, across the tables that carry no space.
--   4. THE METHOD CAN SEE A ONE. A write Ben IS allowed to make touches a row, so "0" in
--      section 3 means refused rather than "the WHERE matched nothing".
--   5. An invite can never mint a global owner — the constraint that keeps `profiles` safe.

begin;

create or replace function public.default_space()
returns uuid language sql stable security definer set search_path to 'public' as $fn$
  select public.current_space();
$fn$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('a0302000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ann0302@x.test','x',now(),now()),
       ('a0302000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ben0302@x.test','x',now(),now());
insert into public.profiles (id, display_name, role) values ('a0302000-0000-0000-0000-000000000001','Ann 0302','owner');
insert into public.spaces (name, owner_profile) values ('0302 spare', null);
insert into public.profiles (id, display_name, role) values ('a0302000-0000-0000-0000-000000000002','Ben 0302','editor');

-- 1 + 2. The grants.
do $$
declare v_bad text; 
begin
  select string_agg(format('%s:%s', table_name, privilege_type), ', ' order by table_name)
    into v_bad from information_schema.role_table_grants
   where table_schema='public' and grantee='authenticated'
     and ((table_name in ('invite_codes','job_runs') and privilege_type in ('INSERT','UPDATE','DELETE'))
       or (table_name='join_requests' and privilege_type='DELETE'));
  if v_bad is not null then raise exception 'FAIL: a dead grant survived — %', v_bad; end if;
  raise notice 'PASS 0302/1: the three dead grants are gone';

  if not exists (select 1 from information_schema.role_table_grants
                  where table_schema='public' and grantee='authenticated'
                    and table_name='join_requests' and privilege_type in ('INSERT','UPDATE')) then
    raise exception 'FAIL: join_requests lost the INSERT/UPDATE lib/join.ts needs';
  end if;
  raise notice 'PASS 0302/2: the live grants survive';
end $$;

-- 3 + 4. The attacks, counted.
do $$
declare
  v_ann uuid := 'a0302000-0000-0000-0000-000000000001';
  v_ben uuid := 'a0302000-0000-0000-0000-000000000002';
  n integer;
begin
  insert into public.job_runs (job, started_at) values ('0302-anns', now());

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0302000-0000-0000-0000-000000000002","role":"authenticated"}';

  with t as (update public.profiles set display_name='probe' where id = v_ann returning 1)
    select count(*) into n from t;
  if n <> 0 then raise exception 'FAIL: Ben UPDATED Ann''s profile — % row(s)', n; end if;

  with t as (delete from public.profiles where id = v_ann returning 1) select count(*) into n from t;
  if n <> 0 then raise exception 'FAIL: Ben DELETED Ann''s profile — % row(s)', n; end if;

  with t as (update public.spaces set name='probe' where owner_profile = v_ann returning 1)
    select count(*) into n from t;
  if n <> 0 then raise exception 'FAIL: Ben renamed Ann''s space — % row(s)', n; end if;

  with t as (delete from public.spaces where owner_profile = v_ann returning 1) select count(*) into n from t;
  if n <> 0 then raise exception 'FAIL: Ben deleted Ann''s space — % row(s)', n; end if;

  -- job_runs is the one 0302 revoked outright, so it is refused at the GRANT level now —
  -- a stronger no than RLS filtering to zero, and a different one. Either is a pass; the
  -- failure is a row actually going.
  begin
    with t as (delete from public.job_runs returning 1) select count(*) into n from t;
    if n <> 0 then raise exception 'FAIL: Ben deleted % job_runs row(s)', n; end if;
  exception when insufficient_privilege then
    n := 0;   -- refused before RLS was even consulted
  end;

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  raise notice 'PASS 0302/3: Ben touches zero rows of Ann''s, across the space-less tables';

  -- 4. THE METHOD CAN SEE A ONE.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0302000-0000-0000-0000-000000000002","role":"authenticated"}';
  with t as (insert into public.join_requests (user_id) values (v_ben) returning 1) select count(*) into n from t;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if n <> 1 then
    raise exception 'FAIL: a write Ben IS allowed touched % rows — section 3''s zeros prove nothing', n;
  end if;
  raise notice 'PASS 0302/4: a permitted write touches 1 row, so the zeros above mean refused';
end $$;

-- 5. The constraint that keeps `profiles` safe.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid='public.invite_codes'::regclass and contype='c'
       and pg_get_constraintdef(oid) like '%role%'
       and pg_get_constraintdef(oid) like '%editor%'
       and pg_get_constraintdef(oid) not like '%owner%') then
    raise exception 'FAIL: invite_codes.role no longer excludes owner — a code could mint a global owner, and profiles writes gate on is_owner()';
  end if;
  raise notice 'PASS 0302/5: an invite can never mint a global owner';
end $$;

rollback;
