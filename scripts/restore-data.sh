#!/usr/bin/env bash
# Restore a versioned export (see export-data.sh) into the LOCAL DISPOSABLE Supabase
# db ONLY. Verifies the manifest's format + schema version and every per-table sha256
# before touching data, then restores under `session_replication_role = replica` so
# triggers and FK checks don't mutate or reject the restored rows.
#
# SAFETY: this talks only to the local docker container `supabase_db_<project>`; it
# has no path to production. It still requires explicit confirmation (--yes) and
# refuses a schema-version mismatch unless --force is given. The truncate CASCADEs to
# the excluded credential tables (ingest_tokens/strava_accounts/google_tokens FK to
# profiles), so restore is a full DISPOSABLE reset — never a merge into a populated db.
#
# Usage: AON_RESTORE_CONFIRM=yes scripts/restore-data.sh <input-dir> [--force]
set -euo pipefail

IN="${1:?usage: restore-data.sh <input-dir> [--force]}"
FORCE=""; [ "${2:-}" = "--force" ] && FORCE=1
HERE="$(cd "$(dirname "$0")/.." && pwd)"
MIGR="$HERE/supabase/migrations"
PROJECT="$(grep -E '^project_id' "$HERE/supabase/config.toml" | sed -E 's/.*"(.*)".*/\1/')"
DB="supabase_db_${PROJECT}"
SCHEMA_NOW="$(ls "$MIGR"/*.sql | sed -E 's:.*/([0-9]{4})_.*:\1:' | sort -n | tail -1)"

[ -f "$IN/manifest.json" ] || { echo "No manifest.json in $IN" >&2; exit 1; }
docker inspect "$DB" >/dev/null 2>&1 || { echo "Local db '$DB' not found. Run 'supabase start'." >&2; exit 1; }
if [ "${AON_RESTORE_CONFIRM:-}" != "yes" ]; then
  echo "This TRUNCATES + reloads the local '$DB' app tables. Re-run with AON_RESTORE_CONFIRM=yes." >&2
  exit 2
fi

# Manifest → "name rows sha256" lines + a schema check.
read -r SCHEMA_EXP < <(python3 -c "import json,sys;print(json.load(open('$IN/manifest.json'))['schema_version'])")
if [ "$SCHEMA_EXP" != "$SCHEMA_NOW" ] && [ -z "$FORCE" ]; then
  echo "Schema mismatch: export=$SCHEMA_EXP, current chain=$SCHEMA_NOW. Re-run with --force to override." >&2
  exit 1
fi
ROWS=()
while IFS= read -r line; do ROWS+=("$line"); done < <(python3 -c "
import json
for t in json.load(open('$IN/manifest.json'))['tables']:
    print(t['name'], t['rows'], t['sha256'])")

# 1) Verify every checksum before touching data.
for line in "${ROWS[@]}"; do
  set -- $line; name=$1; sha=$3
  actual="$(shasum -a 256 "$IN/data/$name.copy" | awk '{print $1}')"
  [ "$actual" = "$sha" ] || { echo "CHECKSUM MISMATCH for $name (manifest $sha, file $actual)" >&2; exit 1; }
done
echo "All ${#ROWS[@]} checksums verified. Restoring into $DB ..."

# 2) Copy data files into the container, build the restore script.
TABLES=()
for line in "${ROWS[@]}"; do set -- $line; TABLES+=("public.$1"); done
TRUNC=$(IFS=,; echo "${TABLES[*]}")
{
  echo "set session_replication_role = replica;"
  echo "truncate $TRUNC restart identity cascade;"
} > /tmp/aon_restore.sql
for line in "${ROWS[@]}"; do
  set -- $line; name=$1
  docker cp "$IN/data/$name.copy" "$DB:/tmp/r_$name.copy" >/dev/null
  echo "\\copy public.$name from '/tmp/r_$name.copy' (format text)" >> /tmp/aon_restore.sql
done
echo "reset session_replication_role;" >> /tmp/aon_restore.sql
docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < /tmp/aon_restore.sql >/dev/null
docker exec "$DB" sh -c 'rm -f /tmp/r_*.copy' >/dev/null 2>&1 || true

# 3) Verify restored counts match the manifest.
FAIL=0
for line in "${ROWS[@]}"; do
  set -- $line; name=$1; want=$2
  got="$(docker exec -i "$DB" psql -U postgres -d postgres -tA -c "select count(*) from public.$name;" | tr -d ' ')"
  [ "$got" = "$want" ] || { echo "  ROW MISMATCH $name: manifest=$want restored=$got" >&2; FAIL=1; }
done
[ "$FAIL" -eq 0 ] || { echo "Restore verification FAILED." >&2; exit 1; }
echo "Restore complete: ${#ROWS[@]} tables, all row counts match the manifest."
