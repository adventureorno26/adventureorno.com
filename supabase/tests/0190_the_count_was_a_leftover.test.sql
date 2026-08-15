-- 0190 — the count on the place row counts visits, and keeps counting visits.
--
-- The failure this pins down is not "a number was wrong once". It is that the number
-- was CORRECTED by 0126 and then quietly restored to the old meaning by a function
-- nobody had looked at since 0117 — so the test that matters is the one that runs
-- recompute_place_stats and checks what it leaves behind.
--
-- Everything runs inside one transaction and rolls back; nothing here touches real data.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('bbbb0190-0000-0000-0000-000000000001', 'a0190@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0190-0000-0000-0000-000000000001', 'A0190', 'owner')
on conflict (id) do update set role = 'owner';
set local request.jwt.claims = '{"sub":"bbbb0190-0000-0000-0000-000000000001"}';

-- ---------------------------------------------------------------------------
-- 1. THE ONE THAT MATTERS. A place with ONE visit spread over several days of
--    photographs counts as ONE, and still counts as one after the stats are
--    recomputed — which is what a Strava webhook does.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0190-0000-0000-0000-000000000001';
  p uuid; v public.visits; n integer;
begin
  insert into public.places (name, lat, lng, saved) values ('T190 Rome', 41.9, 12.5, true)
    returning id into p;
  v := public.create_visit(p, '2026-03-27', '2026-04-02', null, array[a_id]::uuid[]);

  -- four days of evidence, one visit
  insert into public.photos (place_id, taken_at, lat, lng, r2_key, thumb_key) values
    (p, '2026-03-27T10:00:00Z', 41.9, 12.5, 't190/a.jpg', 't190/a-thumb.jpg'),
    (p, '2026-03-28T10:00:00Z', 41.9, 12.5, 't190/b.jpg', 't190/b-thumb.jpg'),
    (p, '2026-03-31T10:00:00Z', 41.9, 12.5, 't190/c.jpg', 't190/c-thumb.jpg'),
    (p, '2026-04-02T10:00:00Z', 41.9, 12.5, 't190/d.jpg', 't190/d-thumb.jpg');

  perform public.recompute_place_stats(p);

  select visit_count into n from public.places where id = p;
  if n <> 1 then
    raise exception 'FAIL: one visit over four photographed days counted as % — that is the DAY count coming back', n;
  end if;

  raise notice 'PASS 1: recompute_place_stats leaves the count at one visit, not four days';
end $$;

-- ---------------------------------------------------------------------------
-- 2. It follows the visits. Two visits count two, and removing one counts one.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0190-0000-0000-0000-000000000001';
  p uuid; v1 public.visits; v2 public.visits; n integer;
begin
  insert into public.places (name, lat, lng, saved) values ('T190 Twice', 38.9, -77.0, true)
    returning id into p;
  v1 := public.create_visit(p, '2026-05-01', '2026-05-01', null, array[a_id]::uuid[]);
  v2 := public.create_visit(p, '2026-09-14', '2026-09-14', null, array[a_id]::uuid[]);

  perform public.recompute_place_stats(p);
  select visit_count into n from public.places where id = p;
  if n <> 2 then raise exception 'FAIL: two visits counted %', n; end if;

  perform public.delete_visit(v2.id);
  perform public.recompute_place_stats(p);
  select visit_count into n from public.places where id = p;
  if n <> 1 then
    raise exception 'FAIL: after deleting a visit the count says % — this is the drift that left the Appalachian Trail on 39', n;
  end if;

  raise notice 'PASS 2: the count follows the visits, down as well as up';
end $$;

-- ---------------------------------------------------------------------------
-- 3. The dates still come from the evidence. Fixing the count must not have
--    taken first_visit / last_visit with it.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0190-0000-0000-0000-000000000001';
  p uuid; v public.visits; f date; l date;
begin
  insert into public.places (name, lat, lng, saved) values ('T190 Dates', 37.8, -122.4, true)
    returning id into p;
  v := public.create_visit(p, '2026-06-10', '2026-06-12', null, array[a_id]::uuid[]);
  insert into public.photos (place_id, taken_at, lat, lng, r2_key, thumb_key) values
    (p, '2026-06-10T09:00:00Z', 37.8, -122.4, 't190/e.jpg', 't190/e-thumb.jpg'),
    (p, '2026-06-12T18:00:00Z', 37.8, -122.4, 't190/f.jpg', 't190/f-thumb.jpg');

  perform public.recompute_place_stats(p);
  select first_visit, last_visit into f, l from public.places where id = p;
  if f <> '2026-06-10' or l <> '2026-06-12' then
    raise exception 'FAIL: the evidence dates moved — got % to %', f, l;
  end if;

  raise notice 'PASS 3: first_visit and last_visit still come from the evidence';
end $$;

-- ---------------------------------------------------------------------------
-- 4. place_visit_totals counts EVERYONE's visits — that is the whole point of
--    it, and the reason the two screens could not use place_visit_counts.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0190-0000-0000-0000-000000000001';
  b_id uuid := 'bbbb0190-0000-0000-0000-000000000002';
  p uuid; v1 public.visits; v2 public.visits; total integer; shared integer;
begin
  insert into auth.users (id, email) values (b_id, 'b0190@example.invalid') on conflict do nothing;
  insert into public.profiles (id, display_name, role) values (b_id, 'B0190', 'editor')
    on conflict (id) do nothing;

  insert into public.places (name, lat, lng, saved) values ('T190 Whose', 39.0, -76.0, true)
    returning id into p;
  -- one shared visit, one that only the other person was on
  v1 := public.create_visit(p, '2026-07-01', '2026-07-01', null, array[a_id, b_id]::uuid[]);
  v2 := public.create_visit(p, '2026-07-20', '2026-07-20', null, array[b_id]::uuid[]);

  select visits into total from public.place_visit_totals() where place_id = p;
  select visits into shared from public.place_visit_counts(null) where place_id = p;

  if total <> 2 then
    raise exception 'FAIL: the total should count both visits, got %', total; end if;
  if shared is distinct from 1 then
    raise exception 'FAIL: the shared count should be 1, got % — if these two agree, the new reader is not answering a different question', shared; end if;

  raise notice 'PASS 4: the total counts everyone (2); the view count counts the shared one (1)';
end $$;

rollback;
