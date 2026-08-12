-- 0168 — §0.8 phase 5 (SWITCH READERS). The statistics read the canonical model.
--
-- Phase 4 proved the new model reproduces today's numbers exactly, on a restored
-- production snapshot: Both 52/101/16, Erica 128/442/42, Josh 57/148/29. This migration
-- makes the functions actually USE it, and the same parity must hold afterwards.
--
-- WHAT CHANGES INSIDE, and nothing else:
--
--   * `status='taken'`                 → `accepted_visits` (taken AND accepted). §0.4:
--                                        "unaccepted places/visits never contribute".
--   * `solo_profile IS NULL` juggling  → `visit_profiles` rows. The null special case is
--                                        the thing §0.3 exists to delete; it cannot
--                                        express three people, which is the whole point
--                                        of the flok work.
--   * `end_date > start_date OR is_trip` inline → `public.counts_as_trip(v)`. §0.4:
--                                        "No UI component may reimplement it" — and no
--                                        SQL function either.
--   * trips also require `parent_visit_id IS NULL` — §0.4 counts TOP-LEVEL trips, so a
--                                        restaurant grouped inside a Cape Cod week is
--                                        not a second trip.
--
-- WHAT DOES NOT CHANGE: places are still `counts_as_place`, which is GENERATED as
-- `NOT is_trail` — byte-identical to §0.4's "non-trail places" rule, so this is a
-- rename, not a redefinition. Miles keep the existing shared_group_id dedupe, which
-- already counts one outing once; activity participants are a later phase.
--
-- Deleted places are now excluded explicitly. They could not previously be, because
-- there was nowhere to say it.
--
-- ROLLBACK: recreate wander_stats from 0159 and trips_list from 0160.

begin;

-- WHAT "BOTH" MEANS, once and for everyone.
--
-- The old shared view was `solo_profile IS NULL`. The obvious translation — "exactly two
-- participant rows" — is wrong, and the test suite caught it: it hardcodes the size of
-- this household. In a database with one member, or three, nothing is ever "shared", and
-- 0137 failed with "marking a visit as a trip must add one trip (0 -> 0)".
--
-- The honest rule is about MEMBERSHIP, not arithmetic: a visit is shared when every real
-- member was on it. Two members today gives exactly the 101 visits that `solo_profile IS
-- NULL` gave. One member gives that person's visits. Three gives the ones all three
-- shared. Nothing hardcodes the number 2.
--
-- Automation accounts are excluded by name — a Test Bot is not a person who went
-- anywhere, and counting it would make every visit unshared.
create or replace function public.is_shared_visit(p_visit uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select not exists (
    select 1 from public.profiles p
     where p.role in ('owner','editor')
       and coalesce(p.display_name,'') !~* '(test|bot)'
       and not exists (
         select 1 from public.visit_profiles vp
          where vp.visit_id = p_visit and vp.profile_id = p.id)
  );
$function$;

comment on function public.is_shared_visit(uuid) is
  'True when EVERY real member was on this visit — the canonical replacement for '
  'solo_profile IS NULL. Does not hardcode how many members there are (§0.3).';

revoke all on function public.is_shared_visit(uuid) from public, anon;
grant execute on function public.is_shared_visit(uuid) to authenticated;

create or replace function public.wander_stats(p_profile uuid default null)
returns table(places_count integer, miles double precision, trips_count integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  with qv as (
    -- Accepted + taken, scoped by PARTICIPANT ROWS rather than a nullable column.
    -- p_profile null = the shared view: visits both members were on.
    select av.id, av.place_id, av.is_trip_qualified, av.is_headline
      from public.accepted_visits av
     where case
             when p_profile is null then public.is_shared_visit(av.id)
             else exists (select 1 from public.visit_profiles vp
                           where vp.visit_id = av.id and vp.profile_id = p_profile)
           end
  ),
  qa as (
    -- One outing counted once: the same run recorded by two people shares a
    -- shared_group_id, and only the best record of the group contributes (0140/0141).
    select distinct on (coalesce(a.shared_group_id, a.id)) a.id, a.distance
      from public.activities a
     where a.place_id is not null
       and case when p_profile is null
                then a.solo_profile is null
                else (a.solo_profile is null or a.solo_profile = p_profile) end
     order by coalesce(a.shared_group_id, a.id),
              (a.summary_polyline is not null) desc,
              (a.source = 'strava') desc,
              a.id
  )
  select
    (select count(distinct p.id)::int
       from public.places p join qv on qv.place_id = p.id
      where p.counts_as_place            -- GENERATED as NOT is_trail (§0.4)
        and p.deleted_at is null)                                  as places_count,
    (select coalesce(sum(qa.distance),0)/1609.344 from qa)         as miles,
    -- TOP-LEVEL qualifying visits only: a child grouped inside a trip is not a
    -- second trip (§0.4).
    (select count(*)::int from qv
      where qv.is_trip_qualified and qv.is_headline)               as trips_count;
$function$;

comment on function public.wander_stats(uuid) is
  'Places, miles and trips from the canonical accepted-visit model (§0.4). Participants '
  'come from visit_profiles; trip qualification from counts_as_trip().';

create or replace function public.trips_list(p_profile uuid default null)
returns table(
  visit_id uuid,
  place_id uuid,
  name text,
  start_date date,
  end_date date,
  nights integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select av.id, p.id, p.name, av.start_date, av.end_date,
         (av.end_date - av.start_date)::int as nights
    from public.accepted_visits av
    join public.places p on p.id = av.place_id
   where av.is_trip_qualified
     and av.is_headline
     and p.deleted_at is null
     and case
           when p_profile is null then public.is_shared_visit(av.id)
           else exists (select 1 from public.visit_profiles vp
                         where vp.visit_id = av.id and vp.profile_id = p_profile)
         end
   order by av.start_date desc;
$function$;

comment on function public.trips_list(uuid) is
  'The trips behind the number, from the same canonical definition the count uses — so '
  'the list and the count can never disagree (§0.4).';

revoke all on function public.wander_stats(uuid) from public, anon;
grant execute on function public.wander_stats(uuid) to authenticated;
revoke all on function public.trips_list(uuid) from public, anon;
grant execute on function public.trips_list(uuid) to authenticated;

commit;
