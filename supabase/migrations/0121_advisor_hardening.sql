-- 0121 — Low-risk Supabase advisor hardening (performance + security-lint).
--
-- Three independent, behavior-preserving cleanups flagged by the Supabase advisors:
--   1. auth_rls_initplan (14 policies): call auth.uid() as (select auth.uid()) so the
--      planner evaluates it once per query (initplan) instead of once per row. The
--      predicate is otherwise byte-identical, so access is unchanged.
--   2. function_search_path_mutable (5 SECURITY INVOKER functions): pin search_path so
--      the resolved schema can't depend on the caller. They reference public objects
--      unqualified, so `public, pg_temp` preserves current resolution.
--   3. duplicate_index: place_membership_unique_pair is identical to the primary-key
--      index (child_id, parent_id). Drop the redundant UNIQUE constraint; the primary
--      key still enforces the same uniqueness.
--
-- This migration changes NO data and NO access semantics.
--
-- Transactional boundary: the whole migration runs inside one explicit BEGIN/COMMIT so
-- a client that autocommits per statement (psql -f, dashboard editor) still applies it
-- atomically — a mid-file failure leaves the schema untouched.
--
-- Idempotency / already-applied: the preflight below RAISES if the database is not in
-- the expected pre-0121 state (e.g. because 0121 already ran). Do not re-run against a
-- database that already has it; on production it was applied 2026-08-07 (via direct
-- SQL, verified), so only fresh/disposable rebuilds should execute this file.
--
-- The exact, executable rollback is at the bottom of this file (commented out).

begin;

-- ---------------------------------------------------------------------------
-- Preflight: confirm the expected pre-migration definitions before changing them.
-- ---------------------------------------------------------------------------
do $$
declare
  targets text[] := array[
    'entries.entries_select',
    'join_requests.jr_insert_own',
    'join_requests.jr_select_visible',
    'join_requests.jr_update_own',
    'location_pings.pings_insert_own',
    'photo_reactions.photo_reactions_select',
    'photo_reactions.photo_reactions_write',
    'photos.photos_delete',
    'photos.photos_select',
    'place_ratings.place_ratings_select',
    'place_ratings.place_ratings_write',
    'place_wishes.place_wishes_write',
    'places.places_select',
    'videos.videos_select'
  ];
  n_present int;
  n_wrapped int;
  n_pinned int;
begin
  -- (3) duplicate constraint must still be present (pre-migration state)
  if not exists (
    select 1 from pg_constraint
    where conname = 'place_membership_unique_pair'
      and conrelid = 'public.place_membership'::regclass
  ) then
    raise exception '0121 preflight: place_membership_unique_pair is absent — 0121 may already be applied. Do not re-run.';
  end if;

  -- (2) the 5 target functions must NOT yet have a pinned search_path
  select count(*) into n_pinned
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('activity_category','neutralize_junk_place','on_this_day','place_membership_no_cycle','race_bucket')
    and p.proconfig is not null;
  if n_pinned > 0 then
    raise exception '0121 preflight: % of 5 target functions already pin search_path — 0121 may already be applied.', n_pinned;
  end if;

  -- (1) all 14 target policies must exist ...
  select count(*) into n_present
  from pg_policies
  where schemaname = 'public'
    and (tablename || '.' || policyname) = any (targets);
  if n_present <> 14 then
    raise exception '0121 preflight: expected 14 target policies, found % — unexpected schema state.', n_present;
  end if;

  -- ... and none may already be wrapped with (select auth.uid())
  select count(*) into n_wrapped
  from pg_policies
  where schemaname = 'public'
    and (tablename || '.' || policyname) = any (targets)
    and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~* '\(\s*select\s+auth\.uid\(\)';
  if n_wrapped > 0 then
    raise exception '0121 preflight: % target policies already use (select auth.uid()) — 0121 may already be applied.', n_wrapped;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. RLS initplan wrapping — auth.uid() -> (select auth.uid()); predicates unchanged.
