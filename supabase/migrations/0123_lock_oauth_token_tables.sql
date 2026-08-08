-- 0123 — Revoke client grants on the OAuth token tables (defense in depth).
--
-- Found by the Supabase security advisor (COMPLETION-PLAN Phase 5). Both
-- `google_tokens` and `strava_accounts` have RLS enabled with ZERO policies, so
-- RLS already denies every client read — but they still carried table-level
-- GRANTs to `anon` and `authenticated`:
--
--   google_tokens    anon=arwdDxtm | authenticated=arwdDxtm | service_role=...
--   strava_accounts  anon=arwdDxtm | authenticated=arwdDxtm | service_role=...
--
-- Those grants are inert TODAY only because RLS denies by default. They become
-- live the moment anyone adds a permissive policy or toggles RLS off, and these
-- two tables hold the most sensitive rows in the system: Google and Strava
-- `refresh_token` / `access_token` values. `oauth_states` was already locked down
-- correctly in 0120 (postgres + service_role only); these two were missed.
--
-- Safe: the browser never queries either table (only the generated types mention
-- them). Every reader is a service-role Edge Function — strava-auth,
-- strava-webhook, _shared/strava, google-photos-token — and service_role both
-- keeps its grant and bypasses RLS.

revoke all on table public.google_tokens from anon;
revoke all on table public.google_tokens from authenticated;
revoke all on table public.strava_accounts from anon;
revoke all on table public.strava_accounts from authenticated;

-- Keep the service-role path explicit rather than relying on a prior grant.
grant select, insert, update, delete on table public.google_tokens to service_role;
grant select, insert, update, delete on table public.strava_accounts to service_role;

-- RLS stays ON with no policies: deny-all to any non-service-role caller.
alter table public.google_tokens enable row level security;
alter table public.strava_accounts enable row level security;
