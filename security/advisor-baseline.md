# Supabase advisor baseline — 2026-08-07

Every advisor finding on project `aanfyhsjbtnqzphuoiem`, classified. The point of
recording it is drift: a finding that is **not** on this list is new and needs a
decision. Re-check with:

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://api.supabase.com/v1/projects/aanfyhsjbtnqzphuoiem/advisors/security"
```

(The browser-like User-Agent is required — the Cloudflare WAF in front of the
Management API returns 403 "error 1010" without one.)

## Security — 83 findings

| Level | Name | Count | Status |
|---|---|---|---|
| ERROR | `rls_disabled_in_public` | 1 | **Cannot fix — PostGIS-owned** |
| WARN | `authenticated_security_definer_function_executable` | 72 | **Intended** |
| WARN | `anon_security_definer_function_executable` | 3 | **Cannot fix — PostGIS-owned** |
| WARN | `extension_in_public` | 3 | Accepted |
| WARN | `auth_leaked_password_protection` | 1 | **Open — needs Erica** |
| INFO | `rls_enabled_no_policy` | 3 | **Intended (deny-all)** |

### ERROR `rls_disabled_in_public` — `public.spatial_ref_sys`

Not our table. Owned by `supabase_admin` and part of the `postgis` extension
(verified via `pg_class.relowner` + `pg_depend`), so RLS cannot be enabled from a
migration. It holds only public EPSG coordinate-system definitions — no household
data. Supabase documents this as an unavoidable PostGIS warning.

### WARN `anon_security_definer_function_executable` — `public.st_estimatedextent` x3

The three PostGIS overloads. Also `supabase_admin`-owned. Migration 0093's
lockdown *tried* to revoke these and Postgres reported `WARNING: no privileges
could be revoked for "st_estimatedextent"` — we are not the owner. This is why
`scripts/db-test.sh`'s lockdown check excepts `st_*`, and its "0 anon-executable
SECDEF functions" result is accurate for first-party code.

### WARN `authenticated_security_definer_function_executable` x72

The intended application RPCs. Every one is `SECURITY DEFINER` on purpose (they
must bypass RLS to do member-gated work) and every one is granted to
`authenticated` only — never `anon`, never `PUBLIC`, per migration 0093 and rule
#8. `db-test.sh` asserts that invariant on every run.

### INFO `rls_enabled_no_policy` — `google_tokens`, `oauth_states`, `strava_accounts`

**Intended, and the most secure configuration.** RLS is on with zero policies, so
every non-service-role caller is denied by default. These tables hold Google and
Strava `refresh_token` / `access_token` values; only service-role Edge Functions
(`strava-auth`, `strava-webhook`, `_shared/strava`, `google-photos-token`) read
them, and the browser never queries them at all.

Migration **0123** closed a real gap the advisor surfaced here: `google_tokens`
and `strava_accounts` still carried table-level GRANTs to `anon` and
`authenticated` (`anon=arwdDxtm`). Inert while RLS denies, but live the moment
anyone adds a permissive policy or disables RLS. `oauth_states` had already been
locked down in 0120; these two were missed. Now revoked and asserted by
`supabase/tests/0123_lock_oauth_token_tables.test.sql`.

### WARN `auth_leaked_password_protection` — OPEN, needs Erica

A hosted Auth setting (dashboard → Authentication → Password), not a migration.
Enabling it checks new passwords against HaveIBeenPwned. Low impact here because
sign-in is Google/magic-link and the only password account is the test bot, but it
is free hardening. **Hosted setting changes need Erica's authority** per the
Phase 1 working rules, so it stays open.

## Performance — 141 findings

| Level | Name | Count | Status |
|---|---|---|---|
| WARN | `multiple_permissive_policies` | 102 | Accepted for now |
| INFO | `unindexed_foreign_keys` | 31 | Accepted at this data size |
| INFO | `unused_index` | 6 | Accepted |
| INFO | `no_primary_key` | 2 | Accepted |

At current volume — 183 places, 568 visits, 159 photos, 444 activities, ~17k
location pings — none of these is a live problem, and the app has no reported
slowness. `multiple_permissive_policies` is inherent to the owner/editor/viewer
model (separate policies per role on the same table); collapsing them would
trade auditability for microseconds. Revisit only if a query becomes slow, and
measure first.
