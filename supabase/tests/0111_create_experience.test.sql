-- DB test for 0110 (people) + 0111 (create_experience) — Prompt 2B.
-- LOCAL disposable stack only. Exercises the REAL create_experience RPC and the
-- people/visit_people tables against every ADR example: the San Diego walk,
-- retry-after-partial-failure idempotency, planned→completed stop promotion,
-- non-login people attachment, rating attribution, and viewer permissions.

begin;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', 'ce-owner@example.test'),
  ('aaaaaaaa-0000-0000-0000-0000000000e2', 'ce-josh@example.test'),
  ('aaaaaaaa-0000-0000-0000-0000000000e3', 'ce-viewer@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', 'owner',  'CE Owner'),
  ('aaaaaaaa-0000-0000-0000-0000000000e2', 'editor', 'Josh'),
  ('aaaaaaaa-0000-0000-0000-0000000000e3', 'viewer', 'CE Viewer');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-0000000000e1"}';

-- 1) San Diego walk: a brand-new walk experience creates exactly ONE place and
--    ONE manual visit, attributed to "both", counted once.
do $$
declare r jsonb; v_place uuid; v_visit uuid;
begin
  r := public.create_experience('ce-sd-walk',
    jsonb_build_object('name','San Diego Bay Walk','lat',32.7157,'lng',-117.1611,
                       'categories', jsonb_build_array('walking')),
    jsonb_build_object('date','2026-03-14','who','both','note','morning stroll'));
  v_place := (r->>'place_id')::uuid; v_visit := (r->>'visit_id')::uuid;
  if v_place is null or v_visit is null then raise exception 'FAIL: null ids from create_experience'; end if;
  if (select count(*) from public.places where id=v_place) <> 1 then raise exception 'FAIL: not exactly one place'; end if;
  if (select count(*) from public.visits where place_id=v_place) <> 1 then raise exception 'FAIL: not exactly one visit'; end if;
  -- "Both" is now every member on the visit, not a null in a column (0188).
  if not exists (
    select 1 from public.visits v
     where v.id = v_visit and v.solo_override
       and (select count(*) from public.visit_profiles vp where vp.visit_id = v.id) =
           (select count(*) from public.profiles p
             where p.role in ('owner','editor') and coalesce(p.display_name,'') !~* '(test|bot)')
  ) then
    raise exception 'FAIL: "both" attribution not recorded'; end if;
  raise notice 'PASS 1: San Diego walk — one place, one visit, attributed both';
end $$;

-- 2) Retry after partial failure: the SAME idempotency key returns the SAME ids
--    and creates no duplicates.
do $$
declare r1 jsonb; r2 jsonb;
begin
  r1 := public.create_experience('ce-retry',
    jsonb_build_object('name','Retry Cove','lat',12.5,'lng',34.5), jsonb_build_object('date','2026-04-01'));
  r2 := public.create_experience('ce-retry',
    jsonb_build_object('name','Retry Cove','lat',12.5,'lng',34.5), jsonb_build_object('date','2026-04-01'));
  if (r2->>'place_id') <> (r1->>'place_id') or (r2->>'visit_id') <> (r1->>'visit_id') then
    raise exception 'FAIL: retry produced different ids'; end if;
  if (r2->>'idempotent')::boolean is not true then raise exception 'FAIL: retry not flagged idempotent'; end if;
  if (select count(*) from public.places where name='Retry Cove') <> 1 then raise exception 'FAIL: retry duplicated the place'; end if;
  if (select count(*) from public.visits v join public.places p on p.id=v.place_id where p.name='Retry Cove') <> 1 then
    raise exception 'FAIL: retry duplicated the visit'; end if;
  raise notice 'PASS 2: retry after partial failure — idempotent, no duplicates';
end $$;

-- 3) (retired) Planned → completed trip-stop promotion. trip_stops is gone with
--    migration 0137 — a trip is a visit you marked, and there is no stop to
--    promote. 0137's test asserts create_experience now REJECTS a trip link.

-- 4) Non-login people: a child attaches to a visit via person_ids.
do $$
declare v_kid uuid; r jsonb; v_visit uuid;
begin
  insert into public.people (display_name, kind) values ('Test Child','child') returning id into v_kid;
  r := public.create_experience('ce-people',
    jsonb_build_object('name','Zoo Day','lat',5,'lng',5),
    jsonb_build_object('date','2026-06-01','who','both','person_ids', jsonb_build_array(v_kid::text)));
  v_visit := (r->>'visit_id')::uuid;
  if not exists (select 1 from public.visit_people where visit_id=v_visit and person_id=v_kid) then
    raise exception 'FAIL: child not attached to visit'; end if;
  raise notice 'PASS 4: non-login person attached to a visit';
end $$;

-- 5) Rating attribution: rating lands in per-user place_ratings (and mirrors to
--    places.rating for the owner), never a blind places.rating write.
do $$
declare r jsonb; v_place uuid;
begin
  r := public.create_experience('ce-rating',
    jsonb_build_object('name','Rated Spot','lat',7,'lng',7),
    jsonb_build_object('date','2026-06-10','rating',5));
  v_place := (r->>'place_id')::uuid;
  if not exists (select 1 from public.place_ratings where place_id=v_place
                 and profile_id='aaaaaaaa-0000-0000-0000-0000000000e1' and rating=5) then
    raise exception 'FAIL: per-user rating not recorded'; end if;
  if (select rating from public.places where id=v_place) <> 5 then raise exception 'FAIL: owner rating mirror'; end if;
  raise notice 'PASS 5: rating recorded per-user and mirrored for owner';
end $$;

-- 6) Viewer permissions: a viewer (member, reaction-only) may NOT create, and RLS
--    forbids a viewer writing people directly, but a viewer MAY read people.
do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-0000000000e3"}', true);
  begin
    perform public.create_experience('ce-viewer', jsonb_build_object('name','Nope','lat',1,'lng',1),
                                      jsonb_build_object('date','2026-01-01'));
    raise exception 'FAIL: viewer was allowed to create an experience';
  exception when others then
    if sqlerrm !~ 'not authorized' then raise exception 'FAIL: unexpected viewer error: %', sqlerrm; end if;
  end;
  raise notice 'PASS 6a: viewer denied create_experience';
end $$;

-- RLS write-denial for a viewer (needs the authenticated role so RLS applies).
savepoint before_rls;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-0000000000e3"}';
do $$
begin
  begin
    insert into public.people (display_name, kind) values ('Viewer Kid','child');
    raise exception 'FAIL: viewer inserted a person (RLS not enforced)';
  exception when insufficient_privilege or others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  -- viewer CAN read people (is_member read policy)
  if (select count(*) from public.people) < 1 then raise exception 'FAIL: viewer cannot read people'; end if;
  raise notice 'PASS 6b: viewer cannot write people but can read them';
end $$;
reset role;
rollback to savepoint before_rls;

do $$ begin raise notice 'ALL PASS: create_experience + people (Prompt 2B ADR examples)'; end $$;

rollback;
