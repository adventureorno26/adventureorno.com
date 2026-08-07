-- 0121 — Low-risk Supabase advisor hardening (performance + security-lint).
--
-- Three independent, behavior-preserving cleanups flagged by the Supabase advisors:
--
--   1. auth_rls_initplan (14 policies): each RLS policy called `auth.uid()`
--      directly, so Postgres re-evaluated it once per row. Wrapping it as
--      `(select auth.uid())` lets the planner evaluate it once per query
--      (initplan). The predicate is otherwise byte-identical, so access is
--      unchanged. Policies are dropped+recreated inside this single transaction,
--      so there is no window where a SELECT policy is missing.
--
--   2. function_search_path_mutable (5 functions): pin a fixed search_path so the
--      resolved schema can't depend on the caller's search_path. All five are
--      SECURITY INVOKER and reference public objects unqualified, so
--      `public, pg_temp` preserves current resolution.
--
--   3. duplicate_index: `place_membership_unique_pair` is identical to the
--      primary-key index `place_membership_pkey`. Drop the redundant UNIQUE
--      constraint; the primary key still enforces the same uniqueness.
--
-- ROLLBACK: recreate each policy/function without the `(select ...)` wrapper /
-- search_path, and re-add `alter table public.place_membership add constraint
-- place_membership_unique_pair unique (…)`. This migration changes no data and no
-- access semantics, so a rollback is only needed to restore the exact prior text.

-- 1. RLS initplan wrapping -----------------------------------------------------

-- entries
drop policy if exists entries_select on public.entries;
create policy entries_select on public.entries for select
  using (is_member() AND ((created_by = (select auth.uid())) OR ((created_by IS NULL) AND is_owner()) OR ((place_id IS NOT NULL) AND place_is_saved(place_id))));

-- join_requests
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

-- location_pings
drop policy if exists pings_insert_own on public.location_pings;
create policy pings_insert_own on public.location_pings for insert
  with check (is_member() AND (profile_id = (select auth.uid())));

-- photo_reactions
drop policy if exists photo_reactions_select on public.photo_reactions;
create policy photo_reactions_select on public.photo_reactions for select
  using (is_member() AND ((profile_id = (select auth.uid())) OR (EXISTS ( SELECT 1
     FROM photos ph
    WHERE ((ph.id = photo_reactions.photo_id) AND (ph.deleted_at IS NULL) AND (ph.place_id IS NOT NULL) AND place_is_saved(ph.place_id))))));

drop policy if exists photo_reactions_write on public.photo_reactions;
create policy photo_reactions_write on public.photo_reactions for all
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- photos
drop policy if exists photos_delete on public.photos;
create policy photos_delete on public.photos for delete
  using (is_owner() OR (uploaded_by = (select auth.uid())));

drop policy if exists photos_select on public.photos;
create policy photos_select on public.photos for select
  using ((deleted_at IS NULL) AND is_member() AND ((uploaded_by = (select auth.uid())) OR ((uploaded_by IS NULL) AND is_owner()) OR ((place_id IS NOT NULL) AND place_is_saved(place_id))));

-- place_ratings
drop policy if exists place_ratings_select on public.place_ratings;
create policy place_ratings_select on public.place_ratings for select
  using (is_member() AND ((profile_id = (select auth.uid())) OR ((place_id IS NOT NULL) AND place_is_saved(place_id))));

drop policy if exists place_ratings_write on public.place_ratings;
create policy place_ratings_write on public.place_ratings for all
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- place_wishes
drop policy if exists place_wishes_write on public.place_wishes;
create policy place_wishes_write on public.place_wishes for all
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- places
drop policy if exists places_select on public.places;
create policy places_select on public.places for select
  using ((deleted_at IS NULL) AND is_member() AND (saved OR (created_by = (select auth.uid())) OR ((created_by IS NULL) AND is_owner())));

-- videos
drop policy if exists videos_select on public.videos;
create policy videos_select on public.videos for select
  using (is_member() AND ((uploaded_by = (select auth.uid())) OR ((uploaded_by IS NULL) AND is_owner()) OR ((place_id IS NOT NULL) AND place_is_saved(place_id))));

-- 2. Pin function search_path --------------------------------------------------

alter function public.activity_category(p_type text) set search_path = public, pg_temp;
alter function public.neutralize_junk_place() set search_path = public, pg_temp;
alter function public.on_this_day() set search_path = public, pg_temp;
alter function public.place_membership_no_cycle() set search_path = public, pg_temp;
alter function public.race_bucket(p_miles double precision) set search_path = public, pg_temp;

-- 3. Drop the redundant duplicate index (keep the primary key) ------------------

alter table public.place_membership drop constraint if exists place_membership_unique_pair;
