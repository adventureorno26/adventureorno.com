-- 0185 — merging two visits that were always one occasion.
--
-- §0.9 requires these to be permanent, not remembered. Everything runs inside one
-- transaction and rolls back; nothing here touches real data.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('bbbb0185-0000-0000-0000-000000000001', 'a0185@example.invalid'),
  ('bbbb0185-0000-0000-0000-000000000002', 'b0185@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0185-0000-0000-0000-000000000001', 'A0185', 'owner'),
  ('bbbb0185-0000-0000-0000-000000000002', 'B0185', 'editor')
on conflict (id) do update set role = excluded.role;
set local request.jwt.claims = '{"sub":"bbbb0185-0000-0000-0000-000000000001"}';

-- ---------------------------------------------------------------------------
-- 1. ROME. Two halves of one stay become one, and NOTHING is stranded.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0185-0000-0000-0000-000000000001';
  b_id uuid := 'bbbb0185-0000-0000-0000-000000000002';
  rome uuid; child_place uuid; march public.visits; april public.visits; kept public.visits;
  act uuid; n int;
begin
  insert into public.places (name, lat, lng, saved) values ('T185 Roma', 41.9, 12.5, true)
    returning id into rome;

  march := public.create_visit(rome, '2026-03-27', '2026-03-31', 'the good half',
                               array[a_id]::uuid[]);
  april := public.create_visit(rome, '2026-04-01', '2026-04-02', null,
                               array[a_id, b_id]::uuid[]);

  -- AND B SAYS YES. Since 0240 naming somebody else on a visit ASKS them; there is no
  -- participant row until they answer, because nothing filters visit_profiles by
  -- claim_status and a pending row would already be on their statistics. What this test is
  -- about is that merging UNIONS the people who were there, so B has to actually be one.
  perform set_config('request.jwt.claims', json_build_object('sub', b_id)::text, true);
  perform public.respond_to_tag(
    (select id from public.tag_claims
      where subject_kind = 'visit' and subject_id = april.id and profile_id = b_id
        and status = 'proposed'), true);
  perform set_config('request.jwt.claims', json_build_object('sub', a_id)::text, true);

  -- things hanging off the half that will be absorbed
  insert into public.photos (place_id, visit_id, taken_at, r2_key, thumb_key, sha256)
    values (rome, april.id, '2026-04-01T10:00:00Z', 't185/p', 't185/t', 't185-sha');
  insert into public.videos (place_id, visit_id, taken_at, r2_key)
    values (rome, april.id, '2026-04-02T10:00:00Z', 't185/v');
  insert into public.activities (name, type, distance, start_date, place_id, visit_id,
                                 source, owner_profile)
    values ('T185 Walk', 'Walk', 3000, '2026-04-01T09:00:00Z', rome, april.id,
            'manual', a_id) returning id into act;
  insert into public.people (display_name, kind) values ('T185 Kid', 'child');
  perform public.set_visit_people(april.id,
    array(select id from public.people where display_name = 'T185 Kid'));

  -- and a visit grouped INSIDE the absorbed one
  insert into public.places (name, lat, lng, saved) values ('T185 Trattoria', 41.89, 12.49, true)
    returning id into child_place;
  perform public.add_place_to_visit(april.id, 'restaurant', 'T185 Trattoria Due', null, null,
                                    'k185', '2026-04-01');

  kept := public.merge_visits(march.id, april.id);

  -- THE DATES COVER THE WHOLE STAY
  if kept.start_date <> '2026-03-27' or kept.end_date <> '2026-04-02' then
    raise exception 'FAIL: the merged stay should run 27 March to 2 April, got % to %',
      kept.start_date, kept.end_date; end if;
  -- ...which makes it a trip, correctly
  if not public.counts_as_trip(kept.*) then
    raise exception 'FAIL: a seven-day stay is a trip'; end if;

  if exists (select 1 from public.visits where id = april.id) then
    raise exception 'FAIL: the absorbed visit should be gone'; end if;

  -- NOTHING STRANDED
  select count(*) into n from public.photos where visit_id = kept.id;
  if n <> 1 then raise exception 'FAIL: the photo did not move, got %', n; end if;
  select count(*) into n from public.videos where visit_id = kept.id;
  if n <> 1 then raise exception 'FAIL: the video did not move, got %', n; end if;
  select count(*) into n from public.activities where visit_id = kept.id;
  if n <> 1 then raise exception 'FAIL: the walk did not move, got %', n; end if;
  select count(*) into n from public.visit_people where visit_id = kept.id;
  if n <> 1 then raise exception 'FAIL: the companion did not move, got %', n; end if;
  select count(*) into n from public.visits where parent_visit_id = kept.id;
  if n <> 1 then raise exception 'FAIL: what was inside it did not move, got %', n; end if;

  -- PARTICIPANTS UNION: B was on one half, so B was on the stay.
  select count(*) into n from public.visit_profiles where visit_id = kept.id;
  if n <> 2 then raise exception 'FAIL: both people should be on the merged stay, got %', n; end if;

  -- the note survives
  if kept.note <> 'the good half' then
    raise exception 'FAIL: the note was lost, got %', coalesce(kept.note, '(null)'); end if;

  raise notice 'PASS 1: Rome is one stay again, with everything still attached';
end $$;

-- ---------------------------------------------------------------------------
-- 2. IT REFUSES ACROSS PLACES. Merging would move photographs to somewhere they
--    were not taken.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0185-0000-0000-0000-000000000001';
  p1 uuid; p2 uuid; v1 public.visits; v2 public.visits; kept public.visits;
begin
  insert into public.places (name, lat, lng, saved) values ('T185 Here', 41.9, 12.5, true)
    returning id into p1;
  insert into public.places (name, lat, lng, saved) values ('T185 There', 45.4, 9.2, true)
    returning id into p2;
  v1 := public.create_visit(p1, '2026-05-01', null, null, array[a_id]::uuid[]);
  v2 := public.create_visit(p2, '2026-05-02', null, null, array[a_id]::uuid[]);

  begin
    kept := public.merge_visits(v1.id, v2.id);
    raise exception 'FAIL: merging across places was allowed';
  exception when others then
    if position('different places' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    kept := public.merge_visits(v1.id, v1.id);
    raise exception 'FAIL: a visit was merged with itself';
  exception when others then
    if position('same visit' in sqlerrm) = 0 then raise; end if;
  end;

  raise notice 'PASS 2: it refuses across places, and refuses itself';
end $$;

-- ---------------------------------------------------------------------------
-- 3. anon cannot merge anything.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.merge_visits(uuid,uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can merge visits';
  end if;
  raise notice 'PASS 3: anon cannot merge visits';
end $$;

rollback;
