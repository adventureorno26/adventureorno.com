-- DB test for 0122 — the extended create_experience() place contract (Phase 2).
-- LOCAL disposable stack only. Proves the RPC can now express everything the nine
-- direct-insert client call sites needed, that the existing triggers still fire
-- identically, and that the guards it keeps are real.

begin;

insert into auth.users (id, email) values
  ('bbbbbbbb-0000-0000-0000-0000000000f1', 'ce122-owner@example.test'),
  ('bbbbbbbb-0000-0000-0000-0000000000f2', 'ce122-viewer@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('bbbbbbbb-0000-0000-0000-0000000000f1', 'owner',  'CE122 Owner'),
  ('bbbbbbbb-0000-0000-0000-0000000000f2', 'viewer', 'CE122 Viewer') on conflict do nothing;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-0000000000f1"}';

-- 1) is_trail — the MapView "draw a trail" and "add a trail container" paths.
--    The BEFORE trigger sync_place_category must still derive category/holds_children.
do $$
declare r jsonb; p uuid;
begin
  r := public.create_experience('ce122-trail',
    jsonb_build_object('name','Contract Trail','lat',38.9,'lng',-77.5,'is_trail',true),
    '{}'::jsonb);
  p := (r->>'place_id')::uuid;
  if not exists (select 1 from public.places where id=p and is_trail) then
    raise exception 'FAIL: is_trail not stored'; end if;
  if not exists (select 1 from public.places where id=p and category='trail') then
    raise exception 'FAIL: sync_place_category trigger did not derive category=trail'; end if;
  raise notice 'PASS 1: is_trail stored and category trigger fired';
end $$;

-- 2) bucket — the BucketMap / BucketList "want to go" paths.
do $$
declare r jsonb; p uuid;
begin
  r := public.create_experience('ce122-bucket',
    jsonb_build_object('name','Contract Bucket','lat',10.1,'lng',20.2,'bucket',true),
    '{}'::jsonb);
  p := (r->>'place_id')::uuid;
  if not exists (select 1 from public.places where id=p and bucket) then
    raise exception 'FAIL: bucket flag not stored'; end if;
  raise notice 'PASS 2: bucket flag stored';
end $$;

-- 3) needs_geocode — DayView/PhotoSorter "New place" awaiting the nightly geocoder.
do $$
declare r jsonb; p uuid;
begin
  r := public.create_experience('ce122-geocode',
    jsonb_build_object('name','New place','lat',44.4,'lng',-88.8,'needs_geocode',true),
    '{}'::jsonb);
  p := (r->>'place_id')::uuid;
  if not exists (select 1 from public.places where id=p and needs_geocode) then
    raise exception 'FAIL: needs_geocode not stored'; end if;
  raise notice 'PASS 3: needs_geocode stored';
end $$;

-- 4) part_of — PlacePanel addSpot creates a CHILD place. The AFTER trigger
--    sync_membership_from_part_of must materialise the membership row.
do $$
declare parent uuid; r jsonb; child uuid;
begin
  parent := (public.create_experience('ce122-parent',
    jsonb_build_object('name','Contract Parent','lat',47.6,'lng',-122.3)
      || jsonb_build_object('categories', jsonb_build_array('city')),
    '{}'::jsonb)->>'place_id')::uuid;

  r := public.create_experience('ce122-child',
    jsonb_build_object('name','Contract Child Spot','lat',47.61,'lng',-122.31,
                       'part_of', jsonb_build_array(parent::text),
                       'categories', jsonb_build_array('restaurant')),
    '{}'::jsonb);
  child := (r->>'place_id')::uuid;

  if not exists (select 1 from public.places where id=child and parent = any(part_of)) then
    raise exception 'FAIL: part_of not stored'; end if;
  if not exists (select 1 from public.place_membership
                  where child_id=child and parent_id=parent) then
    raise exception 'FAIL: sync_membership_from_part_of trigger did not create membership'; end if;
  raise notice 'PASS 4: part_of stored and membership trigger fired';
end $$;

