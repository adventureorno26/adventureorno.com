#!/usr/bin/env bash
# Bring up the DISPOSABLE local Supabase stack WITHOUT ever emptying the tracked
# working tree.
#
# Why this exists:
#   `supabase start` auto-applies supabase/migrations and cannot apply this chain
#   (it dies at "Initialising schema"). The long-standing workaround — the one
#   ci.yml still uses — is to move supabase/migrations/*.sql aside, start, then
#   move them back. That leaves the tracked directory EMPTY for a minute or two.
#
#   On 2026-08-08 the repo's auto-save hook fired inside exactly that window and
#   committed the empty directory as 123 deletions, then pushed. origin/main
#   carried ZERO migrations until it was restored in 611e966. Nothing was lost,
#   but a fresh clone had no migrations and CI's db-tests would have failed.
#
# This script removes the window entirely: it runs `supabase start` from a THROWAWAY
# project directory holding a copy of config.toml and an EMPTY migrations folder.
# The CLI keys its containers off `project_id` in config.toml, so the containers
# that come up are the same ones (supabase_db_<ref>) the real repo's tooling talks
# to over `docker exec`. The tracked tree is never modified.
#
# Usage:
#   bash scripts/local-stack-up.sh          # start (idempotent)
#   bash scripts/local-stack-up.sh --down   # stop
#
# After it is up:
#   bash scripts/db-bootstrap.sh --yes      # apply the real 124-migration chain
#   npm run seed:e2e                        # fictional owner/editor/viewer
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$HERE/supabase/config.toml"
PROJECT="$(grep -E '^project_id' "$CONFIG" | sed -E 's/.*"(.*)".*/\1/')"
DB_CONTAINER="supabase_db_${PROJECT}"
CLI="npx --yes supabase@2.98.0"

# Services the DB-only workflow does not need. Fewer images = fewer pulls.
EXCLUDE="realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"

if [ "${1:-}" = "--down" ]; then
  STAGE="$(mktemp -d)"
  cp "$CONFIG" "$STAGE/config.toml" 2>/dev/null || true
  mkdir -p "$STAGE/migrations"
  ( cd "$STAGE/.." && $CLI stop --no-backup >/dev/null 2>&1 ) || $CLI stop --no-backup >/dev/null 2>&1 || true
  rm -rf "$STAGE"
  echo "Local stack stopped."
  exit 0
fi

if docker exec "$DB_CONTAINER" psql -U postgres -d postgres -At -c "select 1" >/dev/null 2>&1; then
  echo "Local stack already up ($DB_CONTAINER)."
  exit 0
fi

# `supabase link` writes the LINKED PROJECT's service versions into
# supabase/.temp/*-version and storage-migration. `supabase start` then tries to
# match production instead of using cached images — it pulls several GB and dies
# with "StorageBackendError: Migration <name> not found". Those pins are useless
# for a disposable stack; drop them (keep project-ref so the link itself survives).
rm -f "$HERE/supabase/.temp/gotrue-version" \
      "$HERE/supabase/.temp/postgres-version" \
      "$HERE/supabase/.temp/rest-version" \
      "$HERE/supabase/.temp/storage-version" \
      "$HERE/supabase/.temp/storage-migration" \
      "$HERE/supabase/.temp/pooler-url" 2>/dev/null || true

STAGE="$(mktemp -d)/aon-local-stack"
mkdir -p "$STAGE/supabase/migrations"
cp "$CONFIG" "$STAGE/supabase/config.toml"

echo "Starting the disposable stack from a throwaway project dir (tracked tree untouched)…"
( cd "$STAGE" && $CLI start -x "$EXCLUDE" ) || {
  echo "supabase start failed. Stage dir kept for inspection: $STAGE" >&2
  exit 1
}

if ! docker exec "$DB_CONTAINER" psql -U postgres -d postgres -At -c "select 1" >/dev/null 2>&1; then
  echo "Stack reported success but $DB_CONTAINER is not reachable." >&2
  exit 1
fi

rm -rf "$(dirname "$STAGE")"
echo
echo "Local stack up. The tracked supabase/migrations was never touched:"
echo "  on disk: $(ls "$HERE"/supabase/migrations/*.sql | wc -l | tr -d ' ') migration(s)"
echo
echo "Next:  bash scripts/db-bootstrap.sh --yes   &&   npm run seed:e2e"
