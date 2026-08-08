-- DB test for 0127 — a destination counts as a place (Slice 4).
-- Reproduces the exact live Barbados shape.
begin;

insert into auth.users (id,email) values ('ffffffff-0000-0000-0000-00000000d001','v127@example.test') on conflict do nothing;
insert into public.profiles (id,role,display_name) values ('ffffffff-0000-0000-0000-00000000d001','owner','V127 Owner') on conflict do nothing;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-00000000d001"}';

-- The Barbados shape: a 'trip'-category destination holding a stay, photos on the
-- destination, a canonical trip, and a stop pointing at the child.
do $$
declare dest uuid; stay uuid; t uuid; n_places int; n_visits int; st text; cap boolean;
begin
  insert into public.places (name, lat, lng, saved, categories)
    values ('V127 Paynes Bay', 13.18, -59.64, true, array['walking','beach','dining','stay','trip'])
    returning id into dest;
  insert into public.places (name, lat, lng, saved, categories, part_of)
    values ('V127 Annabelle''s', 13.181, -59.641, true, array['stay'], array[dest])
    returning id into stay;
  insert into public.trips (name, start_date, end_date) values ('V127 Barbados','2026-04-16','2026-04-20') returning id into t;
  insert into public.trip_stops (trip_id, place_id, status) values (t, stay, 'planned');
  insert into public.photos (place_id, lat, lng, taken_at, r2_key, thumb_key, sha256) values
    (dest,13.18,-59.64,'2026-04-16T12:00:00Z','p1','q1','z1'),
    (dest,13.18,-59.64,'2026-04-18T12:00:00Z','p2','q2','z2'),
    (dest,13.18,-59.64,'2026-04-20T12:00:00Z','p3','q3','z3');
  perform public.rebuild_place_visits(dest);

  -- BEFORE: the destination does not count and the trip reports nothing.
  select counts_as_place into cap from public.places where id = dest;
  if cap then raise exception 'FAIL: setup wrong — a trip-category place should not count yet'; end if;

  -- Apply what 0127 does.
  update public.places
     set categories = case when categories @> array['city'] then array_remove(categories,'trip')
                          else array_append(array_remove(categories,'trip'),'region') end,
         category = null
   where id = dest;

  insert into public.trip_stops (trip_id, place_id, status)
  select t, dest, 'planned'
   where not exists (select 1 from public.trip_stops s where s.trip_id=t and s.place_id=dest);
  perform public.promote_trip_stops_for_place(dest);
  perform public.recompute_place_stats(dest);

  -- AFTER
  select counts_as_place into cap from public.places where id = dest;
  if not cap then raise exception 'FAIL: the destination still does not count as a place'; end if;
  if (select category from public.places where id=dest) <> 'region' then
    raise exception 'FAIL: expected region, got %', (select category from public.places where id=dest); end if;
  if not (select holds_children from public.places where id=dest) then
    raise exception 'FAIL: the destination must still hold its children'; end if;

  select status into st from public.trip_stops where trip_id=t and place_id=dest;
  if st <> 'completed' then raise exception 'FAIL: the destination stop is % not completed', st; end if;

  select (public.trip_stats(t)->>'places')::int, (public.trip_stats(t)->>'visits')::int
    into n_places, n_visits;
  if n_places < 1 or n_visits < 1 then
    raise exception 'FAIL: trip still reports % places / % visits', n_places, n_visits; end if;
  raise notice 'PASS: destination counts, stop completed, trip reports % places / % visits', n_places, n_visits;
end $$;

-- A place that already has 'city' stays a city, not a region.
do $$
declare p uuid;
begin
  insert into public.places (name, lat, lng, saved, categories)
    values ('V127 San Diego', 32.7, -117.1, true, array['trip','walking','beach','city']) returning id into p;
  update public.places
     set categories = case when categories @> array['city'] then array_remove(categories,'trip')
                          else array_append(array_remove(categories,'trip'),'region') end,
         category = null
   where id = p;
  if (select category from public.places where id=p) <> 'city' then
    raise exception 'FAIL: expected city, got %', (select category from public.places where id=p); end if;
  raise notice 'PASS: an existing city stays a city';
end $$;

-- Trails remain non-counting rollups.
do $$
declare p uuid;
begin
  insert into public.places (name, lat, lng, saved, is_trail) values ('V127 Trail', 39.0, -77.8, true, true) returning id into p;
  if (select counts_as_place from public.places where id=p) then
    raise exception 'FAIL: a trail must not count as a place'; end if;
  raise notice 'PASS: trails stay rollups';
end $$;

do $$ begin raise notice 'PASS: 0127 destinations count as places'; end $$;
rollback;
