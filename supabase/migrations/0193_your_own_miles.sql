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
-- 5. THE FEATURE. Outings a GROUP was on, and MY miles across them.
--
-- WHY THIS TAKES A SET AND NOT ONE PERSON (Erica, 2026-08-15: "what if a user has 10
-- friends and only 7 go? what if I want to search for things I did with 2 specific
-- people?"). My first version took a single uuid, which bakes in the two-person household
-- the rest of §0.3 has been getting rid of all day. Seven of ten friends going is the
-- normal case, not the exception.
--
-- So: give it the people you care about, and it returns the outings whose participants
-- INCLUDE ALL OF THEM. Others may have been there too — "with Josh and Sam" does not mean
-- "and nobody else".
--
-- `together_since` exists because the app already knows this date and only the CLIENT knew
-- it: STATS_CUTOFF = '2025-12-21' lives in app/src/lib/strava.ts, so the map and the stats
-- filtered by it while the DATABASE happily held a joint visit dated 2021. One row does.
-- ---------------------------------------------------------------------------
create or replace function public.together_since()
returns date
language sql
immutable
as $function$ select date '2025-12-21' $function$;

comment on function public.together_since() is
  'The date Erica and Josh met. Shared history before it is a data error, not history. '
  'It lived only in the client (STATS_CUTOFF) until 0193, which is how a joint visit '
  'dated 2021-06-27 came to exist.';

create or replace function public.shared_outings(p_with uuid[])
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

  with wanted as (
    -- The caller is always part of "we", without having to name themselves.
    select distinct x from unnest(coalesce(p_with, '{}'::uuid[]) || auth.uid()) x
                          where x is not null
  ),
  together as (
    -- A shared outing is a visit EVERY named person is on. Others may be too.
    -- This fact is OURS — it comes from visit_profiles, not from Strava.
    select v.id, v.place_id, v.start_date, v.end_date
      from public.accepted_visits v
     where v.start_date >= public.together_since()
       and not exists (
             select 1 from wanted w
              where not exists (select 1 from public.visit_profiles vp
                                 where vp.visit_id = v.id and vp.profile_id = w.x))
  ),
  mine as (
    -- MY activities on those days at those places. Only ever mine.
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
    coalesce((select round((sum(distance) / 1609.344)::numeric, 1) from mine), 0),
    (select min(start_date) from together),
    (select max(end_date)   from together),
    -- Honest about what is NOT counted: their Strava-origin activities on the same
    -- outings, which we may not show.
    (select count(*)::integer
       from public.activities a
       join together t
         on a.place_id = t.place_id
        and a.start_date::date between t.start_date and t.end_date
      where lower(coalesce(a.original_source, '')) = 'strava'
        and not exists (select 1 from public.activity_profiles ap
                         where ap.activity_id = a.id and ap.profile_id = auth.uid()));
$function$;

revoke all on function public.shared_outings(uuid[]) from public;
revoke all on function public.shared_outings(uuid[]) from anon;
grant execute on function public.shared_outings(uuid[]) to authenticated;
grant execute on function public.shared_outings(uuid[]) to service_role;

comment on function public.shared_outings(uuid[]) is
  'Outings whose participants INCLUDE everyone named (the caller is added automatically), '
  'and the CALLER''S OWN miles across them. Others may also have been there. The count '
  'comes from visits, which are ours; the mileage is only the caller''s, so no Strava data '
  'crosses accounts. Nothing before together_since() is counted.';

-- ---------------------------------------------------------------------------
-- 6. "JUST ME" IS THE DEFAULT, which is what STATE.md said all along.
--
-- §"TOGETHER, DEFINED" (2026-08-11): *"Everyone's own imported data is 'just me' by
-- default"*, and co-presence produces a SUGGESTION, never an automatic label.
--
-- 0188 — written this morning — did the opposite: `default_participants()` attached EVERY
-- owner/editor to every new visit and activity. That is almost certainly what produced the
-- one joint visit dated 2021-06-27, five years before Erica and Josh met: a manual visit
-- backfilled from an old photo inherited both of them.
--
-- WHY THIS NEEDS NO EDGE FUNCTION CHANGE. The worry was that "just me" would strand
-- machine imports, because `activities` has no `created_by` and a webhook has no
-- auth.uid(). It carries something better: `athlete_id`, and `strava_accounts` maps that
-- to a profile. All 180 Strava activities have one, and all 180 resolve. So an import is
-- attributed to the athlete whose token fetched it — which is both correct and exactly
-- what the Strava terms require.
--
-- EXISTING ROWS ARE LEFT ALONE. 590 participant rows were written under the old default,
-- including 99 shared visits. Rewriting Erica's history is her decision, not a migration's.
-- The one 2021 row is flagged in check-data-integrity, not silently changed.
-- ---------------------------------------------------------------------------
create or replace function public.default_participants()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_owner uuid;
begin
  if tg_table_name = 'visits' then
    -- A person creating a visit is saying they were there. Nobody else is implied.
    if auth.uid() is not null then
      insert into public.visit_profiles (visit_id, profile_id)
      values (new.id, auth.uid())
      on conflict do nothing;
    end if;
    -- No uid means a machine made it. §0.3: it waits for review rather than guessing.
    return null;
  end if;

  v_owner := auth.uid();
  if v_owner is null and new.athlete_id is not null then
    -- The athlete whose token fetched it. This is the only attribution Strava's terms
    -- allow, and the only one that is true.
    select sa.profile_id into v_owner
      from public.strava_accounts sa where sa.athlete_id = new.athlete_id;
  end if;

  if v_owner is not null then
    insert into public.activity_profiles (activity_id, profile_id)
    values (new.id, v_owner)
    on conflict do nothing;
  end if;
  return null;
end $function$;

revoke all on function public.default_participants() from public, anon, authenticated;

comment on function public.default_participants() is
  'JUST ME by default (STATE.md, "TOGETHER, DEFINED"). A person''s new visit is theirs; a '
  'Strava import belongs to the athlete whose token fetched it, via activities.athlete_id '
  '-> strava_accounts.profile_id. Nothing is attributed to anyone else — being together is '
  'a tag a person accepts, never something the app works out.';

-- Strava-origin is decided by the athlete, not by how the row arrived.
update public.activities
   set original_source = 'strava'
 where athlete_id is not null and coalesce(original_source, '') <> 'strava';
