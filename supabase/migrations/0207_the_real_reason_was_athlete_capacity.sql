-- 0207 — correcting 0204: the ten minutes were not the reason.
--
-- 0204 lengthened the OAuth state TTL from 10 minutes to 30 and its comment presented that
-- as the explanation for Josh's failed Strava link. IT WAS NOT. He retried and Strava
-- answered plainly:
--
--     403 — too many athletes
--
-- Strava caps a NEW API application at ONE connected athlete. Erica is that one. Josh is
-- the second, so no state lifetime, no callback fix and no retry could ever have worked.
-- The cap is lifted only by submitting the app through Strava's Developer Program review,
-- which raises it to 999 and takes 7–10 business days.
--
-- WHAT I DID WRONG, since the file should say. A reviewer raised athlete capacity and I
-- recorded it as "fair, unresolved — both hypotheses stay open until the retry is
-- instrumented". That was right. Then I ruled out the redirect_uri by probing Strava,
-- found the short TTL, and reported it as the cause anyway — dropping my own caveat and
-- turning an unmeasured hypothesis into an answer. It is the same mistake this file keeps
-- recording in other clothes, and the instrumentation I said was needed is exactly what
-- would have produced "403 too many athletes" instead of a guess.
--
-- 0204 STANDS ON ITS OWN MERITS: ten minutes is genuinely too short for someone finding a
-- password or clearing 2FA, and the silent-failure fix in Settings is what turned this
-- retry into a diagnosis instead of another week of believing it had worked. Neither was
-- the cause.
comment on function public.strava_oauth_start() is
  'Mints a single-use OAuth state bound to the signed-in profile, valid 30 minutes. NOTE: '
  'the 30 minutes did NOT fix Josh''s link — Strava caps a new API app at ONE connected '
  'athlete and answered 403 "too many athletes" (0207). That needs Strava Developer Program '
  'review, not a code change. The longer window and the visible failure message stand on '
  'their own.';
