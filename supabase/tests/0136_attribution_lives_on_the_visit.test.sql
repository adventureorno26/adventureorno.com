-- DB test for 0136 — attribution lives on the visit, and the place-level column is
-- gone for good. Seeded with the REAL shapes that were broken (ground rule 2: seed
-- the shape, then assert; every rule here has a negative control).
begin;

insert into auth.users (id, email) values
  ('aaaa7777-0000-0000-0000-00000000d001','v136-erica@example.test'),
  ('aaaa7777-0000-0000-0000-00000000d002','v136-josh@example.test') on conflict do nothing;
insert into public.profiles (id, role, display_name) values
  ('aaaa7777-0000-0000-0000-00000000d001','owner','V136 Erica'),
  ('aaaa7777-0000-0000-0000-00000000d002','editor','Josh') on conflict do nothing;
set local request.jwt.claims = '{"sub":"aaaa7777-0000-0000-0000-00000000d001"}';

-- 1) THE MECHANISM IS GONE. Not "is null everywhere" — absent, so no read can
--    resurrect the bug and no write can repopulate it.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='places' and column_name='solo_profile'
  ) then
    raise exception 'FAIL: places.solo_profile still exists — attribution can leak again';
  end if;
  raise notice 'PASS 1: places.solo_profile is gone';
end $$;

-- 2) THE REHOBOTH SHAPE. A place whose only visit is Erica's must read as Erica,
--    not "Both". This is the exact bug: the old read said Both because the place
--    column was null.
do $$
declare p uuid; got uuid; v uuid;
begin
  insert into public.places (name, lat, lng, saved) values ('V136 Rehoboth', 38.72, -75.07, true) returning id into p;
  insert into public.visits (place_id, start_date, end_date, manual, solo_override)
    values (p, '2026-05-01','2026-05-03', true, true);
  -- Erica's alone: replace the everyone-by-default rows (0188).
  delete from public.visit_profiles vp using public.visits v
   where vp.visit_id = v.id and v.place_id = p;
  insert into public.visit_profiles (visit_id, profile_id)
  select v.id, 'aaaa7777-0000-0000-0000-00000000d001' from public.visits v where v.place_id = p;

  select solo_profile into got from public.place_attribution() where place_id = p;
  if got is distinct from 'aaaa7777-0000-0000-0000-00000000d001'::uuid then
    raise exception 'FAIL: a solo Erica visit must read as Erica, got %', coalesce(got::text,'Both');
  end if;

  -- NEGATIVE CONTROL: add a joint visit and it must flip to Both. If the rule were
  -- removed (e.g. "first visit wins"), this assertion fails.
  -- A JOINT VISIT NOW HAS TO SAY SO (0193). A bare insert used to mean "everyone";
  -- since "just me" became the default it means the one person who made it, and being
  -- together is a tag a person accepts rather than something the app assumes.
  insert into public.visits (place_id, start_date, end_date, manual)
    values (p, '2026-06-01','2026-06-01', true) returning id into v;
  insert into public.visit_profiles (visit_id, profile_id)
  select v, pr.id from public.profiles pr where pr.role in ('owner','editor')
  on conflict do nothing;
  select solo_profile into got from public.place_attribution() where place_id = p;
  if got is not null then
    raise exception 'FAIL: a place with a joint visit must read Both, got %', got;
  end if;
  raise notice 'PASS 2: solo reads solo, joint reads Both';
end $$;

-- 3) TWO PEOPLE, SEPARATELY, IS STILL BOTH. Erica-only + Josh-only visits mean the
--    place belongs to neither one of them exclusively.
do $$
declare p uuid; got uuid; found boolean;
begin
  insert into public.places (name, lat, lng, saved) values ('V136 Shared Trail', 39.1, -77.6, true) returning id into p;
  insert into public.visits (place_id, start_date, end_date, manual) values
    (p,'2026-01-05','2026-01-05',true),
    (p,'2026-01-12','2026-01-12',true);
  -- one visit each, as rows (0188)
  delete from public.visit_profiles vp using public.visits v
   where vp.visit_id = v.id and v.place_id = p;
  insert into public.visit_profiles (visit_id, profile_id)
  select v.id,
         case when v.start_date = '2026-01-05' then 'aaaa7777-0000-0000-0000-00000000d001'
              else 'aaaa7777-0000-0000-0000-00000000d002' end::uuid
    from public.visits v where v.place_id = p;
  select solo_profile, true into got, found from public.place_attribution() where place_id = p;
  if not coalesce(found,false) then raise exception 'FAIL: place missing from place_attribution()'; end if;
  if got is not null then raise exception 'FAIL: Erica-only + Josh-only must read Both, got %', got; end if;
  raise notice 'PASS 3: separate solo visits by both people read Both';
end $$;

-- 4) THE ARMY TEN MILER SHAPE. A place only Erica has visited must NOT appear in
--    Josh's view, and must appear in hers. place_ids_for_view is the one filter.
do $$
declare p uuid; in_erica boolean; in_josh boolean; in_both boolean;
begin
  insert into public.places (name, lat, lng, saved) values ('V136 Army Ten Miler', 38.87, -77.06, true) returning id into p;
  insert into public.visits (place_id, start_date, end_date, manual, solo_override)
    values (p,'2025-10-12','2025-10-12', true, true);
  delete from public.visit_profiles vp using public.visits v
   where vp.visit_id = v.id and v.place_id = p;
  insert into public.visit_profiles (visit_id, profile_id)
  select v.id, 'aaaa7777-0000-0000-0000-00000000d001' from public.visits v where v.place_id = p;

  select exists(select 1 from public.place_ids_for_view('aaaa7777-0000-0000-0000-00000000d001') x where x = p) into in_erica;
  select exists(select 1 from public.place_ids_for_view('aaaa7777-0000-0000-0000-00000000d002') x where x = p) into in_josh;
  select exists(select 1 from public.place_ids_for_view(null) x where x = p) into in_both;

  if not in_erica then raise exception 'FAIL: Erica''s own race is missing from her view'; end if;
  if in_josh then raise exception 'FAIL: Erica''s race leaked into Just Josh'; end if;
  if in_both then raise exception 'FAIL: a solo race must not appear in the Both view'; end if;
  raise notice 'PASS 4: a solo place stays in exactly one person''s view';
end $$;

-- 5) THE THREE VIEWS MUST DISAGREE. If some filter silently stopped filtering, the
--    counts would collapse to one number — this is the regression that shipped.
do $$
declare e int; j int; b int;
begin
  select count(*) into e from public.place_ids_for_view('aaaa7777-0000-0000-0000-00000000d001');
  select count(*) into j from public.place_ids_for_view('aaaa7777-0000-0000-0000-00000000d002');
  select count(*) into b from public.place_ids_for_view(null);
  if e = j and j = b then
    raise exception 'FAIL: all three views returned % places — the view filter is not filtering', e;
  end if;
  if e < b or j < b then
    raise exception 'FAIL: a person''s view must include the joint places (e=% j=% both=%)', e, j, b;
  end if;
  raise notice 'PASS 5: Just Erica / Just Josh / Both disagree (e=% j=% both=%)', e, j, b;
end $$;

-- 6) Members only.
do $$
declare ok boolean := false;
begin
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000fd"}';
  begin perform public.place_attribution(); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a non-member read attribution'; end if;
  raise notice 'PASS 6: non-member denied';
end $$;

do $$ begin raise notice 'PASS: 0136 attribution lives on the visit'; end $$;
rollback;
