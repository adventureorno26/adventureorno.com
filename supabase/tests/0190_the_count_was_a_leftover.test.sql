-- 0190 — the reader that answers "how many visits, by anybody".
--
-- The bug behind this is not that a number was wrong once. It is that `visit_count` is
-- a mirror nobody refreshes when a VISIT changes: create_visit, delete_visit,
-- merge_visits and update_visit_dates all leave it behind, so it drifts every time
-- Erica merges two visits into one. Production had the Appalachian Trail on 39 against
-- 32 rows.
--
-- So the test is not "recompute gives the right answer" — 0126 already covers that. It
-- is that the drift IS REACHABLE through the ordinary door, and that the new reader
-- does not drift, because it counts rows at the moment you ask.
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
-- 1. THE ONE THAT MATTERS. Delete a visit through the RPC — the only door the
--    app has — and the column is left behind while the reader keeps up.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0190-0000-0000-0000-000000000001';
  p uuid; v1 public.visits; v2 public.visits; col integer; reader integer; rows_now integer;
begin
  insert into public.places (name, lat, lng, saved) values ('T190 Drifts', 38.9, -77.0, true)
    returning id into p;
  v1 := public.create_visit(p, '2026-05-01', '2026-05-01', null, array[a_id]::uuid[]);
  v2 := public.create_visit(p, '2026-09-14', '2026-09-14', null, array[a_id]::uuid[]);

  -- Bring the mirror up to date the way 0190's backfill does, so the drift below is
  -- caused by the deletion and not by it having started out wrong.
  update public.places set visit_count =
    (select count(*) from public.visits v where v.place_id = p) where id = p;

  perform public.delete_visit(v2.id);

  select visit_count into col from public.places where id = p;
  select count(*)::integer into rows_now from public.accepted_visits where place_id = p;
  select visits into reader from public.place_visit_totals() where place_id = p;

  if reader is distinct from rows_now then
    raise exception 'FAIL: the reader says % but there are % visits', reader, rows_now; end if;

  -- The drift itself, asserted rather than merely described. If a later change adds a
  -- trigger and the column starts keeping up, THIS TEST SHOULD FAIL and be deleted
  -- along with the workaround it documents.
  if col = rows_now then
    raise exception
      'The column now keeps up with delete_visit. That is a change in the model: '
      'decide whether the mirror is staying (then this test goes) or whether the '
      'column is being dropped as planned (then it goes).';
  end if;

  raise notice 'PASS 1: after delete_visit the column says % and the reader says % — the reader is right', col, reader;
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
