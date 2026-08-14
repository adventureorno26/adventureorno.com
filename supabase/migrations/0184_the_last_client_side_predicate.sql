-- 0184 — §0.8 phase 8, step 3b: the retired predicate, still running in the browser.
--
-- 0172 and 0173 removed `solo_profile is null or solo_profile = p_profile` from every
-- function in the database. Two copies of it survived in the CLIENT, written as
-- PostgREST filters against the table:
--
--     query.or('solo_profile.is.null,solo_profile.eq.' + personId)   // a person
--     query.is('solo_profile', null)                                  // "both"
--
-- `fetchActivitiesOfType` (the type lists) and `fetchActivityLines` (the routes drawn on
-- the map) still ask the retired question, so the map and those lists are the last two
-- places in the app scoped by null-as-data. They give the right answer for two people
-- and no answer at all for three — `solo_profile IS NULL` cannot mean "Erica and Sam".
--
-- These return ROWS rather than ids on purpose. The obvious shape — an RPC returning
-- ids, then `.in('id', ids)` — builds a query string from up to 445 uuids, about 16 KB,
-- past the point where a GET URL is safely accepted. One call that returns what the
-- caller actually needs has no such limit and no second round trip.
--
-- ROLLBACK: drop both functions; the client filters are in git history.

begin;

create or replace function public.activities_of_type(
  p_type    text,
  p_profile uuid default null
) returns table(id uuid, type text, name text, distance double precision,
                start_date timestamptz, place_id uuid, place_name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select a.id, a.type, a.name, a.distance, a.start_date, a.place_id, p.name
    from public.activities a
    left join public.places p on p.id = a.place_id
   where a.type = p_type
     and case when p_profile is null
              then public.is_shared_activity(a.id)
              else exists (select 1 from public.activity_profiles ap
                            where ap.activity_id = a.id and ap.profile_id = p_profile) end
   order by a.start_date desc nulls last;
$function$;

comment on function public.activities_of_type(text, uuid) is
  'Activities of one type, scoped by PARTICIPANT ROWS (§0.3). Replaces a PostgREST '
  'filter in the browser that still asked `solo_profile is null or = person`.';

create or replace function public.activity_lines(p_profile uuid default null)
returns table(id uuid, place_id uuid, type text, summary_polyline text, owner_profile uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select a.id, a.place_id, a.type, a.summary_polyline, a.owner_profile
    from public.activities a
   where a.summary_polyline is not null
     and case when p_profile is null
              then public.is_shared_activity(a.id)
              else exists (select 1 from public.activity_profiles ap
                            where ap.activity_id = a.id and ap.profile_id = p_profile) end;
$function$;

comment on function public.activity_lines(uuid) is
  'The routes drawn on the map, scoped by PARTICIPANT ROWS (§0.3). Same replacement as '
  'activities_of_type: the map was the last thing in the app filtering on a null.';

do $$
declare f text;
begin
  foreach f in array array['activities_of_type(text,uuid)','activity_lines(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