-- 5) A part_of pointing at a non-existent place must FAIL LOUDLY rather than
--    silently dropping the relationship.
do $$
declare ok boolean := false;
begin
  begin
    perform public.create_experience('ce122-bad-parent',
      jsonb_build_object('name','Orphan Child','lat',1.0,'lng',2.0,
                         'part_of', jsonb_build_array('99999999-9999-9999-9999-999999999999')),
      '{}'::jsonb);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: a dangling part_of was accepted'; end if;
  raise notice 'PASS 5: dangling part_of rejected';
end $$;

-- 6) The unnamed guard still holds by DEFAULT ...
do $$
declare ok boolean := false;
begin
  begin
    perform public.create_experience('ce122-unnamed-blocked',
      jsonb_build_object('name','','lat',5.0,'lng',6.0), '{}'::jsonb);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: an unnamed place was created without opt-in'; end if;
  raise notice 'PASS 6: unnamed place rejected by default';
end $$;

-- 7) ... and is waived only with the explicit opt-in (MapView placeholder draft).
do $$
declare r jsonb; p uuid;
begin
  r := public.create_experience('ce122-unnamed-allowed',
    jsonb_build_object('name','','lat',5.0,'lng',6.0,'saved',false,
                       'allow_unnamed',true,
                       'categories', jsonb_build_array('winery')),
    '{}'::jsonb);
  p := (r->>'place_id')::uuid;
  if p is null then raise exception 'FAIL: explicit unnamed opt-in did not create a place'; end if;
  if not exists (select 1 from public.places where id=p and name='' and saved=false) then
    raise exception 'FAIL: unnamed draft not stored as an unsaved placeholder'; end if;
  raise notice 'PASS 7: unnamed draft allowed only with allow_unnamed';
end $$;

-- 8) Backwards compatibility: a pre-0122 payload behaves exactly as before, and
--    the new columns take their table defaults.
do $$
declare r jsonb; p uuid;
begin
  r := public.create_experience('ce122-legacy',
    jsonb_build_object('name','Legacy Payload','lat',33.3,'lng',-84.4,
                       'categories', jsonb_build_array('restaurant')),
    jsonb_build_object('date','2026-06-01','who','both'));
  p := (r->>'place_id')::uuid;
  if not exists (
    select 1 from public.places
     where id=p and is_trail=false and bucket=false and needs_geocode=false
       and auto=false and part_of='{}'::uuid[] and website is null)
  then raise exception 'FAIL: new columns did not fall back to their defaults'; end if;
  if (select count(*) from public.visits where place_id=p) <> 1 then
    raise exception 'FAIL: legacy payload did not still create its visit'; end if;
  raise notice 'PASS 8: pre-0122 payloads unchanged';
end $$;

-- 9) Idempotency still holds for the NEW fields — a retry must not duplicate.
do $$
declare r1 jsonb; r2 jsonb;
begin
  r1 := public.create_experience('ce122-idem',
    jsonb_build_object('name','Idem Trail','lat',39.1,'lng',-77.9,'is_trail',true), '{}'::jsonb);
  r2 := public.create_experience('ce122-idem',
    jsonb_build_object('name','Idem Trail','lat',39.1,'lng',-77.9,'is_trail',true), '{}'::jsonb);
  if (r1->>'place_id') <> (r2->>'place_id') then
    raise exception 'FAIL: retry produced a different place'; end if;
  if (r2->>'idempotent')::boolean is not true then
    raise exception 'FAIL: retry not reported as idempotent'; end if;
  if (select count(*) from public.places where name='Idem Trail') <> 1 then
    raise exception 'FAIL: retry duplicated the place'; end if;
  raise notice 'PASS 9: idempotency holds for the extended contract';
end $$;

-- 10) Authorization is unchanged: a viewer still cannot create, including with
--     the new fields.
do $$
declare ok boolean := false;
begin
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-0000000000f2"}';
  begin
    perform public.create_experience('ce122-viewer',
      jsonb_build_object('name','Viewer Trail','lat',1.1,'lng',2.2,'is_trail',true), '{}'::jsonb);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: viewer created an experience'; end if;
  raise notice 'PASS 10: viewer still denied on the extended contract';
end $$;

do $$ begin raise notice 'PASS: 0122 extended create_experience place contract'; end $$;

rollback;
