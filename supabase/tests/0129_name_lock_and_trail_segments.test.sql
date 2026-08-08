-- DB test for 0129 — a name a person gave is never rewritten by automation,
-- and a trail is its segments.
begin;

insert into auth.users (id,email) values
  ('bbbb2222-0000-0000-0000-00000000f001','v129-erica@example.test'),
  ('bbbb2222-0000-0000-0000-00000000f002','v129-josh@example.test') on conflict do nothing;
insert into public.profiles (id,role,display_name) values
  ('bbbb2222-0000-0000-0000-00000000f001','owner','V129 Erica'),
  ('bbbb2222-0000-0000-0000-00000000f002','editor','Josh') on conflict do nothing;
set local request.jwt.claims = '{"sub":"bbbb2222-0000-0000-0000-00000000f001"}';

-- 1) Naming a place locks it and stops the geocoder.
do $$
declare p uuid; r public.places;
begin
  insert into public.places (name, lat, lng, saved, auto, needs_geocode)
    values ('New place', 39.0, -77.5, true, true, true) returning id into p;
  r := public.set_place_name(p, 'Erica''s Secret Overlook');
  if r.name <> 'Erica''s Secret Overlook' then raise exception 'FAIL: name not set'; end if;
  if not r.name_locked then raise exception 'FAIL: naming did not lock the place'; end if;
  if r.auto then raise exception 'FAIL: still flagged auto'; end if;
  if r.needs_geocode then raise exception 'FAIL: geocoder would still rewrite it'; end if;
  raise notice 'PASS 1: naming locks the place and clears auto/needs_geocode';
end $$;

-- 2) THE ANTI-REPETITION RULE. Automation must not absorb a locked name, even when a
--    same-named auto place sits right next to it.
do $$
declare locked uuid; auto_dupe uuid; n int;
begin
  insert into public.places (name, lat, lng, saved, auto, name_locked, created_at)
    values ('Shared Name', 39.10, -77.50, true, false, true, now() - interval '2 days') returning id into locked;
  insert into public.places (name, lat, lng, saved, auto, name_locked, created_at)
    values ('Shared Name', 39.1001, -77.5001, true, true, false, now()) returning id into auto_dupe;

  perform public.merge_nearby_dupes();

  select count(*) into n from public.places where id = locked;
  if n <> 1 then raise exception 'FAIL: a locked place was merged away'; end if;
  if (select name from public.places where id = locked) <> 'Shared Name' then
    raise exception 'FAIL: a locked name was rewritten'; end if;
  raise notice 'PASS 2: automation cannot merge into or away a locked name';
end $$;

-- 3) Josh gets the same right — attribution never gates naming.
do $$
declare p uuid; r public.places;
begin
  insert into public.places (name, lat, lng, saved, auto) values ('New place', 38.5, -78.0, true, true) returning id into p;
  set local request.jwt.claims = '{"sub":"bbbb2222-0000-0000-0000-00000000f002"}';
  r := public.set_place_name(p, 'Josh''s Ridge');
  if not r.name_locked or r.name <> 'Josh''s Ridge' then raise exception 'FAIL: Josh could not name a place'; end if;
  raise notice 'PASS 3: Josh can name places too';
end $$;

-- 4) A viewer cannot.
do $$
declare p uuid; ok boolean := false;
begin
  insert into auth.users (id,email) values ('bbbb2222-0000-0000-0000-00000000f003','v129-viewer@example.test') on conflict do nothing;
  insert into public.profiles (id,role,display_name) values ('bbbb2222-0000-0000-0000-00000000f003','viewer','V129 Viewer') on conflict do nothing;
  select id into p from public.places where name = 'Josh''s Ridge';
  set local request.jwt.claims = '{"sub":"bbbb2222-0000-0000-0000-00000000f003"}';
  begin
    perform public.set_place_name(p, 'Viewer Rename');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: a viewer renamed a place'; end if;
  raise notice 'PASS 4: viewer denied';
end $$;

-- 5) TRAIL SEGMENTS. A trail holds its segments; each segment still counts once and
--    the trail itself stays a non-counting rollup.
do $$
declare t uuid; s1 uuid; s2 uuid;
begin
  set local request.jwt.claims = '{"sub":"bbbb2222-0000-0000-0000-00000000f001"}';
  insert into public.places (name, lat, lng, saved, is_trail) values ('V129 Long Trail', 39.0, -77.6, true, true) returning id into t;
  insert into public.places (name, lat, lng, saved, categories) values ('V129 Segment A', 39.01, -77.61, true, array['running']) returning id into s1;
  insert into public.places (name, lat, lng, saved, categories) values ('V129 Segment B', 39.02, -77.62, true, array['running']) returning id into s2;

  update public.places set part_of = array[t] where id in (s1, s2);

  if (select count(*) from public.place_membership where parent_id = t) <> 2 then
    raise exception 'FAIL: segments not linked to the trail'; end if;
  if (select counts_as_place from public.places where id = t) then
    raise exception 'FAIL: the trail must stay a rollup and not count'; end if;
  if not (select counts_as_place from public.places where id = s1) then
    raise exception 'FAIL: a segment must still count once'; end if;
  raise notice 'PASS 5: trail holds segments; segments count, trail rolls up';
end $$;

do $$ begin raise notice 'PASS: 0129 name lock + trail segments'; end $$;
rollback;
