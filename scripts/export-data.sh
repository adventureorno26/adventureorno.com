#!/usr/bin/env bash
# Versioned, integrity-checked data export for AdventureOrNo (replaces the old
# "export everything"). Produces a directory with:
#   manifest.json   — format + schema version, timestamp, per-table row counts + sha256
#   data/<table>.copy — Postgres COPY (text) of each canonical table
#
# Contains NO credentials or signed URLs: the token/credential tables
# (ingest_tokens, strava_accounts, google_tokens) are EXCLUDED; photo/video rows carry
# only their R2 object KEYS (the "R2 object manifest"), never bytes or signed URLs.
#
# Source is the LOCAL disposable Supabase db container by default. Encrypt the output
# with `age` before it leaves your machine (see docs/backup-restore.md); this script
# does not handle keys.
#
# Usage: scripts/export-data.sh <output-dir> [exported_at_iso]
set -euo pipefail

OUT="${1:?usage: export-data.sh <output-dir> [exported_at_iso]}"
EXPORTED_AT="${2:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
MIGR="$HERE/supabase/migrations"
PROJECT="$(grep -E '^project_id' "$HERE/supabase/config.toml" | sed -E 's/.*"(.*)".*/\1/')"
DB="supabase_db_${PROJECT}"
FORMAT_VERSION=1
# Schema version = the highest migration number applied to the disposable chain.
SCHEMA_VERSION="$(ls "$MIGR"/*.sql | sed -E 's:.*/([0-9]{4})_.*:\1:' | sort -n | tail -1)"

# Canonical tables, parents-first. Credential/token tables are intentionally absent
# (google_tokens, ingest_tokens, oauth_states, strava_accounts), and so are the
# operational logs (job_runs, ingest_runs) and machine proposals (suggestions).
#
# ⚠️ THIS LIST WENT STALE AND IT MATTERED. Until 2026-08-15 it was missing
# `visit_profiles` and `activity_profiles` — which, since migration 0188 dropped
# `solo_profile`, are the ONLY record of who was on a visit or who did an activity.
# Exporting with this tool would have produced a copy of the data with every
# attribution silently gone: every statistic in the app reads those tables.
#
# It was also missing `approved_fields`, the ledger of which fields a PERSON has
# decided — the thing that stops automation overwriting her work. Losing that does not
# lose data; it loses the protection on the data, which is worse because it is
# invisible until something rewrites a name she chose.
#
# The nightly backup is NOT affected: `backup-db.mjs` enumerates pg_tables and takes
# whatever exists, which is why it survived the same schema change untouched. This is
# the hand-maintained list, and hand-maintained lists rot.
TABLES=(
  profiles people places place_membership place_membership_exceptions
  place_categories visits visit_profiles visit_people visit_evidence
  entries activities activity_profiles activity_options location_pings photos videos
  trail_routes trip_migration_exceptions
  place_ratings place_wishes photo_reactions activity_reactions peaks parks peak_bags
  board_items shared_links revealed_area deleted_hashes dup_dismissed settings
  approved_fields approval_undo
  visit_participant_review activity_participant_review activity_visit_review
)

psql_db() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
sha256() { shasum -a 256 "$1" | awk '{print $1}'; }

docker inspect "$DB" >/dev/null 2>&1 || { echo "Local db '$DB' not found. Run 'supabase start'." >&2; exit 1; }

mkdir -p "$OUT/data"
echo "Exporting to $OUT (schema $SCHEMA_VERSION) ..."
ENTRIES=()
for t in "${TABLES[@]}"; do
  # Skip tables that don't exist in this schema (keeps the list forward/backward safe).
  exists="$(psql_db -tA -c "select to_regclass('public.$t') is not null;")"
  if [ "$exists" != "t" ]; then echo "  skip $t (absent)"; continue; fi
  psql_db -c "\copy public.$t to '/tmp/$t.copy' (format text)" >/dev/null
  docker cp "$DB:/tmp/$t.copy" "$OUT/data/$t.copy" >/dev/null
  docker exec "$DB" rm -f "/tmp/$t.copy" >/dev/null 2>&1 || true
  rows="$(psql_db -tA -c "select count(*) from public.$t;")"
  ENTRIES+=("$t:$rows:$(sha256 "$OUT/data/$t.copy")")
  echo "  ok   $t ($rows rows)"
done

# manifest.json (python for safe JSON; timestamp passed in — scripts must be deterministic).
python3 - "$OUT/manifest.json" "$FORMAT_VERSION" "$SCHEMA_VERSION" "$EXPORTED_AT" "${ENTRIES[@]}" <<'PY'
import json, sys
out, fmt, schema, ts, *entries = sys.argv[1:]
tables = []
for e in entries:
    name, rows, sha = e.split(':')
    tables.append({"name": name, "rows": int(rows), "sha256": sha})
manifest = {"format_version": int(fmt), "schema_version": schema,
            "exported_at": ts, "tables": tables}
with open(out, "w") as f:
    json.dump(manifest, f, indent=2)
PY
echo "Wrote $OUT/manifest.json ($(echo "${#ENTRIES[@]}") tables). Encrypt with age before moving it off-box."
