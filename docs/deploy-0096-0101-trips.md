# Production deploy runbook — migrations 0096–0101 (canonical Trip model)

**Status:** NOT yet deployed. This is the ADR 0001 "Trip Option A" backend, verified
only on the disposable local stack. Run these steps in order; step 3 MUST happen
before the push or `0100` aborts by design.

**Who does what:** Erica executes the production + secret steps below (they require
the real edge-secret value and dashboard access, which Claude must not handle).
After the deploy is confirmed, Claude regenerates `database.types.ts` from the live
schema and starts the frontend cutover.

## What this deploys

| Migration | Effect on production | Reversible? |
|---|---|---|
| `0096_place_membership_canonical` | Constraints/RLS on `place_membership` (canonical hierarchy). | Yes (drop constraints) |
| `0097_trips` | New `trips` table + RLS + `trip_stats` RPC + `source_place_id`. Additive. | Yes (drop table) |
| `0098_reconcile_places_columns` | Idempotent reconcile of drifted `places` columns (`suggested`, etc.). | No-op if already present |
| `0099_trip_stops_and_migrate_places` | **Data mutation:** creates `trip_stops`, then backfills the 33 container-Place trips into `trips` + stops; quarantines ambiguous ones into `trip_migration_exceptions`. **0 rows deleted.** | Yes (delete migrated trips, drop stops) |
| `0100_secure_scheduled_edge_functions` | (Re)schedules `detect-trips-nightly` + `geocode-new-places-nightly` cron, reading the apikey from Vault. **Aborts unless the Vault secret exists (step 3).** | Yes (unschedule) |
| `0101_stable_visits_and_trip_stop_semantics` | Rewrites `rebuild_place_visits` (stable, ID-preserving) + trip_stop integrity/promotion/demotion triggers. Affects the derived-visit engine app-wide. | Partial (re-run prior fn) |

Each file has an in-file `ROLLBACK:` header with the exact reverse statements.

## Steps (in order)

**0. Coordinate with Codex.** Codex has been rotating the edge service key on this
exact surface (`0100`, sanitized `0057`/`0071`, edge functions). Confirm that rotation
is finished and not mid-flight before deploying `0100`, or the two will collide.

**1. Snapshot.** Take a fresh production DB backup (Supabase dashboard → Database →
Backups, or `pg_dump`). This deploy is additive/reversible, but snapshot first.

**2. Deploy method — DIRECT SQL, not `supabase db push`.** Production's
`supabase_migrations.schema_migrations` tracking table is **empty** (this project's
migrations have always been applied directly, per the "drive Supabase directly"
ops model). So `supabase db push` / `supabase migration list` are unusable here —
they would try to replay the whole chain from `0001` against the already-populated
schema and fail. Apply the six files **directly**, in numeric order, via the
Supabase **dashboard SQL editor** (or `psql` with the prod connection string).

Prod already has `place_membership` (231 rows) and the full pre-trips schema; it does
**not** have `trips`/`trip_stops`/`trip_migration_exceptions`. Because `0096`
canonicalizes an already-existing `place_membership`, run each file and watch for
"already exists" errors — if `0096`'s constraints are already present, that file is a
partial no-op; the `trips`/`trip_stops` files (`0097`,`0099`) create fresh tables.

**3. Provision the Vault secret (BEFORE the push).** `0100`'s preflight raises if
`aon_edge_secret_key` is absent. Its value must equal the edge functions'
`AON_SUPABASE_SECRET_KEY`. Since that key was exposed in the old `0057`/`0071` and is
being rotated, set the NEW rotated value here:
```
-- Supabase dashboard → Vault → New secret, name: aon_edge_secret_key, value: <new key>
-- or via SQL (do NOT paste the value into any committed file / log):
select vault.create_secret('<NEW_EDGE_SECRET_VALUE>', 'aon_edge_secret_key');
```

**4. Rotate the exposed JWT (security exception, item 11).** Set the same NEW value as
`AON_SUPABASE_SECRET_KEY` on BOTH edge functions (`detect-trips`, `geocode-new-places`)
so the cron apikey (from Vault) matches. The old inline JWT from the sanitized
`0057`/`0071` must stay revoked and never be reintroduced.

**5. Push the migrations.**
```
supabase db push               # applies 0096 → 0101 in order
```

**6. Verify production.**
```
-- trips backfilled (~33) + stops + quarantine present
select count(*) from public.trips where source_place_id is not null;
select count(*) from public.trip_stops;
select count(*) from public.trip_migration_exceptions;
-- cron reads from Vault, no inline JWT
select jobname, command like '%decrypted_secrets%' as vault_ok, command like '%eyJ%' as has_inline_jwt
  from cron.job where jobname in ('detect-trips-nightly','geocode-new-places-nightly');
-- trip_stats not anon-executable
select has_function_privilege('anon','public.trip_stats(uuid)','execute');   -- expect false
```
Then run the dashboard security advisor (Advisors → Security) and confirm no new
critical findings.

**7. Hand back to Claude.** Paste the step-6 output (or just confirm success). Claude
then runs `SUPABASE_ACCESS_TOKEN=… npm run gen:types`, commits the regenerated
`database.types.ts` (now including `trips`/`trip_stops`), and begins the frontend
cutover (`Trips.tsx`, `PlacePanel`, `TripItinerary`, `MapView.addTagged`, `data.ts`,
retiring the orphaned `lib/trips.ts` date-range path).

## If something fails

- `0100` aborts "Vault secret … not provisioned" → step 3 wasn't done; provision it,
  re-run `supabase db push`.
- Any migration errors mid-push → `supabase db push` stops at the failed migration;
  the earlier ones are applied. Fix or roll back that migration using its in-file
  `ROLLBACK:` header, then decide whether to continue or revert the set.
- To fully back out: apply each file's `ROLLBACK:` block in reverse order
  (`0101`→`0096`). No rows are deleted by the forward migrations except the
  migrated-trip rows they created (safe to remove on rollback).
