-- 0232 — `same_recording_of` was left executable by anon. Caught by 0154, in the same hour.
--
-- 0230 added `same_recording_of` and did not revoke the default grant. Postgres grants
-- EXECUTE on a new function to PUBLIC, so a brand-new SECURITY DEFINER function that reads
-- `public.activities` was callable by an unauthenticated visitor — it would answer "does
-- this person have a recording starting within 60 seconds of X?", which is a probe into
-- somebody's movements even though it returns only an id.
--
-- Every other function in this repository ends with the same three lines. This one did not,
-- and `0154_authz_matrix` said so within the hour: *"anon can execute SECURITY DEFINER
-- functions: same_recording_of"*. That test exists precisely because a missing REVOKE looks
-- like nothing at all.
--
-- Nothing else changes: the function's logic was right, its permissions were not.
revoke all on function public.same_recording_of(uuid, text, timestamptz, uuid) from public, anon;
grant execute on function public.same_recording_of(uuid, text, timestamptz, uuid) to authenticated;
