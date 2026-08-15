-- 0190 — nobody was keeping the count on the place row.
--
-- WHAT WAS FOUND (2026-08-14, measured on production):
--
--     Appalachian Trail   places.visit_count = 39   visits rows = 32
--     W&OD                places.visit_count = 46   visits rows = 44
--
-- 0126 declared `places.visit_count` to be the NUMBER OF VISITS, rewrote
-- `recompute_place_stats` to count visit rows, and backfilled every place. That was
-- right, and it is still right — the function counts visits today.
--
-- THE PROBLEM IS WHO CALLS IT. `recompute_place_stats` runs on the PHOTO and ACTIVITY
-- paths: a Strava webhook, an activity edit, a place merge. It does not run when a
-- VISIT changes, and every visit mutation goes through an RPC that does not call it:
--
--     create_visit   delete_visit   restore_visit   merge_visits   update_visit_dates
--
-- So the column is a photograph of the last time something else happened at that place.
-- Merging two visits into one — which is exactly what 0185 was built to do, and what
-- Erica did to the Appalachian Trail — takes the real count down and leaves the column
-- where it was. That is the 39, and the 46.
--
-- WHY IT IS NOT COSMETIC. The Duplicates screen chooses which of two places SURVIVES A
-- MERGE by this number ("the more-visited one wins"), and a merge is not undone by
-- pressing it again. Smart Albums decides "places we've been more than once" by it too.
--
-- WHAT THIS DOES *NOT* DO. It does not add a trigger to keep the mirror in step. A
-- second copy of a fact, kept in step by machinery, is the thing §8 is removing from
-- this schema one column at a time — part_of, solo_profile, is_trip. Making this one
-- more reliable would entrench it. The column is going; this migration is the first of
-- the same three steps the others took:
--
--     1. give the app a canonical reader   ← here
--     2. move every screen onto it, and deploy that
--     3. drop the column
--
-- So this adds the reader that was missing, and corrects the values that have already
-- drifted so nothing is wrong in the meantime.
--
-- ROLLBACK: drop the function. The backfill replaces stale numbers with counted ones;
-- there is nothing worth going back to.

-- ---------------------------------------------------------------------------
-- 1. The reader that was missing — and why place_visit_counts was not it.
-- ---------------------------------------------------------------------------
-- `place_visit_counts(p_profile)` answers "how many visits IN THIS VIEW", and with
-- p_profile null that means SHARED visits, not everyone's. There was no reader for
-- "how many visits has this place had, by anybody" — which is what a merge and a
-- been-here-more-than-once album are asking. That gap is why both screens were reading
-- the column: nothing else answered the question.
create or replace function public.place_visit_totals()
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
   group by v.place_id;
$function$;

revoke all on function public.place_visit_totals() from public;
revoke all on function public.place_visit_totals() from anon;
grant execute on function public.place_visit_totals() to authenticated;
grant execute on function public.place_visit_totals() to service_role;

comment on function public.place_visit_totals() is
  'Visits per place, by anyone. Use for merges and "more than once". Use '
  'place_visit_counts(profile) for anything shown inside a person view. Neither '
  'reads places.visit_count, which is a leftover mirror scheduled for removal.';

-- ---------------------------------------------------------------------------
-- 2. Clear the drift that is already there.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  with counted as (
    select p.id, (select count(*) from public.visits v where v.place_id = p.id) as c
      from public.places p
  )
  update public.places p
     set visit_count = counted.c
    from counted
   where counted.id = p.id and p.visit_count is distinct from counted.c;
  get diagnostics n = row_count;
  raise notice '0190: corrected visit_count on % place(s)', n;
end $$;
