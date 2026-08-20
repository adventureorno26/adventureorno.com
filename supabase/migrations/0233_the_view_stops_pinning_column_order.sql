-- 0233 — the view stops naming its columns, because naming them pinned their ORDER.
--
-- 0228 rewrote `visible_activities` with an explicit column list, copied from the view as it
-- stands in production. It applied there without complaint. It then failed the moment CI
-- replayed the whole chain onto an empty database:
--
--     ERROR: cannot change name of view column "source_id" to "elevation_gain"
--
-- `CREATE OR REPLACE VIEW` may change a view's query but NOT the names or positions of its
-- columns. Production's `activities` has accumulated columns in one order over 233
-- migrations; a fresh replay builds them in another. An explicit list is therefore a
-- promise about column ORDER that only holds on the database it was copied from.
--
-- Every earlier definition — 0193, 0200 — used `select a.*` and never had the problem. That
-- is the fix: state the RULE, not the shape of the table it happens to run against.
--
-- Worth recording, since it looked for a moment like a regression: the view has NOT carried
-- `security_invoker` since 0200, so the view's own WHERE clause is the boundary rather than
-- the caller's RLS. 0228 did not change that, and neither does this.
create or replace view public.visible_activities as
  select a.*
    from public.activities a
   where lower(coalesce(a.original_source, '')) <> 'strava'
      or a.owner_profile = auth.uid()
      -- 0228: an outing you were ON, when its owner has chosen to share what they tag.
      or exists (
           select 1
             from public.activity_profiles ap
             join public.profiles ow on ow.id = a.owner_profile
            where ap.activity_id = a.id
              and ap.profile_id = auth.uid()
              and coalesce(ap.claim_status, 'accepted') <> 'declined'
              and ow.share_tagged_outings);

comment on view public.visible_activities is
  'Activities the caller may see: not Strava-sourced, or theirs, or an outing they were on '
  'whose owner shares what they tag (0228). Uses select a.* deliberately — an explicit '
  'column list pins column ORDER and breaks a replay onto an empty database (0233).';