-- ---------------------------------------------------------------------------
drop policy if exists entries_select on public.entries;
create policy entries_select on public.entries for select
  using (is_member() AND ((created_by = (select auth.uid())) OR ((created_by IS NULL) AND is_owner()) OR ((place_id IS NOT NULL) AND place_is_saved(place_id))));

drop policy if exists jr_insert_own on public.join_requests;
create policy jr_insert_own on public.join_requests for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists jr_select_visible on public.join_requests;
create policy jr_select_visible on public.join_requests for select to authenticated
  using ((user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
     FROM profiles
    WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'owner'::text)))));

drop policy if exists jr_update_own on public.join_requests;
create policy jr_update_own on public.join_requests for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists pings_insert_own on public.location_pings;
create policy pings_insert_own on public.location_pings for insert
  with check (is_member() AND (profile_id = (select auth.uid())));

drop policy if exists photo_reactions_select on public.photo_reactions;
create policy photo_reactions_select on public.photo_reactions for select
  using (is_member() AND ((profile_id = (select auth.uid())) OR (EXISTS ( SELECT 1
     FROM photos ph
    WHERE ((ph.id = photo_reactions.photo_id) AND (ph.deleted_at IS NULL) AND (ph.place_id IS NOT NULL) AND place_is_saved(ph.place_id))))));

drop policy if exists photo_reactions_write on public.photo_reactions;
create policy photo_reactions_write on public.photo_reactions for all
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists photos_delete on public.photos;
create policy photos_delete on public.photos for delete
  using (is_owner() OR (uploaded_by = (select auth.uid())));

drop policy if exists photos_select on public.photos;
create policy photos_select on public.photos for select
  using ((deleted_at IS NULL) AND is_member() AND ((uploaded_by = (select auth.uid())) OR ((uploaded_by IS NULL) AND is_owner()) OR ((place_id IS NOT NULL) AND place_is_saved(place_id))));

drop policy if exists place_ratings_select on public.place_ratings;
create policy place_ratings_select on public.place_ratings for select
  using (is_member() AND ((profile_id = (select auth.uid())) OR ((place_id IS NOT NULL) AND place_is_saved(place_id))));

drop policy if exists place_ratings_write on public.place_ratings;
create policy place_ratings_write on public.place_ratings for all
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists place_wishes_write on public.place_wishes;
create policy place_wishes_write on public.place_wishes for all
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists places_select on public.places;
create policy places_select on public.places for select
  using ((deleted_at IS NULL) AND is_member() AND (saved OR (created_by = (select auth.uid())) OR ((created_by IS NULL) AND is_owner())));

drop policy if exists videos_select on public.videos;
create policy videos_select on public.videos for select
  using (is_member() AND ((uploaded_by = (select auth.uid())) OR ((uploaded_by IS NULL) AND is_owner()) OR ((place_id IS NOT NULL) AND place_is_saved(place_id))));

-- ---------------------------------------------------------------------------
-- 2. Pin function search_path (behavior-preserving).
-- ---------------------------------------------------------------------------
alter function public.activity_category(p_type text) set search_path = public, pg_temp;
alter function public.neutralize_junk_place() set search_path = public, pg_temp;
alter function public.on_this_day() set search_path = public, pg_temp;
alter function public.place_membership_no_cycle() set search_path = public, pg_temp;
alter function public.race_bucket(p_miles double precision) set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 3. Drop the redundant duplicate index (keep the primary key).
-- ---------------------------------------------------------------------------
alter table public.place_membership drop constraint if exists place_membership_unique_pair;

commit;

