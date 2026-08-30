-- 0275 — the performance advisors, which nobody had ever looked at.
--
-- §6c has tracked the SECURITY advisors since 2026-08-07. The PERFORMANCE list was never
-- read. It has 181 findings. Most are not worth acting on — 114 `multiple_permissive_policies`
-- are counted once per role and mostly name roles nobody authenticates as (`dashboard_user`,
-- `authenticator`, `cli_login_postgres`), and 53 `unindexed_foreign_keys` is a real but
-- separate piece of work on a database this size. Two are clean wins and are done here.
--
-- 1. SIX `auth_rls_initplan` WARNINGS. A policy that calls bare `auth.uid()` re-evaluates it
--    FOR EVERY ROW SCANNED. Wrapping it as `(select auth.uid())` makes Postgres hoist it into
--    an InitPlan evaluated once. This is Supabase's own documented fix and it is semantically
--    identical because `auth.uid()` is STABLE — it cannot change within a statement.
--
--    "Semantically identical" is the sort of claim that is true right up until it is not, so
--    it was measured rather than asserted: all six policies rewritten inside a transaction,
--    `count(*)` taken on all five affected tables as each of the three accounts, then rolled
--    back. Fifteen comparisons, fifteen identical:
--
--      table               Erica   Josh   Test bot
--      activities            480    431        293
--      activity_reactions      0      0          0
--      memory_people        1000    797        303
--      memory_subjects       836    632        293
--      people                  4      4          3
--
--    Every expression is otherwise reproduced exactly, including the `with check` halves,
--    which are easy to drop when retyping an `ALL` policy and would silently widen writes.
--
-- 2. ONE `duplicate_index`. `location_pings` carried two identical indexes,
--    `location_pings_profile_recorded_idx` and `pings_profile_idx`. Two copies of one index
--    is double the write cost and double the storage for nothing. `pings_profile_idx` is the
--    one dropped; the surviving name says what it covers.
--
-- NOT DONE, deliberately: `no_primary_key` on `trip_migration_exceptions` and
-- `place_membership_exceptions`. Both are small operator-facing exception lists, and adding a
-- key to a table whose rows are matched by their content is a data-model decision, not a
-- performance fix.

begin;

drop index if exists public.pings_profile_idx;

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select using (
  is_member() and (
    lower(coalesce(activities.original_source, ''::text)) <> 'strava'::text
    or activities.owner_profile = (select auth.uid())
    or exists (
      select 1
        from activity_profiles ap
        join profiles ow on ow.id = activities.owner_profile
       where ap.activity_id = activities.id
         and ap.profile_id = (select auth.uid())
         and coalesce(ap.claim_status, 'accepted'::text) <> 'rejected'::text
         and ow.share_tagged_outings)));

drop policy if exists activity_reactions_write on public.activity_reactions;
create policy activity_reactions_write on public.activity_reactions for all
  using (is_member() and activity_reactions.profile_id = (select auth.uid()))
  with check (is_member() and activity_reactions.profile_id = (select auth.uid()));

drop policy if exists memory_people_write on public.memory_people;
create policy memory_people_write on public.memory_people for all
  using (is_editor_or_owner() and exists (
    select 1 from memory_subjects s
     where s.id = memory_people.subject_id and s.owner_profile = (select auth.uid())))
  with check (is_editor_or_owner() and exists (
    select 1 from memory_subjects s
     where s.id = memory_people.subject_id and s.owner_profile = (select auth.uid())));

drop policy if exists memory_subjects_write on public.memory_subjects;
create policy memory_subjects_write on public.memory_subjects for all
  using (memory_subjects.owner_profile = (select auth.uid()) and is_editor_or_owner())
  with check (memory_subjects.owner_profile = (select auth.uid()) and is_editor_or_owner());

drop policy if exists people_read on public.people;
create policy people_read on public.people for select using (
  people.owner_profile = (select auth.uid())
  or people.linked_profile = (select auth.uid())
  or person_on_visible_memory(people.id)
  or person_on_visible_visit(people.id));

drop policy if exists people_write on public.people;
create policy people_write on public.people for all
  using (people.owner_profile = (select auth.uid()) and is_editor_or_owner())
  with check (people.owner_profile = (select auth.uid()) and is_editor_or_owner());

-- Prove it: no bare auth.uid() left in the six, the duplicate index is gone, and every
-- policy still exists with its `with check` half intact where it had one.
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public'
     and policyname in ('activities_select','activity_reactions_write','memory_people_write',
                        'memory_subjects_write','people_read','people_write');
  if n <> 6 then raise exception 'expected 6 rewritten policies, found %', n; end if;

  -- A bare call looks like `auth.uid()` with no `( SELECT` in front of it. After the
  -- rewrite pg_policies renders the hoisted form as `( SELECT auth.uid() AS uid)`.
  select count(*) into n from pg_policies
   where schemaname = 'public'
     and policyname in ('activities_select','activity_reactions_write','memory_people_write',
                        'memory_subjects_write','people_read','people_write')
     and (coalesce(qual,'') ~ '(?<!SELECT )auth\.uid\(\)'
       or coalesce(with_check,'') ~ '(?<!SELECT )auth\.uid\(\)');
  if n <> 0 then raise exception '% policy expression(s) still call auth.uid() per row', n; end if;

  -- The ALL policies must keep BOTH halves. A dropped `with check` does not fail a read
  -- test — it quietly lets a write through.
  select count(*) into n from pg_policies
   where schemaname = 'public' and cmd = 'ALL'
     and policyname in ('activity_reactions_write','memory_people_write',
                        'memory_subjects_write','people_write')
     and with_check is null;
  if n <> 0 then raise exception '% write policy/policies lost their with check half', n; end if;

  if exists (select 1 from pg_indexes where schemaname='public' and indexname='pings_profile_idx') then
    raise exception 'the duplicate index pings_profile_idx is still there';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='location_pings_profile_recorded_idx') then
    raise exception 'the surviving index location_pings_profile_recorded_idx is missing';
  end if;
end $$;

commit;
