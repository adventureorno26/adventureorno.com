-- 0175 — no human being is looked up by name.
--
-- §0.9 requires these to be permanent, not remembered. Everything runs inside one
-- transaction and rolls back; nothing here touches real data.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('bbbb0175-0000-0000-0000-000000000001', 'a0175@example.invalid'),
  ('bbbb0175-0000-0000-0000-000000000002', 'b0175@example.invalid'),
  ('bbbb0175-0000-0000-0000-000000000003', 'c0175@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('bbbb0175-0000-0000-0000-000000000001', 'A0175', 'owner'),
  ('bbbb0175-0000-0000-0000-000000000002', 'B0175', 'editor'),
  ('bbbb0175-0000-0000-0000-000000000003', 'C0175', 'editor')
on conflict (id) do update set role = excluded.role, display_name = excluded.display_name;
set local request.jwt.claims = '{"sub":"bbbb0175-0000-0000-0000-000000000001"}';

-- ---------------------------------------------------------------------------
-- 1. NOTHING IN THE DATABASE RESOLVES A PERSON BY DISPLAY NAME.
--    This is the assertion that keeps the hardcode from coming back anywhere,
--    not just in the function it was found in.
-- ---------------------------------------------------------------------------
do $$
declare f text; bad text[] := '{}';
begin
  for f in
    select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosrc ~* 'display_name\s*=\s*''[A-Z]'
  loop
    bad := bad || f;
  end loop;

  if array_length(bad,1) > 0 then
    raise exception 'FAIL: % function(s) look a person up by name, e.g. %()',
      array_length(bad,1), bad[1];
  end if;

  raise notice 'PASS 1: no function identifies a member by display_name';
end $$;

-- ---------------------------------------------------------------------------
-- 2. A profile id attributes to THAT person — including a third member, who the
--    old 'josh' value could never name.
-- ---------------------------------------------------------------------------
do $$
declare
  c_id uuid := 'bbbb0175-0000-0000-0000-000000000003';
  res jsonb; v_visit uuid; solo uuid;
begin
  res := public.create_experience(
    'key-0175-third',
    jsonb_build_object('name', 'T175 Third Member', 'lat', 38.4, 'lng', -77.3),
    jsonb_build_object('date', '2026-07-04', 'who', c_id::text));

  v_visit := (res->>'visit_id')::uuid;
  if v_visit is null then raise exception 'FAIL: no visit was created'; end if;

  select solo_profile into solo from public.visits where id = v_visit;
  if solo is distinct from c_id then
    raise exception 'FAIL: the visit should belong to the third member, got %', solo; end if;

  raise notice 'PASS 2: a third member can be named, which the old value could not do';
end $$;

-- ---------------------------------------------------------------------------
-- 3. 'me' and 'both' still mean what they meant.
-- ---------------------------------------------------------------------------
do $$
declare
  a_id uuid := 'bbbb0175-0000-0000-0000-000000000001';
  res jsonb; solo uuid; ovr boolean;
begin
  res := public.create_experience(
    'key-0175-me',
    jsonb_build_object('name', 'T175 Mine', 'lat', 38.41, 'lng', -77.31),
    jsonb_build_object('date', '2026-07-05', 'who', 'me'));
  select solo_profile into solo from public.visits where id = (res->>'visit_id')::uuid;
  if solo is distinct from a_id then raise exception 'FAIL: ''me'' must be the caller'; end if;

  res := public.create_experience(
    'key-0175-both',
    jsonb_build_object('name', 'T175 Both', 'lat', 38.42, 'lng', -77.32),
    jsonb_build_object('date', '2026-07-06', 'who', 'both'));
  select solo_profile, solo_override into solo, ovr
    from public.visits where id = (res->>'visit_id')::uuid;
  if solo is not null then raise exception 'FAIL: ''both'' must leave no solo profile'; end if;
  if not ovr then raise exception 'FAIL: ''both'' is a decision and must be recorded as one'; end if;

  raise notice 'PASS 3: me and both are unchanged';
end $$;

-- ---------------------------------------------------------------------------
-- 4. A NAME IS NO LONGER ACCEPTED, and an unknown profile fails LOUDLY instead
--    of silently becoming "both" — which is what the old lookup did.
-- ---------------------------------------------------------------------------
do $$
declare res jsonb;
begin
  begin
    res := public.create_experience(
      'key-0175-name',
      jsonb_build_object('name', 'T175 Name', 'lat', 38.43, 'lng', -77.33),
      jsonb_build_object('date', '2026-07-07', 'who', 'josh'));
    raise exception 'FAIL: a display name was accepted as attribution';
  exception when others then
    if position('profile id' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    res := public.create_experience(
      'key-0175-ghost',
      jsonb_build_object('name', 'T175 Ghost', 'lat', 38.44, 'lng', -77.34),
      jsonb_build_object('date', '2026-07-08',
                         'who', '00000000-0000-0000-0000-0000000000ff'));
    raise exception 'FAIL: an unknown profile was silently accepted';
  exception when others then
    if position('no such profile' in sqlerrm) = 0 then raise; end if;
  end;

  raise notice 'PASS 4: a name is rejected and an unknown profile fails loudly';
end $$;

rollback;
