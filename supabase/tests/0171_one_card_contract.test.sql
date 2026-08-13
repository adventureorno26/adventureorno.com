-- 0171 — the card's header cannot disagree with the list beneath it (§0.6).
begin;
set local check_function_bodies = off;

insert into auth.users (id, email) values ('ffff0171-0000-0000-0000-000000000001','t171@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('ffff0171-0000-0000-0000-000000000001','T171 Owner','owner') on conflict (id) do nothing;
set local request.jwt.claims = '{"sub":"ffff0171-0000-0000-0000-000000000001"}';

do $$
declare
  p uuid; trail uuid; section uuid; v1 uuid; v2 uuid; child uuid; c jsonb;
begin
  -- a destination with two visits, one multi-day, plus a member place
  insert into public.places (name, lat, lng, saved) values ('T171 City', 32.7, -117.1, true)
    returning id into p;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-07-11', '2026-07-16', 'taken', true) returning id into v1;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-09-01', '2026-09-01', 'taken', true) returning id into v2;
  perform public.add_activity_to_visit(v1, 'walk', 'A walk', 4000, 'c171-a');
  perform public.add_place_to_visit(v1, 'restaurant', 'T171 Fish Shop');

  c := public.card_view(p, null);

  if c->>'mode' <> 'place' then raise exception 'FAIL: expected place mode, got %', c->>'mode'; end if;

  -- THE INVARIANT: every total equals the length of the list it describes.
  if (c->'totals'->>'visits')::int <> jsonb_array_length(c->'visits') then
    raise exception 'FAIL: the visits total (%) disagrees with the rows (%)',
      c->'totals'->>'visits', jsonb_array_length(c->'visits'); end if;
  if (c->'totals'->>'routes')::int <> jsonb_array_length(c->'routes') then
    raise exception 'FAIL: the routes total disagrees with the rows'; end if;
  if (c->'totals'->>'members')::int <> jsonb_array_length(c->'members') then
    raise exception 'FAIL: the members total disagrees with the rows'; end if;

  -- the multi-day visit is a trip; the single day is not
  if (c->'totals'->>'trips')::int <> 1 then
    raise exception 'FAIL: expected 1 trip, got %', c->'totals'->>'trips'; end if;

  -- a restaurant added through the dropdown is a MEMBER PLACE, not a route
  if jsonb_array_length(c->'members') <> 1 then
    raise exception 'FAIL: the restaurant did not become a member place'; end if;
  if (c->'members'->0->>'category') <> 'dining' then
    raise exception 'FAIL: the restaurant lost its category'; end if;

  raise notice 'PASS 1: place card — every total equals its own rows';
end $$;

do $$
declare trail uuid; section uuid; v uuid; c jsonb;
begin
  -- a trail rolls up its sections' visits, and each row names its section
  insert into public.places (name, lat, lng, saved, is_trail, holds_children)
    values ('T171 Trail', 39.3, -77.7, true, true, true) returning id into trail;
  insert into public.places (name, lat, lng, saved)
    values ('T171 Section', 39.31, -77.71, true) returning id into section;
  insert into public.place_membership (child_id, parent_id, relationship_type)
    values (section, trail, 'trail_section');
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (trail, '2026-05-01', '2026-05-01', 'taken', true);
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (section, '2026-06-01', '2026-06-01', 'taken', true) returning id into v;

  c := public.card_view(trail, null);
  if c->>'mode' <> 'trail' then raise exception 'FAIL: expected trail mode'; end if;
  if (c->'totals'->>'visits')::int <> 2 then
    raise exception 'FAIL: a trail must roll up its sections'' visits, got %', c->'totals'->>'visits'; end if;
  if not exists (select 1 from jsonb_array_elements(c->'visits') x
                  where x->>'segment' = 'T171 Section') then
    raise exception 'FAIL: the section name is missing from its visit row'; end if;

  raise notice 'PASS 2: trail card — sections roll up and each row names its section';
end $$;

do $$
declare p uuid; v uuid; c jsonb;
begin
  insert into public.places (name, lat, lng, saved) values ('T171 Visit', 38.9, -77.4, true)
    returning id into p;
  insert into public.visits (place_id, start_date, end_date, status, manual)
    values (p, '2026-02-01', '2026-02-03', 'taken', true) returning id into v;
  perform public.add_activity_to_visit(v, 'run', 'A run', 5000, 'c171-b');

  c := public.card_view(null, v);
  if c->>'mode' <> 'visit' then raise exception 'FAIL: expected visit mode'; end if;
  if jsonb_array_length(c->'visits') <> 1 then
    raise exception 'FAIL: a visit card shows exactly its own visit'; end if;
  if (c->'totals'->>'routes')::int <> 1 then
    raise exception 'FAIL: the visit card must scope routes to the visit'; end if;

  if has_function_privilege('anon','public.card_view(uuid,uuid)','EXECUTE') then
    raise exception 'FAIL: anon can read the card';
  end if;

  raise notice 'PASS 3: visit card is scoped to its visit; anon cannot read it';
end $$;

rollback;
