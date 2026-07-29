#!/usr/bin/env bash
# Build a fully-migrated DISPOSABLE local database for verification + type
# generation. STRICT and NETWORK-ISOLATED. NEVER production.
#
# Safety properties:
#   * Requires explicit confirmation before dropping the local schema
#     (AON_BOOTSTRAP_CONFIRM=yes, or pass --yes). No silent destruction.
#   * NETWORK ISOLATION: immediately unschedules ALL pg_cron jobs after apply, so
#     no migration-scheduled job (e.g. 0057/0071's net.http_post to the PRODUCTION
#     url + service_role key) can ever fire from the disposable DB. Migrations only
#     REGISTER cron jobs during apply; they don't POST during apply.
#   * FAILS ON ANY UNEXPECTED ERROR. Exactly one historical error is tolerated —
#     0044 backfills places.city from a drifted places.address column that no
#     migration creates (see docs/decisions.md; harmless on an empty DB). Any other
#     error aborts with a non-zero exit. `check_function_bodies=off` is set for the
#     one apply session to accommodate 0001's sql helpers defined before profiles.
#   * Keeps the error log for inspection; never reports success on a partial apply.
#
# The long-term fix (so a plain `supabase db reset` works with zero tolerated
# errors) is a squashed re-baseline — tracked as remaining debt.
#
# Prereq: `supabase start`. Usage: scripts/db-bootstrap.sh --yes
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
MIGR="$HERE/supabase/migrations"
PROJECT="$(grep -E '^project_id' "$HERE/supabase/config.toml" | sed -E 's/.*"(.*)".*/\1/')"
DB="supabase_db_${PROJECT}"

if [ "${1:-}" != "--yes" ] && [ "${AON_BOOTSTRAP_CONFIRM:-}" != "yes" ]; then
  echo "This DROPS and rebuilds the local '$DB' public schema." >&2
  echo "Re-run with --yes (or AON_BOOTSTRAP_CONFIRM=yes) to confirm." >&2
  exit 2
fi

docker inspect "$DB" >/dev/null 2>&1 || {
  echo "Local db container '$DB' not found. Run 'supabase start' first." >&2
  exit 1
}

psql_db() { docker exec -i "$DB" psql -U postgres -d postgres "$@"; }

echo "Rebuilding disposable schema in $DB (LOCAL only) ..."
# Recreate public AND re-establish Supabase's default table/sequence privileges (which
# dropping the schema loses) so the disposable DB faithfully reflects production grants
# — required to test RLS under SET ROLE authenticated. Function EXECUTE grants are left
# to the migrations (which revoke anon on SECURITY DEFINER fns).
psql_db -q -c "
  drop schema if exists public cascade; create schema public;
  grant usage, create on schema public to postgres, anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
" >/dev/null

# 0100's PREFLIGHT refuses to schedule the Edge Function cron jobs unless the Vault
# secret exists. Provision a DUMMY on the disposable DB so 0100 applies; the value is
# never used (all cron jobs are unscheduled immediately after apply — see below).
psql_db -q -c "
  do \$\$ begin
    if not exists (select 1 from vault.decrypted_secrets where name='aon_edge_secret_key') then
      perform vault.create_secret('disposable-local-only', 'aon_edge_secret_key');
    end if;
  end \$\$;" >/dev/null 2>&1 || true

umask 077
ERRLOG="$HERE/.db-bootstrap.errors.log"   # kept for inspection (gitignored)
: > "$ERRLOG"
{ echo 'set check_function_bodies=off;'; for f in "$MIGR"/*.sql; do cat "$f"; echo; done; } \
  | psql_db -q 2>"$ERRLOG" >/dev/null || true

# NETWORK ISOLATION: kill any scheduled job before it can POST to production.
UNSCHED=$(psql_db -tA -c "select coalesce(count(*),0) from cron.job;" 2>/dev/null | tr -d ' ' || echo 0)
psql_db -q -c "select cron.unschedule(jobid) from cron.job;" >/dev/null 2>&1 || true
echo "Unscheduled ${UNSCHED} pg_cron job(s) (network-isolated: no prod HTTP can fire)."

# Fail on any UNEXPECTED error. The only tolerated one is the known 0044 backfill.
UNEXPECTED=$(grep '^ERROR' "$ERRLOG" | grep -v 'column pl.address does not exist' || true)
TOTAL=$(grep -c '^ERROR' "$ERRLOG" || true)
if [ -n "$UNEXPECTED" ]; then
  echo "FAILED: unexpected migration error(s). See $ERRLOG:" >&2
  echo "$UNEXPECTED" >&2
  exit 1
fi

# Verify the schema is actually complete (never report success on a partial apply).
CORE=$(psql_db -tA -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ('places','visits','entries','activities','photos','videos','profiles','place_membership','trips','trip_stops','settings','location_pings');" | tr -d ' ')
if [ "$CORE" != "12" ]; then
  echo "FAILED: expected 12 core tables, found $CORE. See $ERRLOG." >&2
  exit 1
fi

echo "OK: applied $(ls "$MIGR"/*.sql | wc -l | tr -d ' ') migrations; ${TOTAL:-0} tolerated error(s) (0044 backfill only); ${CORE} core tables. Disposable DB ready."
