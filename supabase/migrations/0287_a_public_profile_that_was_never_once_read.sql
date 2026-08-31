-- 0287 — the public profile could not be read by anybody, and a blocked viewer could.
--
-- TWO DEFECTS IN ONE FUNCTION, both invisible for the same reason: nobody has published
-- themselves yet, so every call to `public_profile()` returned NULL at the early exit and
-- no call ever reached the body. It looked like it worked. It has never once run.
--
-- 1. IT RAISES FOR ANY PUBLISHED PROFILE. The function is declared STABLE and creates four
--    temporary tables. Postgres refuses:
--        0A000: CREATE TABLE is not allowed in a non-volatile function
--    So the moment a person sets profile_visibility='public', their page stops being a page
--    and starts being an error. Measured on production inside a rolled-back transaction:
--    publish `erica`, call it as Josh, and it raises rather than returning JSON.
--
--    The fix is NOT to mark it VOLATILE. A profile read should be STABLE — that is what lets
--    the planner call it once — and `create temporary table if not exists` inside a SECURITY
--    DEFINER function is a footgun besides: the tables are `on commit drop` but reused across
--    calls inside one transaction, so two profiles read in the same transaction would each
--    have to remember to empty them. They are CTEs now. No shared state, nothing to empty.
--
-- 2. A BLOCKED VIEWER STILL GOT THE PAGE. The function carried its own admission:
--        -- TODO (item 2, blocking): when block lists land, a blocked viewer gets this
--        -- same NULL.
--    The block lists landed in 0284. The TODO did not get closed. `is_blocked_between()` is
--    symmetric, so one call covers both directions — the person who blocked and the person
--    who was blocked each get the same "no page here" as a handle that does not exist.
--    One answer for all three cases is deliberate: a distinct "you are blocked" would tell
--    you something about a person who has chosen to tell you nothing.
--
-- Everything else about the function is unchanged and deliberately so: accepted tags only,
-- one row per canonical outing (`coalesce(shared_group_id, id)`, so 15 miles run together
-- is 15 miles), and the §7d Strava rule transposed to the profile owner — their own
-- recordings are theirs to publish, somebody else's are not ours to republish.
--
-- No "expected exactly N" assertions: db-test.sh replays this from an empty schema.

