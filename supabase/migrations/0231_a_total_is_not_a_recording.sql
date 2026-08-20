-- 0231 — a total is not a recording.
--
-- Erica, 2026-08-20: *"I do want him to be able to see my total miles and total activities
-- though, is that still in place?"*
--
-- It was not. Measured before answering:
--
--     the truth about her            394 activities, 2,153 miles
--     what Josh could see of her     256 activities, 1,354 miles
--
-- `mileage_by_person` reads `visible_activities`, so the 138 Strava recordings he is not
-- tagged on — about 799 miles — simply vanished from her totals as he saw them. Not
-- hidden-with-a-note: silently smaller, which is the failure mode this repository keeps
-- naming.
--
-- THE DISTINCTION THIS RESTS ON, and the codebase already made it once. `data_health` is
-- allowlisted to read `activities` directly with the reason *"row COUNTS for diagnostics. A
-- total is not an athlete's data, and a health check that under-reports is a broken health
-- check."* The same holds here: **"Erica has run 2,153 miles" is a fact about Erica.** The
-- route she took on 4 January is a recording, and stays behind the rule 0228 set.
--
-- So this returns NUMBERS ONLY — a count and a distance, per activity type. There is no row
-- id, no name, no polyline, no date, and nothing that can be joined back to a recording. A
-- reader who is not allowed to see an outing still cannot see it; they can see that it
-- counted.
--
-- Still household-only: `assert_member()` first, exactly as every other reader.

create or replace function public.person_totals(p_profile uuid)
returns table(type text, activity_count bigint, miles numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  with canon as (
    -- One outing counted once, the same rule every other total uses (0140/0141).
    select distinct on (coalesce(a.shared_group_id, a.id)) a.type, a.distance
      from public.activities a
     where exists (select 1 from public.activity_profiles ap
                    where ap.activity_id = a.id
                      and ap.profile_id = p_profile
                      and coalesce(ap.claim_status, 'accepted') <> 'declined')
     order by coalesce(a.shared_group_id, a.id), a.id
  )
  select type,
         count(*)::bigint,
         round((coalesce(sum(distance), 0::float8) / 1609.344::float8)::numeric, 1)
    from canon
   group by type;
$function$;

revoke all on function public.person_totals(uuid) from public, anon;
grant execute on function public.person_totals(uuid) to authenticated;

comment on function public.person_totals is
  'Someone''s totals — counts and miles per type, and NOTHING ELSE. No id, no name, no '
  'route, no date. "Erica has run 2,153 miles" is a fact about Erica; the route she took on '
  'the 4th is a recording and stays behind 0228. Household-only (0231).';
