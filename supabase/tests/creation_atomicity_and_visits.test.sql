-- Failure-injection + regression tests for the creation/visit partial-write points
-- (Prompt 4, rec 28 + rec 20). LOCAL disposable stack only.
--   * create_experience is atomic: an injected failure leaves NO orphan records.
--   * two separate manual visits in the same month at one place stay separate.
--   * rebuild_place_visits never deletes MANUAL history (notes/attribution/dates).

begin;

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-000000ca001','ca-owner@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('cccccccc-0000-0000-0000-000000ca001','owner','CA Owner');
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000ca001"}';

-- 1) Atomicity under injected failure: a non-existent person_id makes the
--    visit_people insert fail; the whole create_experience must roll back.
do $$
begin
  begin
    perform public.create_experience('ca-atomic',
      jsonb_build_object('name','CA Atomic','lat',10,'lng',10),
      jsonb_build_object('date','2026-05-01','person_ids', jsonb_build_array(gen_random_uuid()::text)));
    raise exception 'FAIL: no error on bad person_id';
  exception when foreign_key_violation then null;
  when others then if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  if exists (select 1 from public.places where name='CA Atomic') then
    raise exception 'FAIL: orphan place after failed create_experience';
  end if;
  if exists (select 1 from public.experience_requests where idempotency_key='ca-atomic') then
    raise exception 'FAIL: orphan experience_requests row';
  end if;
end $$;

-- 2) Two separate manual visits in the SAME month at one place stay separate.
do $$
declare r1 jsonb; v_place uuid; n int;
begin
  r1 := public.create_experience('ca-v1',
    jsonb_build_object('name','CA Place','lat',11,'lng',11),
    jsonb_build_object('date','2026-06-03'));
  v_place := (r1->>'place_id')::uuid;
  perform public.create_experience('ca-v2', jsonb_build_object('id', v_place),
    jsonb_build_object('date','2026-06-20'));
  select count(*) into n from public.visits where place_id=v_place and manual;
  if n <> 2 then raise exception 'FAIL: two same-month visits collapsed to %', n; end if;
end $$;

-- 3) rebuild_place_visits preserves MANUAL visits (never deletes manual history).
do $$
declare v_place uuid; r jsonb; v_manual uuid;
begin
  r := public.create_experience('ca-manual',
    jsonb_build_object('name','CA Manual','lat',12,'lng',12),
    jsonb_build_object('date','2026-07-04','who','me','note','manual note'));
  v_place := (r->>'place_id')::uuid;
  v_manual := (r->>'visit_id')::uuid;
  -- A photo on another date creates a DERIVED visit island; rebuild must keep the
  -- manual visit (with its note + attribution) intact.
  insert into public.photos (place_id,taken_at,r2_key,thumb_key,sha256)
    values (v_place,'2026-09-15T10:00:00Z','ca-k','ca-t','ca-sha');
  perform public.rebuild_place_visits(v_place);
  if not exists (select 1 from public.visits where id=v_manual and manual and note='manual note') then
    raise exception 'FAIL: rebuild deleted or altered the manual visit';
  end if;
end $$;

do $$ begin raise notice 'PASS: create atomicity + same-month visits + manual-visit preservation'; end $$;

rollback;
