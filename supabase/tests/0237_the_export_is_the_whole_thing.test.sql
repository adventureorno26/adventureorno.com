-- The export must be the whole thing, must match its own table of contents, and must not be
-- a way around the rules.
--
-- Before 0237, "Download everything you can take with you" produced 162 places and left 567
-- activities, 552 visits, 178 photos and 17,128 pings behind. The fix is only worth having if
-- three things stay true, so this asserts all three:
--
--   1. the table of contents and the contents cannot drift apart
--   2. an unknown section is NULL, not an empty array — "nothing here" is not "no such thing"
--   3. AND THE IMPORTANT ONE: an export runs as the person asking, so it hands out exactly
--      what they could already see. A definer function here would have quietly undone 0228.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('eeee0237-0000-0000-0000-000000000001','e0237@example.invalid'),
  ('eeee0237-0000-0000-0000-000000000002','j0237@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role, share_tagged_outings) values
  ('eeee0237-0000-0000-0000-000000000001','E0237','owner', false),
  ('eeee0237-0000-0000-0000-000000000002','J0237','editor', false)
on conflict (id) do update set role = excluded.role,
                               share_tagged_outings = excluded.share_tagged_outings;

-- ---- 1. Every section the manifest promises exists, and has the count it claimed ---------
do $$
declare r record;
begin
  for r in select * from public.export_manifest() loop
    if public.export_section(r.section) is null then
      raise exception 'FAIL: the manifest lists "%" but export_section does not know it', r.section;
    end if;
    if jsonb_typeof(public.export_section(r.section)) <> 'array' then
      raise exception 'FAIL: section "%" is not an array', r.section;
    end if;
    if jsonb_array_length(public.export_section(r.section)) <> r.rows then
      raise exception 'FAIL: the manifest promises % rows of "%" and the section has %',
        r.rows, r.section, jsonb_array_length(public.export_section(r.section));
    end if;
  end loop;
end $$;

-- ---- 1b. Paging a section partitions it — no row twice, none missing (0239) --------------
-- `location_pings` is the only section that pages, and the reason it must be exact is that a
-- ping is where somebody actually was: a row dropped between pages is a place they went that
-- the archive says they did not.
do $$
declare n bigint; paged bigint; distinct_paged bigint; missing bigint;
begin
  select rows into n from public.export_manifest() where section = 'location_pings';
  if n < 3 then return; end if;  -- nothing to partition on a fresh database

  with pages as (
    select e from generate_series(0, n::int, greatest((n / 3)::int, 1)) o,
         lateral jsonb_array_elements(
           public.export_section('location_pings', o, greatest((n / 3)::int, 1))) e),
   whole as (select e from jsonb_array_elements(public.export_section('location_pings')) e)
  select (select count(*) from pages),
         (select count(distinct e->>'id') from pages),
         (select count(*) from (select e->>'id' from whole
                                except select e->>'id' from pages) q)
    into paged, distinct_paged, missing;

  if paged <> n then
    raise exception 'FAIL: paging location_pings returned % rows of %', paged, n;
  end if;
  if distinct_paged <> n then
    raise exception 'FAIL: paging location_pings returned a row in more than one page';
  end if;
  if missing <> 0 then
    raise exception 'FAIL: % pings are in the section but in no page', missing;
  end if;
  if jsonb_array_length(public.export_section('location_pings', (n + 1000)::int, 10)) <> 0 then
    raise exception 'FAIL: paging past the end of location_pings did not return nothing';
  end if;
end $$;

-- ---- 2. A name that is not a section is NULL, not empty ---------------------------------
do $$
begin
  if public.export_section('strava_accounts') is not null then
    raise exception 'FAIL: strava_accounts answered as if it were a section of the archive';
  end if;
  if public.export_section('') is not null or public.export_section('nonsense') is not null then
    raise exception 'FAIL: an unknown section did not answer NULL';
  end if;
end $$;

-- ---- 3. No section carries a credential --------------------------------------------------
-- Not a guess about which tables were included: it looks at what actually comes out.
do $$
declare r record; k text;
begin
  for r in select * from public.export_manifest() loop
    for k in select distinct jsonb_object_keys(e)
               from jsonb_array_elements(public.export_section(r.section)) e loop
      if k ~* '(access|refresh|secret|password|api)_?(token|key)?$' and k <> 'external_key' then
        raise exception 'FAIL: section "%" carries a field called "%"', r.section, k;
      end if;
    end loop;
  end loop;
end $$;

-- ---- 4. THE ONE THAT MATTERS: the export does not go around sharing ----------------------
do $$
declare
  e_id uuid := 'eeee0237-0000-0000-0000-000000000001';
  j_id uuid := 'eeee0237-0000-0000-0000-000000000002';
  act  uuid;
begin
  -- Hers, from Strava, and she has NOT chosen to share what she tags.
  insert into public.activities
    (id,type,name,distance,start_date,lat,lng,owner_profile,source,original_source)
  values (gen_random_uuid(),'Run','Hers alone 0237',5000,'2026-05-05T12:00:00Z',39.1,-77.5,
          e_id,'strava','strava')
  returning id into act;
  -- He is even tagged on it — the strongest version of the case, because a tag is what
  -- 0228 treats as sharing WHEN THE OWNER HAS TURNED IT ON. She has not.
  insert into public.memory_people (subject_id, person_id, participation_status, evidence, created_by)
  select public.subject_for_activity(t.activity_id::uuid), public.person_for_profile(t.profile_id::uuid), t.claim_status, t.evidence, t.created_by
    from (values (act, j_id, 'proposed', 'owner_asserted', 'user')) t(activity_id, profile_id, claim_status, evidence, created_by);
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','eeee0237-0000-0000-0000-000000000002','role','authenticated')::text, true);

do $$
begin
  if public.export_section('activities') @> jsonb_build_array(
       jsonb_build_object('name','Hers alone 0237')) then
    raise exception 'FAIL: the export handed him a recording its owner has not shared';
  end if;
  if exists (select 1 from jsonb_array_elements(public.export_section('activities')) a
              where a->>'name' = 'Hers alone 0237') then
    raise exception 'FAIL: the export handed him a recording its owner has not shared';
  end if;
  -- And the manifest must not tell him it is there either — a count is a fact about the data.
  if exists (select 1 from public.export_manifest() m
              where m.section = 'activities'
                and m.rows > (select count(*) from public.activities)) then
    raise exception 'FAIL: the manifest counts more activities than he can see';
  end if;
end $$;

reset role;

do $$ begin raise notice 'PASS 0237: the archive matches its own table of contents, carries no credential, and hands out only what the person asking could already see'; end $$;

rollback;