-- ===========================================================================
-- ROLLBACK — exact, executable. Restores every pre-0121 definition. Run as-is.
-- ===========================================================================
-- begin;
--
-- -- 1. Restore the original (bare auth.uid()) RLS predicates.
-- drop policy if exists entries_select on public.entries;
-- create policy entries_select on public.entries for select
--   using (is_member() AND ((created_by = auth.uid()) OR ((created_by IS NULL) AND is_owner()) OR ((place_id IS NOT NULL) AND place_is_saved(place_id))));
--
-- drop policy if exists jr_insert_own on public.join_requests;
-- create policy jr_insert_own on public.join_requests for insert to authenticated
--   with check (user_id = auth.uid());
--
-- drop policy if exists jr_select_visible on public.join_requests;
-- create policy jr_select_visible on public.join_requests for select to authenticated
--   using ((user_id = auth.uid()) OR (EXISTS ( SELECT 1
--      FROM profiles
--     WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'owner'::text)))));
--
-- drop policy if exists jr_update_own on public.join_requests;
-- create policy jr_update_own on public.join_requests for update to authenticated
--   using (user_id = auth.uid())
--   with check (user_id = auth.uid());
--
-- drop policy if exists pings_insert_own on public.location_pings;
-- create policy pings_insert_own on public.location_pings for insert
--   with check (is_member() AND (profile_id = auth.uid()));
--
-- drop policy if exists photo_reactions_select on public.photo_reactions;
-- create policy photo_reactions_select on public.photo_reactions for select
--   using (is_member() AND ((profile_id = auth.uid()) OR (EXISTS ( SELECT 1
--      FROM photos ph
--     WHERE ((ph.id = photo_reactions.photo_id) AND (ph.deleted_at IS NULL) AND (ph.place_id IS NOT NULL) AND place_is_saved(ph.place_id))))));
--
-- drop policy if exists photo_reactions_write on public.photo_reactions;
-- create policy photo_reactions_write on public.photo_reactions for all
--   using (profile_id = auth.uid())
--   with check (profile_id = auth.uid());
--
-- drop policy if exists photos_delete on public.photos;
-- create policy photos_delete on public.photos for delete
--   using (is_owner() OR (uploaded_by = auth.uid()));
--
-- drop policy if exists photos_select on public.photos;
-- create policy photos_select on public.photos for select
--   using ((deleted_at IS NULL) AND is_member() AND ((uploaded_by = auth.uid()) OR ((uploaded_by IS NULL) AND is_owner()) OR ((place_id IS NOT NULL) AND place_is_saved(place_id))));
--
-- drop policy if exists place_ratings_select on public.place_ratings;
-- create policy place_ratings_select on public.place_ratings for select
--   using (is_member() AND ((profile_id = auth.uid()) OR ((place_id IS NOT NULL) AND place_is_saved(place_id))));
--
-- drop policy if exists place_ratings_write on public.place_ratings;
-- create policy place_ratings_write on public.place_ratings for all
--   using (profile_id = auth.uid())
--   with check (profile_id = auth.uid());
--
-- drop policy if exists place_wishes_write on public.place_wishes;
-- create policy place_wishes_write on public.place_wishes for all
--   using (profile_id = auth.uid())
--   with check (profile_id = auth.uid());
--
-- drop policy if exists places_select on public.places;
-- create policy places_select on public.places for select
--   using ((deleted_at IS NULL) AND is_member() AND (saved OR (created_by = auth.uid()) OR ((created_by IS NULL) AND is_owner())));
--
-- drop policy if exists videos_select on public.videos;
-- create policy videos_select on public.videos for select
--   using (is_member() AND ((uploaded_by = auth.uid()) OR ((uploaded_by IS NULL) AND is_owner()) OR ((place_id IS NOT NULL) AND place_is_saved(place_id))));
--
-- -- 2. Un-pin the function search paths.
-- alter function public.activity_category(p_type text) reset search_path;
-- alter function public.neutralize_junk_place() reset search_path;
-- alter function public.on_this_day() reset search_path;
-- alter function public.place_membership_no_cycle() reset search_path;
-- alter function public.race_bucket(p_miles double precision) reset search_path;
--
-- -- 3. Recreate the redundant unique constraint (matches the primary key columns).
-- alter table public.place_membership
--   add constraint place_membership_unique_pair unique (child_id, parent_id);
--
-- commit;
