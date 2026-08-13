-- 0172 — the remaining counts read the canonical model (§0.4).
--
-- 0168 moved wander_stats and trips_list. These four were still asking the old
-- questions, and one of them was doing the thing §0.1 explicitly forbids.
--
-- THE PARTICIPANT PREDICATE, replaced everywhere:
--
--     case when p_profile is null then v.solo_profile is null
--          else (v.solo_profile is null or v.solo_profile = p_profile) end
--
-- became `is_shared_visit(v.id)` / a `visit_profiles` lookup. Same rows today — proven
-- by parity — but it stops meaning "exactly two people" the moment a third joins, which
-- is the entire point of the flok work.
--
-- ⚠️ occasion_count WAS INFERRING TRIP CONTENTS FROM DATES. It folded any visit whose
-- range sat inside a marked trip's range into that trip — across ALL places, with no
-- relationship between them. §0.1: "Do not infer trip contents from overlapping dates
-- alone." A restaurant visit on 4 August was swallowed by any marked trip covering
-- 4 August, whether or not it had anything to do with it. It now folds a visit only when
-- it is EXPLICITLY grouped, via parent_visit_id — which is what that column exists for.
--
-- ROLLBACK: the previous definitions are in git history (0168 and earlier).

begin;

-- Which places appear in a person's view of the map.
create or replace function public.place_ids_for_view(p_profile uuid default null)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select distinct p.id
    from public.places p
    join public.accepted_visits v on v.place_id = p.id
   where p.counts_as_place
     and p.deleted_at is null
     and case when p_profile is null
              then public.is_shared_visit(v.id)
              else exists (select 1 from public.visit_profiles vp
                            where vp.visit_id = v.id and vp.profile_id = p_profile) end;
$function$;

-- How many separate occasions. A visit explicitly grouped under a trip folds into it.
create or replace function public.occasion_count(p_profile uuid default null)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select count(*)::int
    from public.accepted_visits v
   where v.is_headline                       -- explicitly grouped children fold in (§0.1)
     and case when p_profile is null
              then public.is_shared_visit(v.id)
              else exists (select 1 from public.visit_profiles vp
                            where vp.visit_id = v.id and vp.profile_id = p_profile) end;
$function$;

comment on function public.occasion_count(uuid) is
  'Separate occasions. A visit folds into a trip only when EXPLICITLY grouped by '
  'parent_visit_id — never by overlapping dates, which used to swallow any visit that '
  'happened to fall inside a marked trip''s range, at any place (§0.1).';

-- Visits per place, for the list and the map.
create or replace function public.place_visit_counts(p_profile uuid default null)
returns table(place_id uuid, visits integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select v.place_id, count(*)::integer as visits
    from public.accepted_visits v
    join public.places p on p.id = v.place_id
   where p.deleted_at is null
     and case when p_profile is null
              then public.is_shared_visit(v.id)
              else exists (select 1 from public.visit_profiles vp
                            where vp.visit_id = v.id and vp.profile_id = p_profile) end
   group by v.place_id;
$function$;

-- The pills in Settings › Stats.
create or replace function public.settings_stats(p_profile uuid default null)
returns table(trails_taken bigint, camping bigint, dining bigint, winery bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  with mine as (
    select distinct p.id, p.categories
      from public.places p
      join public.accepted_visits v on v.place_id = p.id
     where p.deleted_at is null
       and case when p_profile is null
                then public.is_shared_visit(v.id)
                else exists (select 1 from public.visit_profiles vp
                              where vp.visit_id = v.id and vp.profile_id = p_profile) end
  )
  select
    (select count(*) from mine where categories && array['hiking','walking','running','biking'])::bigint,
    (select count(*) from mine where categories && array['camping'])::bigint,
    (select count(*) from mine where categories && array['dining'])::bigint,
    (select count(*) from mine where categories && array['winery'])::bigint;
$function$;

-- What is INSIDE a trip. This was the last date-inference reader, and the most
-- visible one: it feeds the card's "N places" expansion. It joined every visit whose
-- range sat inside the trip's range, at any place — so a restaurant you went to on the
-- same day in another state appeared inside your Cape Cod week. §0.1 again.
--
-- A trip contains what is EXPLICITLY grouped under it. That is what parent_visit_id is.
create or replace function public.trip_contents(p_visit uuid)
returns table(place_id uuid, place_name text, visit_id uuid, start_date date, end_date date)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select p.id, p.name, v.id, v.start_date, v.end_date
    from public.visits v
    join public.places p on p.id = v.place_id
   where v.parent_visit_id = p_visit
     and p.deleted_at is null
   order by v.start_date, p.name;
$function$;

comment on function public.trip_contents(uuid) is
  'The visits EXPLICITLY grouped under this trip (§0.1). It used to match on date '
  'containment alone, which put unrelated places inside a trip whenever the dates '
  'happened to overlap.';

do $$
declare f text;
begin
  foreach f in array array[
    'place_ids_for_view(uuid)','occasion_count(uuid)',
    'place_visit_counts(uuid)','settings_stats(uuid)','trip_contents(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
