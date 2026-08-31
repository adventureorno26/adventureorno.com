-- 0297 — the fog belongs to one space.
--
-- LOCAL disposable stack only (scripts/db-test.sh). Replays from an EMPTY schema, so nothing
-- here asserts a production count.
--
-- THE ASSERTION THAT MATTERS is not "there is one row per space" — it is that ANN'S FOG DOES
-- NOT COVER GROUND ONLY BEN HAS STOOD ON. Before 0297 the rebuild unioned every ping in the
-- database into a single row, so had it succeeded at all it would have drawn his travel as
-- uncovered ground on her map. Row counts would not have noticed; geometry does.
--
-- Two points 3,700km apart (Virginia and Los Angeles) so the 10km buffers cannot touch, and
-- a failure means a real leak rather than an arithmetic edge.
--
--   1. One row per space, including a space with nothing in it.
--   2. Ann's fog covers Ann's ground.
--   3. ANN'S FOG DOES NOT COVER BEN'S GROUND, and Ben's does not cover Ann's.
--   4. The reader returns only what the caller may see.
--   5. The test can fail — rebuilt without the space filter, section 3 would.

begin;

-- ⚠️ PRODUCTION'S `default_space()`, INSTALLED HERE, and the test is worthless without it.
--
-- 0292 section 8 replaces `default_space()` with `select current_space()` inside the branch
-- that actually forks, and an empty schema never forks — so a replay keeps 0289's "biggest
-- space" fallback. That fallback fills `space_id` NON-NULL and, with two spaces, fills it
-- WRONG: it hands every caller-less row to whichever space has the most members. 0295's
-- trigger only fires when `space_id is null`, so under the fallback it never runs at all.
--
-- The first draft of this file omitted this and section 3 failed — Ben's ping landed in
-- Ann's space, so of course her fog covered his ground. That was CI's schema talking, not
-- production's. The 0295 test carries the same preamble for the same reason, and any test
-- that asserts WHERE A ROW LANDS needs it.
create or replace function public.default_space()
returns uuid language sql stable security definer set search_path to 'public' as $fn$
  select public.current_space();
$fn$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('a0297000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ann0297@x.test','x',now(),now()),
       ('a0297000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ben0297@x.test','x',now(),now());

insert into public.profiles (id, display_name, role) values ('a0297000-0000-0000-0000-000000000001','Ann 0297','owner');
-- A second space must already exist for ensure_profile_space() to give a non-owner their own.
insert into public.spaces (name, owner_profile) values ('0297 spare space', null);
insert into public.profiles (id, display_name, role) values ('a0297000-0000-0000-0000-000000000002','Ben 0297','editor');

do $$
declare
  v_ann  uuid := 'a0297000-0000-0000-0000-000000000001';
  v_ben  uuid := 'a0297000-0000-0000-0000-000000000002';
  v_asp  uuid; v_bsp uuid;
  ann_pt geometry := ST_SetSRID(ST_MakePoint(-77.5, 39.1), 4326);   -- Virginia
  ben_pt geometry := ST_SetSRID(ST_MakePoint(-118.2, 34.0), 4326);  -- Los Angeles
  v_n integer;
  ann_covers_ann boolean; ann_covers_ben boolean; ben_covers_ann boolean;
begin
  v_asp := public.home_space_of(v_ann);
  v_bsp := public.home_space_of(v_ben);
  if v_asp is null or v_bsp is null or v_asp = v_bsp then
    raise exception 'FAIL: needed two distinct spaces, got % and %', v_asp, v_bsp;
  end if;

  insert into public.location_pings (lat, lng, recorded_at, source, profile_id)
  values (39.1, -77.5, now(), '0297', v_ann), (34.0, -118.2, now(), '0297', v_ben);

  perform public.rebuild_revealed_area();

  -- 1.
  select count(*) into v_n from public.revealed_area;
  if v_n <> (select count(*) from public.spaces) then
    raise exception 'FAIL: % fog row(s) for % space(s)', v_n, (select count(*) from public.spaces);
  end if;
  raise notice 'PASS 0297/1: one fog row per space, including the empty one';

  select ST_Covers(geom::geometry, ann_pt) into ann_covers_ann from public.revealed_area where space_id = v_asp;
  select ST_Covers(geom::geometry, ben_pt) into ann_covers_ben from public.revealed_area where space_id = v_asp;
  select ST_Covers(geom::geometry, ann_pt) into ben_covers_ann from public.revealed_area where space_id = v_bsp;

  -- 2.
  if not coalesce(ann_covers_ann, false) then
    raise exception 'FAIL: Ann''s fog does not cover Ann''s own ground';
  end if;
  raise notice 'PASS 0297/2: a space uncovers its own ground';

  -- 3. THE ONE THAT MATTERS.
  if coalesce(ann_covers_ben, false) then
    raise exception 'FAIL: ANN''S FOG COVERS BEN''S GROUND — the fog leaks across the boundary';
  end if;
  if coalesce(ben_covers_ann, false) then
    raise exception 'FAIL: Ben''s fog covers Ann''s ground — the fog leaks across the boundary';
  end if;
  raise notice 'PASS 0297/3: neither space uncovers the other''s ground';
end $$;

-- 4. The reader, as each of them, through RLS.
do $$
declare v_a jsonb; v_b jsonb;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0297000-0000-0000-0000-000000000001","role":"authenticated"}';
  v_a := public.revealed_area_geojson();
  set local request.jwt.claims = '{"sub":"a0297000-0000-0000-0000-000000000002","role":"authenticated"}';
  v_b := public.revealed_area_geojson();
  reset role;
  if v_a is null or v_a->'crisp' = 'null'::jsonb then
    raise exception 'FAIL: Ann reads no fog at all';
  end if;
  if v_a->'crisp' = v_b->'crisp' then
    raise exception 'FAIL: both accounts read the SAME fog geometry';
  end if;
  raise notice 'PASS 0297/4: each account reads its own fog, and they differ';
exception when others then
  reset role; raise;
end $$;

-- 5. THE TEST CAN FAIL. Rebuild the way 0297 replaced — one row, every space's points — and
--    section 3's assertion must then break. Restored immediately afterwards.
reset request.jwt.claims;
do $$
declare v_asp uuid := public.home_space_of('a0297000-0000-0000-0000-000000000001');
        leaked boolean;
begin
  update public.revealed_area r
     set geom = (select ST_Multi(ST_Union(ST_Buffer(lp.geom::geography, 10000)::geometry))::geography
                   from public.location_pings lp where lp.geom is not null)   -- no space filter
   where r.space_id = v_asp;
  select ST_Covers(geom::geometry, ST_SetSRID(ST_MakePoint(-118.2, 34.0), 4326))
    into leaked from public.revealed_area where space_id = v_asp;
  if not coalesce(leaked, false) then
    raise exception 'FAIL: the unfiltered rebuild did NOT leak, so section 3 cannot fail and proves nothing';
  end if;
  raise notice 'PASS 0297/5: without the space filter Ann''s fog covers Ben''s ground — the test is real';
  perform public.rebuild_revealed_area();
end $$;

rollback;
