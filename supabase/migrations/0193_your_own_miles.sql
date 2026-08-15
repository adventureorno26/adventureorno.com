-- 0193 — everyone sees their OWN miles, and "together" is counted from visits.
--
-- THE CONSTRAINT. Strava's API terms allow an athlete's data to be shown to that athlete
-- and to nobody else — no feeds, no comparison, no social display. Today
-- `activities_select` is `using (public.is_member())`, so Josh sees Erica's Strava
-- activities and she sees his. That is 180 of 445 activities in violation.
--
-- THE FEATURE, AND WHY IT SURVIVES THE CONSTRAINT (Erica, 2026-08-15: "could we keep each
-- user's strava information private while still providing them a function to count miles
-- and activities done together?"):
--
--   * WHO WAS THERE TOGETHER IS OUR OWN FACT. It lives in visit_profiles, derived from our
--     participants model — not from Strava. So the COUNT of shared outings is free of the
--     restriction entirely, and both people see the same number.
--
--   * MILES ARE PER VIEWER. Erica sees the miles SHE logged on those shared outings; Josh
--     sees his. Neither number contains the other person's Strava data. They differ by a
--     rounding error because they walked the same route, and nothing crosses accounts.
--
-- What is deliberately NOT built: a combined total that adds both people's Strava mileage
-- into one shared figure. That is exactly the case the terms are pointed at.
--
-- `original_source` IS NOT `source`. `source` records HOW WE GOT IT — 'strava', 'file'.
-- `original_source` records WHERE IT BEGAN. A file imported through intervals.icu that
-- started life on Strava is still Strava's, and that is the case the whole rule is about.
-- 265 of the 445 are 'file' and carry no restriction at all.
--
-- ROLLBACK: drop the view, the column and the helper, and restore activities_select from
-- 0001. Nothing is lost — the column is additive and the policy is a narrowing.

-- ---------------------------------------------------------------------------
-- 1. Where it came from, as distinct from how we got it.
-- ---------------------------------------------------------------------------
alter table public.activities
  add column if not exists original_source text;

update public.activities
   set original_source = coalesce(original_source, source)
 where original_source is null;

alter table public.activities
  alter column original_source set default 'unknown';

comment on column public.activities.original_source is
  'WHERE THIS ACTIVITY BEGAN, however many hubs it passed through — not how we received '
  'it (that is `source`). Strava-origin data may be shown only to its own athlete, so '
  'this column is what every visibility rule is written against. A row arriving via '
  'intervals.icu whose original was Strava must say ''strava'' here.';

-- ---------------------------------------------------------------------------
-- 2. The one question every reader has to ask.
-- ---------------------------------------------------------------------------
create or replace function public.can_see_activity(p_activity uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    -- Not Strava's: ordinary data, visible to any member as before.
    not exists (
      select 1 from public.activities a
       where a.id = p_activity and lower(coalesce(a.original_source, '')) = 'strava'
    )
    -- Strava's: only for the athlete it belongs to.
    or exists (
      select 1 from public.activity_profiles ap
       where ap.activity_id = p_activity and ap.profile_id = auth.uid()
    );
$function$;

revoke all on function public.can_see_activity(uuid) from public;
revoke all on function public.can_see_activity(uuid) from anon;
grant execute on function public.can_see_activity(uuid) to authenticated;
grant execute on function public.can_see_activity(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The door every DISPLAY reader goes through.
--
-- RLS alone cannot carry this rule: 32 SECURITY DEFINER functions read
-- public.activities, and SECURITY DEFINER bypasses RLS. Every count, card and statistic
-- goes through one of them, so a policy on the table would look correct in psql and
-- change nothing in the app. This view is what those readers select from instead.
-- ---------------------------------------------------------------------------
create or replace view public.visible_activities
with (security_invoker = true)
as
  select a.* from public.activities a
   where lower(coalesce(a.original_source, '')) <> 'strava'
      or exists (select 1 from public.activity_profiles ap
                  where ap.activity_id = a.id and ap.profile_id = auth.uid());

grant select on public.visible_activities to authenticated;
grant select on public.visible_activities to service_role;

comment on view public.visible_activities is
  'Activities this viewer may SEE. Strava-origin rows appear only for their own athlete '
  '(0193). Display readers select from here; writers still use public.activities.';

-- ---------------------------------------------------------------------------
-- 4. And the table itself narrows, for anything reading it directly.
-- ---------------------------------------------------------------------------
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities
  for select using (
    public.is_member()
    and (
      lower(coalesce(original_source, '')) <> 'strava'
      or exists (select 1 from public.activity_profiles ap
                  where ap.activity_id = id and ap.profile_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 5. THE FEATURE. Outings we did together, and MY miles on them.
--
-- The outing count comes from VISITS — our own participants model — so it is identical
-- for both people and carries no Strava restriction. The mileage sums only the viewer's
-- own activities, so it never contains the other person's data.
-- ---------------------------------------------------------------------------
create or replace function public.shared_outings(p_with uuid)
returns table (
  outings         integer,
  my_miles        numeric,
  first_together  date,
  last_together   date,
  restricted_rows integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  with together as (
    -- A shared outing is a visit BOTH people are on. That fact is ours.
    select v.id, v.place_id, v.start_date, v.end_date
      from public.accepted_visits v
     where exists (select 1 from public.visit_profiles vp
                    where vp.visit_id = v.id and vp.profile_id = auth.uid())
       and exists (select 1 from public.visit_profiles vp
                    where vp.visit_id = v.id and vp.profile_id = p_with)
  ),
  mine as (
    -- MY activities on those days at those places. Only mine, whatever their origin.
    select distinct a.id, a.distance
      from public.activities a
      join together t
        on a.place_id = t.place_id
       and a.start_date::date between t.start_date and t.end_date
     where exists (select 1 from public.activity_profiles ap
                    where ap.activity_id = a.id and ap.profile_id = auth.uid())
  )
  select
    (select count(*)::integer from together),
    -- metres to miles, one place, matching the rest of the app
    coalesce((select round((sum(distance) / 1609.344)::numeric, 1) from mine), 0),
    (select min(start_date) from together),
    (select max(end_date)   from together),
    -- Honest about what is NOT in the number: the other person's Strava-origin
    -- activities on the same outings, which we may not show and are not counted.
    (select count(*)::integer
       from public.activities a
       join together t
         on a.place_id = t.place_id
        and a.start_date::date between t.start_date and t.end_date
      where lower(coalesce(a.original_source, '')) = 'strava'
        and exists (select 1 from public.activity_profiles ap
                     where ap.activity_id = a.id and ap.profile_id = p_with)
        and not exists (select 1 from public.activity_profiles ap
                         where ap.activity_id = a.id and ap.profile_id = auth.uid()));
$function$;

revoke all on function public.shared_outings(uuid) from public;
revoke all on function public.shared_outings(uuid) from anon;
grant execute on function public.shared_outings(uuid) to authenticated;
grant execute on function public.shared_outings(uuid) to service_role;

comment on function public.shared_outings(uuid) is
  'Outings you and another person were both on, and YOUR miles across them. The count is '
  'from visits (ours); the mileage is only the caller''s own, so no Strava data crosses '
  'accounts. `restricted_rows` says how many of their activities are excluded, so the '
  'number can be honest about what it leaves out rather than silently short.';
