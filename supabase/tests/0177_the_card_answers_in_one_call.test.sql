-- 0177 — one call returns the whole card, and its totals cannot disagree with its rows.
--
-- §0.9 requires these to be permanent, not remembered. Everything runs inside one
-- transaction and rolls back; nothing here touches real data.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('bbbb0177-0000-0000-0000-000000000001', 'a0177@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0177-0000-0000-0000-000000000001', 'A0177', 'owner')
on conflict (id) do update set role = 'owner';
set local request.jwt.claims = '{"sub":"bbbb0177-0000-0000-0000-000000000001"}';

-- ---------------------------------------------------------------------------
-- 1. THE HEADER CANNOT DISAGREE WITH THE LIST. This is the whole reason the
--    read model exists: "Visits (1)" above a list of two.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0177-0000-0000-0000-000000000001';
  p uuid; v1 public.visits; v2 public.visits; card jsonb;
begin
  insert into public.places (name, lat, lng, saved) values ('T177 Place', 38.9, -77.1, true)
    returning id into p;
  v1 := public.create_visit(p, '2026-03-01', '2026-03-04', null, array[a_id]::uuid[]);
  v2 := public.create_visit(p, '2026-05-01', null, null, array[a_id]::uuid[]);

  card := public.card_view(p_place := p);

  if (card->>'version')::int <> 2 then
    raise exception 'FAIL: the card model should report version 2, got %', card->>'version'; end if;
  if card->>'mode' <> 'place' then
    raise exception 'FAIL: a non-trail place is the place card, got %', card->>'mode'; end if;

  if (card->'totals'->>'visits')::int <> jsonb_array_length(card->'visits') then
    raise exception 'FAIL: the visits total (%) disagrees with the rows (%)',
      card->'totals'->>'visits', jsonb_array_length(card->'visits'); end if;
  if (card->'totals'->>'visits')::int <> 2 then
    raise exception 'FAIL: expected 2 visits, got %', card->'totals'->>'visits'; end if;

  -- the multi-day one qualifies as a trip without being marked (§0.4)
  if (card->'totals'->>'trips')::int <> 1 then
    raise exception 'FAIL: the multi-day visit should count as one trip, got %',
      card->'totals'->>'trips'; end if;

  raise notice 'PASS 1: the totals are computed from the rows returned beside them';
end $$;

-- ---------------------------------------------------------------------------
-- 2. PHOTOS AND VIDEOS COUNT BY visit_id, NOT BY DATE.
--    place_visit_stats counted a photo for every visit at the place whose range
--    covered its date, and ignored the visit it was actually pinned to.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0177-0000-0000-0000-000000000001';
  p uuid; v1 public.visits; v2 public.visits; card jsonb; row1 jsonb; row2 jsonb;
begin
  insert into public.places (name, lat, lng, saved) values ('T177 Media', 39.0, -77.2, true)
    returning id into p;
  -- two visits at one place whose ranges OVERLAP the same day
  v1 := public.create_visit(p, '2026-06-01', '2026-06-05', null, array[a_id]::uuid[]);
  v2 := public.create_visit(p, '2026-06-03', '2026-06-03', null, array[a_id]::uuid[]);

  -- one photo, taken on the shared day, pinned to the SECOND visit
  insert into public.photos (place_id, visit_id, taken_at, r2_key, thumb_key, sha256)
    values (p, v2.id, '2026-06-03T12:00:00Z', 't177/photo-1', 't177/thumb-1', 't177-sha-1');
  -- one video, likewise
  insert into public.videos (place_id, visit_id, taken_at, r2_key)
    values (p, v2.id, '2026-06-03T13:00:00Z', 't177/video-1');

  card := public.card_view(p_place := p);
  select x into row1 from jsonb_array_elements(card->'visits') x where x->>'id' = v1.id::text;
  select x into row2 from jsonb_array_elements(card->'visits') x where x->>'id' = v2.id::text;

  if (row1->>'photos')::int <> 0 then
    raise exception 'FAIL: the photo belongs to the other visit, not this one (got %)',
      row1->>'photos'; end if;
  if (row2->>'photos')::int <> 1 then
    raise exception 'FAIL: the visit the photo is pinned to should show it, got %',
      row2->>'photos'; end if;
  if (row1->>'videos')::int <> 0 or (row2->>'videos')::int <> 1 then
    raise exception 'FAIL: videos must follow visit_id too (% / %)',
      row1->>'videos', row2->>'videos'; end if;

  if (card->'totals'->>'photos')::int <> 1 then
    raise exception 'FAIL: the place should total one photo, got %',
      card->'totals'->>'photos'; end if;
  if (card->'totals'->>'videos')::int <> 1 then
    raise exception 'FAIL: the place should total one video, got %',
      card->'totals'->>'videos'; end if;

  raise notice 'PASS 2: photos and videos follow the visit they are on, not the calendar';
