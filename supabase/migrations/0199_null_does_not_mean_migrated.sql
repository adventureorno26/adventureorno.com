-- 0199 — correcting 0198's comment, because it would have licensed the wrong deletion.
--
-- 0198 added `ingest_tokens.last_query_auth_at` and its comment said: "NULL, or far in
-- the past, means every caller has moved to the header and the fallback in
-- ingest-overland can be removed."
--
-- **That is not what NULL means, and checking the live data is what showed it.** Every
-- location ping in the last twelve days carries `source = 'app'` — the WEB APP's own
-- geolocation, written while the site is open. The device-token path has not been used
-- since 2026-07-29: `last_used_at` on "Erica iPhone — daily Shortcut" is three weeks old
-- and "Erica iPhone — photos" reads `never`.
--
-- So the column will sit at NULL, and it will not be because the Shortcut started sending
-- a header. It will be because the Shortcut is not running. Deleting the query-string
-- fallback on that evidence removes a path that is DORMANT, not retired — and it would
-- break silently on the day she next runs it, which is the exact failure this repository
-- keeps having in new clothes.
--
-- ABSENCE OF EVIDENCE READ AS EVIDENCE OF ABSENCE. It is the same mistake as
-- `solo_profile IS NULL` meaning "nobody said" and the UI rendering it as "both of us
-- were there" (§A(i)), and the same as a nightly cron failure looking like nothing at
-- all. A null is not a fact. This comment now says so.

comment on column public.ingest_tokens.last_query_auth_at is
  'When this token was last accepted from the ?token= QUERY STRING rather than the '
  'Authorization header. The query form puts a credential in request logs in plaintext '
  '(C5). '
  'READ IT WITH last_used_at, NEVER ALONE. NULL here means the query form has not been '
  'used — which is only good news if last_used_at is RECENT, proving the caller is alive '
  'and now sending the header. If last_used_at is stale too, the caller is merely dormant '
  'and deleting the fallback would break it the day it wakes up. As of 2026-08-17 that is '
  'the actual situation: the device path last ran 2026-07-29 and every current ping comes '
  'from the web app.';
