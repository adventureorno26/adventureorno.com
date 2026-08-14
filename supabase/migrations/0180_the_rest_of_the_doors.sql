-- 0180 — the doors phase 6 left open.
--
-- 0176 closed direct writes to `visits` and the tables hanging off it, and I reported
-- that phase done. An audit of PRODUCTION rather than of my own notes says otherwise:
-- five more tables holding canonical state are still writable by any signed-in browser.
--
-- Every one is the SAME CAUSE as `visit_evidence` in 0176: the table was created before
-- 0174 fixed the default grants, and its migration only revoked from `public` and
-- `anon`. Supabase's default ACL had already handed `authenticated` everything at
-- CREATE TABLE. Writing `grant select ... to authenticated` does not take anything away.
--
--   activity_profiles          WHO DID an activity. A browser could rewrite attribution
--                              directly, past `activities_sync_participants`, and the
--                              miles would follow the edit — the derived-vs-source bug
--                              with the source itself overwritten.
--   place_membership           The MIRROR of `places.part_of` (§8). A direct write here
--                              looks right and is deleted by the sync trigger the moment
--                              part_of changes. Nothing should write it but the trigger.
--   visit_participant_review   Queues of things a human still has to settle. A browser
--   activity_participant_review  could empty its own review queue — the 9 activities
--   activity_visit_review      that say "Both" while their visit says one person.
--
-- ALREADY VERIFIED SAFE, so not touched: `accepted_visits` appears writable in the grant
-- listing, but 0170 set `security_invoker = true`, so base-table permissions are checked
-- as the CALLER — and `authenticated` has no INSERT on `visits`. Probed it directly:
-- "permission denied for table visits". The grant is an artifact, not a hole.
--
-- Reads are untouched everywhere; the card needs them.
--
-- ROLLBACK: grant insert, update, delete on each table back to authenticated.

begin;

revoke insert, update, delete on public.activity_profiles           from authenticated;
revoke insert, update, delete on public.place_membership            from authenticated;
revoke insert, update, delete on public.visit_participant_review    from authenticated;
revoke insert, update, delete on public.activity_participant_review from authenticated;
revoke insert, update, delete on public.activity_visit_review       from authenticated;

comment on table public.place_membership is
  'Which places sit inside which. THE MIRROR: places.part_of is the record, and '
  'places_sync_membership rebuilds this table from it. Read-only to a browser — a row '
  'written here survives only until part_of next changes, then vanishes silently (§8).';

comment on table public.activity_profiles is
  'Who did this activity (§0.3). Read-only to a browser: maintained by '
  'activities_sync_participants from activities.solo_profile, and read by every '
  'mileage, race and climbing statistic.';

commit;