end $$;

-- ---------------------------------------------------------------------------
-- 3. A trip carries its contents, so "N places" and the list it opens are the
--    same data — and an unrelated visit is not swallowed (§0.1).
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0177-0000-0000-0000-000000000001';
  tp uuid; cp uuid; op uuid; tv public.visits; cv public.visits; ov public.visits;
  card jsonb; trip_row jsonb;
begin
  insert into public.places (name, lat, lng, saved) values ('T177 Trip', 41.7, -70.3, true)
    returning id into tp;
  insert into public.places (name, lat, lng, saved) values ('T177 Dinner', 41.6, -70.2, true)
    returning id into cp;
  insert into public.places (name, lat, lng, saved) values ('T177 Far Away', 34.0, -118.2, true)
    returning id into op;

  tv := public.create_visit(tp, '2026-07-01', '2026-07-07', null, array[a_id]::uuid[]);
  cv := public.create_visit(cp, '2026-07-03', null, null, array[a_id]::uuid[], false, tv.id);
  -- inside the dates, nothing to do with the trip, never attached
  ov := public.create_visit(op, '2026-07-04', null, null, array[a_id]::uuid[]);

  card := public.card_view(p_place := tp);
  select x into trip_row from jsonb_array_elements(card->'visits') x where x->>'id' = tv.id::text;

  if jsonb_array_length(trip_row->'contents') <> 1 then
    raise exception 'FAIL: the trip should contain exactly the visit attached to it, got %',
      jsonb_array_length(trip_row->'contents'); end if;
  if (trip_row->'contents'->0->>'visit_id') <> cv.id::text then
    raise exception 'FAIL: the wrong visit is inside the trip'; end if;
  if (trip_row->'contents'->0->>'place_name') <> 'T177 Dinner' then
    raise exception 'FAIL: the contents must carry the place name for the list'; end if;

  -- the count beside it comes from the same rows
  if (trip_row->>'children')::int <> jsonb_array_length(trip_row->'contents') then
    raise exception 'FAIL: the children count (%) disagrees with the contents (%)',
      trip_row->>'children', jsonb_array_length(trip_row->'contents'); end if;

  raise notice 'PASS 3: a trip carries exactly what was attached to it';
end $$;

-- ---------------------------------------------------------------------------
-- 4. A TRAIL'S VISITS INCLUDE ITS SECTIONS', each carrying the segment name.
--    Erica: the Appalachian Trail card showed 32 and hid the 30 on its sections.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0177-0000-0000-0000-000000000001';
  trail uuid; sect uuid; tv public.visits; sv public.visits; card jsonb; seg_row jsonb;
begin
  insert into public.places (name, lat, lng, saved, is_trail)
    values ('T177 Long Trail', 44.0, -72.8, true, true) returning id into trail;
  insert into public.places (name, lat, lng, saved)
    values ('T177 Section One', 44.1, -72.9, true) returning id into sect;
  insert into public.place_membership (parent_id, child_id, relationship_type)
    values (trail, sect, 'trail_section') on conflict do nothing;

  tv := public.create_visit(trail, '2026-08-01', null, null, array[a_id]::uuid[]);
  sv := public.create_visit(sect,  '2026-08-02', null, null, array[a_id]::uuid[]);

  card := public.card_view(p_place := trail);
  if card->>'mode' <> 'trail' then
    raise exception 'FAIL: a trail place is the trail card, got %', card->>'mode'; end if;
  if (card->'totals'->>'visits')::int <> 2 then
    raise exception 'FAIL: a trail''s visits include its sections'' — expected 2, got %',
      card->'totals'->>'visits'; end if;

  select x into seg_row from jsonb_array_elements(card->'visits') x where x->>'id' = sv.id::text;
  if seg_row->>'segment' <> 'T177 Section One' then
    raise exception 'FAIL: a section visit must carry its segment name, got %',
      coalesce(seg_row->>'segment', '(null)'); end if;

  raise notice 'PASS 4: walking a section is walking the trail, and the row says which';
end $$;

-- ---------------------------------------------------------------------------
-- 5. anon cannot read the card.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.card_view(uuid,uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can read the card';
  end if;
  raise notice 'PASS 5: anon cannot read the card';
end $$;

rollback;