create or replace function public.public_profile(p_handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  pr        public.profiles%rowtype;
  v_stats   jsonb := null;
  v_places  jsonb := null;
  v_acts    jsonb := null;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  select * into pr
    from public.profiles
   where handle = nullif(btrim(lower(coalesce(p_handle, ''))), '')
     and profile_visibility = 'public';
  if not found then
    -- No such handle, or an account that has not published itself. One answer for both.
    return null;
  end if;

  -- CLOSES THE TODO 0283 LEFT HERE. is_blocked_between is symmetric, so this covers the
  -- blocker and the blocked alike, and both get the same answer as a handle that does not
  -- exist. Saying "you are blocked" would tell you something about somebody who has chosen
  -- to tell you nothing.
  if public.is_blocked_between(pr.id, auth.uid()) then
    return null;
  end if;

  if pr.public_stats then
    with sv as (
      select distinct v.id as visit_id
        from public.memory_people mp
        join public.memory_subjects s on s.id = mp.subject_id and s.kind = 'visit'
        join public.people pe on pe.id = mp.person_id
                             and pe.linked_profile = pr.id
                             and pe.deleted_at is null
        join public.visits v on v.id = s.visit_id
       where mp.participation_status = 'accepted'
         and v.status = 'taken'
         and v.accepted_at is not null
    ), so as (
      select distinct on (coalesce(a.shared_group_id, a.id)) a.id as act_id, a.distance
        from public.memory_people mp
        join public.memory_subjects s on s.id = mp.subject_id and s.kind = 'outing'
        join public.people pe on pe.id = mp.person_id
                             and pe.linked_profile = pr.id
                             and pe.deleted_at is null
        join public.activities a on a.id = s.activity_id
       where mp.participation_status = 'accepted'
         and (lower(coalesce(a.original_source, '')) <> 'strava' or a.owner_profile = pr.id)
       order by coalesce(a.shared_group_id, a.id),
                (a.summary_polyline is not null) desc,
                (a.source = 'strava') desc,
                a.id
    )
    select jsonb_build_object(
             'places', (select count(distinct pl.id)::int
                          from sv
                          join public.visits v on v.id = sv.visit_id
                          join public.places pl on pl.id = v.place_id
                         where pl.counts_as_place and pl.deleted_at is null),
             'miles',  (select round((coalesce(sum(so.distance), 0) / 1609.344)::numeric, 1) from so),
             'trips',  (select count(*)::int
                          from sv
                          join public.visits v on v.id = sv.visit_id
                         where v.parent_visit_id is null and public.counts_as_trip(v.*)))
      into v_stats;
  end if;

  if pr.public_places then
    with sv as (
      select distinct v.id as visit_id
        from public.memory_people mp
        join public.memory_subjects s on s.id = mp.subject_id and s.kind = 'visit'
        join public.people pe on pe.id = mp.person_id
                             and pe.linked_profile = pr.id
                             and pe.deleted_at is null
        join public.visits v on v.id = s.visit_id
       where mp.participation_status = 'accepted'
         and v.status = 'taken'
         and v.accepted_at is not null
    )
    select coalesce(jsonb_agg(t order by t->>'name'), '[]'::jsonb) into v_places
      from (
        select jsonb_build_object(
                 'name', pl.name,
                 'lat', pl.lat,
                 'lng', pl.lng,
                 'categories', to_jsonb(coalesce(pl.categories, array[]::text[])),
                 'visits', count(*)::int) as t
          from sv
          join public.visits v on v.id = sv.visit_id
          join public.places pl on pl.id = v.place_id
         where pl.counts_as_place and pl.deleted_at is null
         group by pl.id, pl.name, pl.lat, pl.lng, pl.categories
         order by pl.name
         limit 250) z;
  end if;

  if pr.public_activity then
    with sv as (
      select distinct v.id as visit_id
        from public.memory_people mp
        join public.memory_subjects s on s.id = mp.subject_id and s.kind = 'visit'
        join public.people pe on pe.id = mp.person_id
                             and pe.linked_profile = pr.id
                             and pe.deleted_at is null
        join public.visits v on v.id = s.visit_id
       where mp.participation_status = 'accepted'
         and v.status = 'taken'
         and v.accepted_at is not null
    ), so as (
      select distinct on (coalesce(a.shared_group_id, a.id)) a.id as act_id
        from public.memory_people mp
        join public.memory_subjects s on s.id = mp.subject_id and s.kind = 'outing'
        join public.people pe on pe.id = mp.person_id
                             and pe.linked_profile = pr.id
                             and pe.deleted_at is null
        join public.activities a on a.id = s.activity_id
       where mp.participation_status = 'accepted'
         and (lower(coalesce(a.original_source, '')) <> 'strava' or a.owner_profile = pr.id)
       order by coalesce(a.shared_group_id, a.id),
                (a.summary_polyline is not null) desc,
                (a.source = 'strava') desc,
                a.id
    )
    select coalesce(jsonb_agg(t order by t->>'happened_on' desc), '[]'::jsonb) into v_acts
      from (
        select jsonb_build_object(
                 'kind', 'outing',
                 'happened_on', coalesce(a.local_date, (a.start_date at time zone 'UTC')::date),
                 'title', a.name,
                 'type', a.type,
                 'place_name', pl.name,
                 'distance', a.distance) as t,
               coalesce(a.local_date, (a.start_date at time zone 'UTC')::date) as on_day
          from so
          join public.activities a on a.id = so.act_id
          left join public.places pl on pl.id = a.place_id
        union all
        select jsonb_build_object(
                 'kind', 'visit',
                 'happened_on', v.start_date,
                 'title', null::text,
                 'type', null::text,
                 'place_name', pl.name,
                 'distance', null::double precision),
               v.start_date
          from sv
          join public.visits v on v.id = sv.visit_id
          left join public.places pl on pl.id = v.place_id
        order by on_day desc nulls last
        limit 50) z;
  end if;

  return jsonb_build_object(
    'handle',       pr.handle,
    'display_name', pr.display_name,
    'avatar_url',   pr.avatar_url,
    'bio',          pr.bio,
    'member_since', pr.created_at::date,
    'shows', jsonb_build_object('stats',    pr.public_stats,
                                'places',   pr.public_places,
                                'activity', pr.public_activity),
    'stats',    v_stats,
    'places',   v_places,
    'activity', v_acts);
end
$function$;

-- A definer function default-grants EXECUTE to PUBLIC. 0101 shipped that mistake once and
-- 0274 had to undo it again this week; state the grant rather than inherit it.
revoke execute on function public.public_profile(text) from public, anon;
grant  execute on function public.public_profile(text) to authenticated;

-- THE SEARCH SIDE. find_profiles never considered a block either: it reads `profiles`
-- as a definer, so RLS cannot save it. A blocked person is not in your search results.
create or replace function public.find_profiles(p_query text, p_limit integer default 20)
returns table(handle text, display_name text, avatar_url text, bio text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with q as (
    select t as term,
           regexp_replace(t, '([%_\\])', '\\\1', 'g') as pat
      from (select nullif(btrim(lower(coalesce(p_query, ''))), '') as t) s
  )
  select p.handle, p.display_name, p.avatar_url, p.bio
    from public.profiles p, q
   where auth.uid() is not null
     and q.term is not null
     and char_length(q.term) >= 2
     and p.profile_visibility = 'public'
     and not public.is_blocked_between(p.id, auth.uid())
     and (p.handle like q.pat || '%' escape '\'
       or lower(coalesce(p.display_name, '')) like '%' || q.pat || '%' escape '\')
   order by (p.handle = q.term) desc,
            (p.handle like q.pat || '%' escape '\') desc,
            p.display_name nulls last,
            p.handle
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$function$;

revoke execute on function public.find_profiles(text, integer) from public, anon;
grant  execute on function public.find_profiles(text, integer) to authenticated;

comment on function public.public_profile(text) is
  'One person''s published page. Returns NULL for an unknown handle, an unpublished '
  'account and a block alike — one answer for all three, because a distinct answer would '
  'tell a blocked viewer something about somebody who chose to tell them nothing.';
