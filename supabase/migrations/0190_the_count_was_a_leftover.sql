-- 0190 — the count on the place row was a leftover, and it was wrong.
--
-- WHAT WAS FOUND (2026-08-14, on production).
--
-- `places.visit_count` disagreed with the visits table:
--
--     Appalachian Trail   stored 39   actual 32
--     W&OD                stored 46   actual 44
--
-- Two mechanisms, one fact, and the screens read the copy — the shape of bug this
-- codebase keeps having (§8). Here it is worse than usual, because the two mechanisms
-- do not even mean the same thing:
--
--   * 0126 ("visit counts are visits, not days") declared the column to be the NUMBER
--     OF VISITS and backfilled it once from `visits`. Nothing has maintained it since,
--     so it has drifted every time a visit was merged or removed. That is the 39 and
--     the 46: a snapshot of last month.
--
--   * `recompute_place_stats` — untouched since 0117, and still called on every Strava
--     webhook, every activity edit, every merge — sets the same column to the number of
--     DISTINCT DAYS WITH EVIDENCE (photos ∪ pings ∪ activities). That is the meaning
--     0126 explicitly repudiated, restored on the next webhook.
--
-- So the column is stale until something touches the place, and then it is wrong in a
-- different way. Neither value is the number of visits.
--
-- WHY THIS MATTERS AND IS NOT COSMETIC. The Duplicates screen picks which of two
-- places SURVIVES A MERGE by this number ("the more-visited one wins"). A stale count
-- there means the wrong place keeps the history, and a merge is not something you undo
-- by pressing it again.
--
-- WHAT THIS MIGRATION DOES.
--
--   1. Adds `place_visit_totals()`, the missing canonical reader. `place_visit_counts`
--      answers "in this view", and with p_profile null it means SHARED visits — not
--      everyone's. There was no reader for "how many visits has this place had, by
--      anyone", which is exactly what a merge and a "been here more than once" album
--      need, so both screens were reading the column for want of anything better.
--
--   2. Makes `recompute_place_stats` stop overwriting the column with a day count.
--      first_visit / last_visit still come from evidence dates — those genuinely are
--      "the first day we have anything from here" — but the COUNT is now counted from
--      visits, which is what the column has claimed to be since 0126.
--
--   3. Backfills, so the drift is gone rather than merely stopped.
--
-- The column itself stays for now: `sectionDone` still falls back to it while the
-- per-view counts load, and MapView uses it in a heuristic that re-checks the database
-- before deleting anything. Removing it is a later step, after those two move — the
-- same order solo_profile came out in (§8, steps 3a–3f, then the column).
--
-- ROLLBACK: `place_visit_totals` can be dropped; recompute_place_stats can be restored
-- from 0117. The backfill is not reversible, but it replaces wrong numbers with counted
-- ones, so there is nothing worth going back to.

-- ---------------------------------------------------------------------------
-- 1. The reader that was missing.
-- ---------------------------------------------------------------------------
create or replace function public.place_visit_totals()
returns table(place_id uuid, visits integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  -- EVERY accepted visit, whoever was on it. Deliberately not filtered by profile:
  -- the question "which of these two places has more history" is not asked from
  -- inside a view, and neither is "have we been here more than once".
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
  'Visits per place, by anyone. Use for merges and "more than once"; use '
  'place_visit_counts(profile) for anything shown inside a person view.';

-- ---------------------------------------------------------------------------
-- 2. Stop the day count from coming back.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_place_stats(p_place uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_first date;
  v_last  date;
  v_count integer;
  v_cover uuid;
begin
  -- The evidence DATES still come from evidence: the first thing we have from a place
  -- is the first day we were there, whether or not a visit row exists yet.
  with days as (
    select taken_at::date as d from public.photos
      where place_id = p_place and deleted_at is null and taken_at is not null
    union
    select recorded_at::date from public.location_pings where place_id = p_place
    union
    select start_date::date from public.activities where place_id = p_place and start_date is not null
  )
  select min(d), max(d) into v_first, v_last from days;

  -- THE COUNT IS COUNTED FROM VISITS. This line used to be `count(*)` over the days
  -- above, which made visit_count a count of days — the meaning 0126 removed. Every
  -- Strava webhook put it back.
  select count(*)::integer into v_count from public.visits v where v.place_id = p_place;

  -- Keep the existing cover if it still belongs to this place (manual choice) and
  -- hasn't been soft-deleted.
  select cover_photo_id into v_cover from public.places where id = p_place;
  if v_cover is not null
     and not exists (select 1 from public.photos where id = v_cover and place_id = p_place and deleted_at is null) then
    v_cover := null;
  end if;
  if v_cover is null then
    select id into v_cover from public.photos
      where place_id = p_place and deleted_at is null and is_landscape order by taken_at desc nulls last limit 1;
    if v_cover is null then
      select id into v_cover from public.photos
        where place_id = p_place and deleted_at is null order by taken_at desc nulls last limit 1;
    end if;
  end if;

  update public.places
     set first_visit = least(first_visit, v_first),
         last_visit  = greatest(last_visit, v_last),
         visit_count = coalesce(v_count, 0),
         cover_photo_id = v_cover,
         activity_categories = coalesce(
           (select array_agg(distinct public.activity_category(type))
              from public.activities where place_id = p_place and type is not null), '{}')
   where id = p_place;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Clear the drift that has already accumulated.
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
  raise notice '0190: corrected visit_count on % places', n;
end $$;
