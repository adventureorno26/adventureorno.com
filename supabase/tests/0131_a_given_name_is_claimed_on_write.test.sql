-- DB test for 0131 — a real name is claimed on write, from ANY path.
begin;

insert into auth.users (id,email) values
  ('dddd4444-0000-0000-0000-00000000d001','v131-erica@example.test'),
  ('dddd4444-0000-0000-0000-00000000d002','v131-josh@example.test') on conflict do nothing;
insert into public.profiles (id,role,display_name) values
  ('dddd4444-0000-0000-0000-00000000d001','owner','V131 Erica'),
  ('dddd4444-0000-0000-0000-00000000d002','editor','Josh') on conflict do nothing;
set local request.jwt.claims = '{"sub":"dddd4444-0000-0000-0000-00000000d001"}';

-- 1) A plain INSERT with a real name — the shape every client create path uses — is
--    claimed without the client doing anything.
do $$
declare p uuid; r public.places;
begin
  insert into public.places (name, lat, lng, saved) values ('Linnell Landing Beach', 41.75, -70.07, true) returning id into p;
  select * into r from public.places where id = p;
  if not r.name_locked then raise exception 'FAIL: an inserted name was not claimed'; end if;
  if r.named_by <> 'dddd4444-0000-0000-0000-00000000d001' then raise exception 'FAIL: named_by wrong (%)', r.named_by; end if;
  if r.name_scope is not null then raise exception 'FAIL: a created place should be shared, not personal'; end if;
  raise notice 'PASS 1: a real name on insert is claimed for the shared space';
end $$;

-- 2) 'New place' and blank are NOT names — they stay free, or the placeholder would
--    lock every unnamed cluster and nobody could ever name it.
do $$
declare p1 uuid; p2 uuid;
begin
  insert into public.places (name, lat, lng, saved) values ('New place', 39.9, -77.1, true) returning id into p1;
  insert into public.places (name, lat, lng, saved) values ('', 39.91, -77.11, true) returning id into p2;
  if (select name_locked from public.places where id = p1) then raise exception 'FAIL: placeholder name got claimed'; end if;
  if (select name_locked from public.places where id = p2) then raise exception 'FAIL: blank name got claimed'; end if;
  raise notice 'PASS 2: placeholder and blank names stay unclaimed';
end $$;

-- 3) An UPDATE that renames re-stamps the owner. This is the MapView prefill path,
--    which PATCHes name directly rather than calling set_place_name.
do $$
declare p uuid; r public.places;
begin
  select id into p from public.places where name = 'New place' limit 1;
  set local request.jwt.claims = '{"sub":"dddd4444-0000-0000-0000-00000000d002"}';
  update public.places set name = 'Bear''s Den Overlook' where id = p;
  select * into r from public.places where id = p;
  if not r.name_locked then raise exception 'FAIL: rename did not claim'; end if;
  if r.named_by <> 'dddd4444-0000-0000-0000-00000000d002' then raise exception 'FAIL: rename credited the wrong person'; end if;
  raise notice 'PASS 3: renaming via a plain UPDATE claims the name too';
end $$;

-- 4) An UPDATE that does NOT touch the name leaves ownership alone.
do $$
declare p uuid; before_owner uuid; after_owner uuid;
begin
  select id, named_by into p, before_owner from public.places where name = 'Bear''s Den Overlook';
  set local request.jwt.claims = '{"sub":"dddd4444-0000-0000-0000-00000000d001"}';
  update public.places set rating = 5 where id = p;
  select named_by into after_owner from public.places where id = p;
  if after_owner is distinct from before_owner then
    raise exception 'FAIL: an unrelated edit stole the name (% -> %)', before_owner, after_owner; end if;
  raise notice 'PASS 4: editing other fields does not touch name ownership';
end $$;

-- 5) A BACKGROUND write (no auth.uid) claims nothing — automation must never become
--    the owner of a name.
do $$
declare p uuid;
begin
  set local request.jwt.claims = '';
  insert into public.places (name, lat, lng, saved) values ('Auto Cluster 7', 38.1, -78.1, true) returning id into p;
  if (select name_locked from public.places where id = p) then
    raise exception 'FAIL: a job with no user claimed a name'; end if;
  if (select named_by from public.places where id = p) is not null then
    raise exception 'FAIL: a job with no user was recorded as the namer'; end if;
  raise notice 'PASS 5: an unauthenticated/background write claims nothing';
end $$;

do $$ begin raise notice 'PASS: 0131 names are claimed on write from every path'; end $$;
rollback;
