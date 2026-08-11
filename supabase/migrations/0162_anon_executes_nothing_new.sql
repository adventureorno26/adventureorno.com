-- 0162 — take EXECUTE away from anon on the four functions added today.
--
-- The authz matrix test (0154) caught this, which is what it is for:
--
--   FAIL: anon can execute SECURITY DEFINER functions:
--     photo_pin_marks_visit_decided  photo_reactions_for_many  trips_list  visits_mark_decided
--
-- Postgres grants EXECUTE to PUBLIC on every new function, and `anon` inherits it. A
-- SECURITY DEFINER function runs as its owner, so an anon-executable one is a hole
-- straight through RLS. The project's rule is that anon executes NOTHING in public;
-- 0093 and 0154 established it and every other function already complies.
--
-- Two of these are TRIGGER functions (visits_mark_decided, photo_pin_marks_visit_decided
-- from 0157). A trigger function is never called directly by a client, so nobody needs
-- EXECUTE on it at all — not even `authenticated`. Triggers fire as the table owner
-- regardless of who holds a grant.
--
-- The other two are read RPCs the app calls (0158, 0160). They keep `authenticated`,
-- which is what their own migrations granted, and lose PUBLIC/anon. Both already begin
-- with `select public.assert_member()`, so this closes the outer door on functions
-- whose inner door was already locked.
--
-- ROLLBACK: `grant execute on function ... to public;` — but do not. This is the rule.

begin;

-- Trigger functions: no direct caller, so no grants at all.
revoke all on function public.visits_mark_decided() from public, anon, authenticated;
revoke all on function public.photo_pin_marks_visit_decided() from public, anon, authenticated;

-- Read RPCs: the app calls these while signed in, and nobody else may.
revoke all on function public.photo_reactions_for_many(uuid[]) from public, anon;
grant execute on function public.photo_reactions_for_many(uuid[]) to authenticated;

revoke all on function public.trips_list(uuid) from public, anon;
grant execute on function public.trips_list(uuid) to authenticated;

commit;
