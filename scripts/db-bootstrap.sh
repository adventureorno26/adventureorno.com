#!/usr/bin/env bash
# Build a fully-migrated DISPOSABLE local database for verification + type
# generation. NEVER point this at production.
#
# Why not `supabase db reset`? The historical migration chain cannot be applied
# strictly in-order on a fresh database:
#   * 0001_init.sql defines `language sql` helpers that reference public.profiles
#     before it exists (fails unless check_function_bodies=off), and
#   * 0044 backfills places.city from a drifted places.address column that no
#     migration creates (added out-of-band; reconciled by 0098).
# This script applies the whole chain in ONE psql session with body checks off —
# safe for a throwaway DB — and tolerates the single benign 0044 backfill error
# (it runs before 0098 adds the column; harmless on an empty DB). The long-term
# fix is a squashed re-baseline (see docs/decisions.md).
#
# Prereq: `supabase start` (local Docker stack). Usage: scripts/db-bootstrap.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
MIGR="$HERE/supabase/migrations"
PROJECT="$(grep -E '^project_id' "$HERE/supabase/config.toml" | sed -E 's/.*"(.*)".*/\1/')"
DB="supabase_db_${PROJECT}"

docker inspect "$DB" >/dev/null 2>&1 || {
  echo "Local db container '$DB' not found. Run 'supabase start' first." >&2
  exit 1
}

echo "Rebuilding disposable schema in $DB (LOCAL only) ..."
docker exec -i "$DB" psql -U postgres -d postgres -q -c \
  "drop schema if exists public cascade; create schema public; grant all on schema public to postgres, anon, authenticated, service_role;" >/dev/null

ERRLOG="$(mktemp)"
{ echo 'set check_function_bodies=off;'; for f in "$MIGR"/*.sql; do cat "$f"; echo; done; } \
  | docker exec -i "$DB" psql -U postgres -d postgres -q 2>"$ERRLOG" >/dev/null

ERRS=$(grep -c '^ERROR' "$ERRLOG" 2>/dev/null || true)
echo "Applied $(ls "$MIGR"/*.sql | wc -l | tr -d ' ') migrations. Non-notice errors: ${ERRS:-0}"
if [ "${ERRS:-0}" != "0" ]; then
  echo "--- errors (one benign 0044 'places.address' backfill is expected) ---"
  grep '^ERROR' "$ERRLOG" || true
fi
rm -f "$ERRLOG"
echo "Disposable DB ready."
