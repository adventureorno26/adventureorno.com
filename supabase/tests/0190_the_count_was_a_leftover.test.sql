-- 0190 — the reader that answers "how many visits, by anybody".
--
-- The bug behind this was not that a number was wrong once. It was that `visit_count` was
-- a mirror nobody refreshed when a VISIT changed: create_visit, delete_visit, merge_visits
-- and update_visit_dates all left it behind, so it drifted every time Erica merged two
-- visits into one. Production had the Appalachian Trail on 39 against 32 rows.
--
-- SECTION 1 USED TO ASSERT THAT DRIFT, and it said so in its own words: *"if a later
-- change adds a trigger and the column starts keeping up, THIS TEST SHOULD FAIL."* On
-- 2026-08-29 it did exactly that, in CI, which is the whole reason it was written that
-- way — the tripwire worked. `0273` gave the column a maintainer after it drifted three
-- times in one evening (twice from deletions, once from a visit added through the app),
-- so the model changed and section 1 changed with it: it now asserts the column KEEPS UP,
-- through the ordinary door, in both directions.
--
-- Sections 2–4 are untouched. They are about `place_visit_totals()` answering a different
-- question from `place_visit_counts()`, which is still true and still worth guarding.
--
-- Everything runs inside one transaction and rolls back; nothing here touches real data.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('bbbb0190-0000-0000-0000-000000000001', 'a0190@example.invalid'),
  ('bbbb0190-0000-0000-0000-000000000002', 'b0190@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0190-0000-0000-0000-000000000001', 'A0190', 'owner'),
  ('bbbb0190-0000-0000-0000-000000000002', 'B0190', 'editor')
on conflict (id) do update set role = excluded.role;
set local request.jwt.claims = '{"sub":"bbbb0190-0000-0000-0000-000000000001"}';

-- ---------------------------------------------------------------------------
-- 1. THE ONE THAT MATTERS. Both doors the app has — create_visit and
--    delete_visit — and the column keeps up with each, without a backfill.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0190-0000-0000-0000-000000000001';
  p uuid; v1 public.visits; v2 public.visits;
  col integer; reader integer; all_rows integer; accepted_now integer;
begin
  insert into public.places (name, lat, lng, saved) values ('T190 Drifts', 38.9, -77.0, true)
    returning id into p;
  v1 := public.create_visit(p, '2026-05-01', '2026-05-01', null, array[a_id]::uuid[]);
  v2 := public.create_visit(p, '2026-09-14', '2026-09-14', null, array[a_id]::uuid[]);

  -- NO BACKFILL HERE, deliberately. The old version of this test had to run one to make
  -- the drift attributable to the deletion; needing it at all was the bug. If the column
  -- is right at this point, the INSERT side of 0273's trigger is doing its job through
  -- the real RPC rather than in a hand-written update.
  select visit_count into col from public.places where id = p;
  select count(*)::integer into all_rows from public.visits where place_id = p;
  if col is distinct from all_rows then
    raise exception 'FAIL: after two create_visit calls the column says % against % rows', col, all_rows;
  end if;

  perform public.delete_visit(v2.id);

  select visit_count into col from public.places where id = p;
  select count(*)::integer into all_rows from public.visits where place_id = p;
  select count(*)::integer into accepted_now from public.accepted_visits where place_id = p;
  select visits into reader from public.place_visit_totals() where place_id = p;

  -- The reader still counts rows at the moment you ask, which is why it never drifted.
  if reader is distinct from accepted_now then
    raise exception 'FAIL: the reader says % but there are % accepted visits', reader, accepted_now;
  end if;

  -- 0273: THE MIRROR IS MAINTAINED NOW. This assertion is the inverse of the one that
  -- used to live here, and it is the thing that stops the column going stale again. If
  -- it ever fails, the trigger has been dropped or narrowed — check `tgtype` covers
  -- insert, delete AND update before believing anything else.
  if col is distinct from all_rows then
    raise exception
      'FAIL: after delete_visit the column says % against % rows — visit_count has '
      'stopped keeping up, which is what 0273 exists to prevent', col, all_rows;
  end if;

  raise notice 'PASS 1: the column keeps up through create_visit and delete_visit (% rows), and the reader agrees (%)', all_rows, reader;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The total counts EVERYONE. That is the whole reason it exists: the two
--    screens could not use place_visit_counts, whose null means SHARED.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0190-0000-0000-0000-000000000001';
  b_id uuid := 'bbbb0190-0000-0000-0000-000000000002';
  p uuid; v1 public.visits; v2 public.visits; total integer; shared integer;
begin
  insert into public.places (name, lat, lng, saved) values ('T190 Whose', 39.0, -76.0, true)
    returning id into p;
  v1 := public.create_visit(p, '2026-07-01', '2026-07-01', null, array[a_id, b_id]::uuid[]);
  v2 := public.create_visit(p, '2026-07-20', '2026-07-20', null, array[b_id]::uuid[]);

  select visits into total from public.place_visit_totals() where place_id = p;
  select coalesce((select visits from public.place_visit_counts(null) where place_id = p), 0)
    into shared;

  if total <> 2 then
    raise exception 'FAIL: the total should count both visits, got %', total; end if;
  if shared <> 1 then
    raise exception
      'FAIL: the shared count should be 1, got % — if these two agree the new reader '
      'is not answering a different question and should not exist', shared; end if;

  raise notice 'PASS 2: the total counts everyone (2); the view count counts the shared one (1)';
end $$;

-- ---------------------------------------------------------------------------
-- 3. A soft-deleted place is not in the answer — the reader sits on
--    accepted_visits and joins places for exactly that reason.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0190-0000-0000-0000-000000000001';
  p uuid; v public.visits; n integer;
begin
  insert into public.places (name, lat, lng, saved) values ('T190 Gone', 40.0, -75.0, true)
    returning id into p;
  v := public.create_visit(p, '2026-08-01', '2026-08-01', null, array[a_id]::uuid[]);

  select visits into n from public.place_visit_totals() where place_id = p;
  if n <> 1 then raise exception 'FAIL: expected 1 before the place goes, got %', n; end if;

  update public.places set deleted_at = now() where id = p;
  select coalesce((select visits from public.place_visit_totals() where place_id = p), 0) into n;
  if n <> 0 then
    raise exception 'FAIL: a deleted place still counted % visits', n; end if;

  raise notice 'PASS 3: a deleted place drops out of the totals';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Members only. It is security definer, so this is the whole guard.
-- ---------------------------------------------------------------------------
do $$
declare ok boolean := false;
begin
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000fe"}';
  begin
    perform * from public.place_visit_totals();
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: a non-member read place_visit_totals'; end if;
  raise notice 'PASS 4: non-member denied';
end $$;

rollback;
