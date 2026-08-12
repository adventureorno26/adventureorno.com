#!/usr/bin/env bash
# PROVE THE BACKUP RESTORES. An untested backup is a rumour.
#
#   AGE_KEY_FILE=~/.aon-backup/backup-key.txt scripts/verify-restore.sh [backup.age]
#
# With no argument it pulls the NEWEST backup out of R2, which is the version that
# matters: it tests the artifact that actually exists, not one made moments ago on
# this machine.
#
# What it does:
#   1. downloads (or takes) the encrypted backup
#   2. decrypts it with the age private key — proving the key still opens it
#   3. rebuilds the schema in a DISPOSABLE Postgres 17 container from the migration
#      chain, the same way a real recovery would
#   4. loads every table's rows back in
#   5. asserts the restored row counts match the manifest EXACTLY
#
# Step 3 is the one that catches the expensive failures: on 2026-08-11 eight
# migrations were applied to production but missing from its ledger, and 0001 could
# not apply to a fresh database at all. Either of those would have turned a "restore"
# into a differently-shaped database that looked fine until it didn't.
#
# Nothing here touches production. It refuses to run against a non-local database.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$(grep -E '^project_id' "$HERE/supabase/config.toml" | sed -E 's/.*"(.*)".*/\1/')"
DB="supabase_db_${PROJECT}"
KEY_FILE="${AGE_KEY_FILE:-$HOME/.aon-backup/backup-key.txt}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

[ -f "$KEY_FILE" ] || { echo "No age key at $KEY_FILE — cannot decrypt." >&2; exit 1; }
docker inspect "$DB" >/dev/null 2>&1 || {
  echo "Local database container '$DB' not found. Run 'supabase start' first." >&2; exit 1; }

BACKUP="${1:-}"
if [ -z "$BACKUP" ]; then
  : "${CLOUDFLARE_API_TOKEN_MASTER:?need CLOUDFLARE_API_TOKEN_MASTER to fetch from R2}"
  ACCT=9bed5239120cee4e9e7d46fa69ef4784
  echo "Finding the newest backup in R2 …"
  KEY=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN_MASTER" \
      "https://api.cloudflare.com/client/v4/accounts/$ACCT/r2/buckets/aon-backups/objects?prefix=db/&per_page=1000" \
    | python3 -c "import sys,json; r=json.load(sys.stdin)['result']; ks=sorted(o['key'] for o in r); print(ks[-1] if ks else '')")
  [ -n "$KEY" ] || { echo "No backups found in R2." >&2; exit 1; }
  echo "  newest: $KEY"
  BACKUP="$WORK/backup.age"
  curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN_MASTER" \
    "https://api.cloudflare.com/client/v4/accounts/$ACCT/r2/buckets/aon-backups/objects/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$KEY")" \
    -o "$BACKUP"
fi

echo "Decrypting …"
age -d -i "$KEY_FILE" -o "$WORK/backup.tar.gz" "$BACKUP"
tar xzf "$WORK/backup.tar.gz" -C "$WORK"
DUMP="$(find "$WORK" -maxdepth 1 -type d -name '20*' | head -1)"
[ -n "$DUMP" ] || { echo "No dated directory inside the archive." >&2; exit 1; }
echo "  manifest: $(python3 -c "import json;m=json.load(open('$DUMP/manifest.json'));print(m['total_rows'],'rows,',len(m['tables']),'tables,',m['migrations'],'migrations')")"

echo "Rebuilding the schema from the migration chain (disposable DB) …"
AON_BOOTSTRAP_CONFIRM=yes bash "$HERE/scripts/db-bootstrap.sh" --yes >/dev/null

psql_db() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

echo "Loading rows …"
# THE ROWS GO BACK THE WAY POSTGRES WANTS THEM, not the way JSON reads.
#
# The first version of this built INSERT statements by hand from the JSON and failed
# 18,024 of 18,833 times: `column "also_profiles" is of type uuid[] but expression is
# of type jsonb`. Arrays, geography and enums all need real coercion.
#
# So each line is loaded as a jsonb value and handed to jsonb_populate_record(null::t,
# j), which is Postgres casting into its OWN row type — arrays, geometry and every
# other type included. Generated columns (places.geom, photos.geom) are excluded,
# because inserting into one is an error; they recompute from lat/lng on the way in.
docker exec -i "$DB" rm -rf /tmp/aon-restore >/dev/null 2>&1 || true
docker cp "$DUMP" "$DB:/tmp/aon-restore" >/dev/null

python3 - "$DUMP" "$DB" <<'PYLOAD'
import json, pathlib, subprocess, sys
dump, db = pathlib.Path(sys.argv[1]), sys.argv[2]
manifest = json.loads((dump / 'manifest.json').read_text())

def psql_read(sql):
    out = subprocess.run(['docker','exec','-i',db,'psql','-U','postgres','-d','postgres','-tAc',sql],
                         capture_output=True, text=True)
    return [l for l in out.stdout.splitlines() if l.strip()]

stmts = []
for t in sorted(manifest['tables']):
    if not (dump / f'{t}.jsonl').exists() or manifest['tables'][t]['rows'] == 0:
        continue
    # GENERATED COLUMNS ARE EXCLUDED. places.geom and photos.geom are computed from
    # lat/lng; inserting into one is an error ("cannot insert a non-DEFAULT value").
    cols = psql_read(
        "select column_name from information_schema.columns "
        f"where table_schema='public' and table_name='{t}' and is_generated='NEVER' "
        "order by ordinal_position")
    if not cols:
        continue
    collist = ', '.join(f'"{c}"' for c in cols)
    sel = ', '.join(f'(rec)."{c}"' for c in cols)
    # \copy, not COPY: Supabase's `postgres` role is not a superuser, so server-side
    # COPY FROM a file is "permission denied". \copy streams through the client.
    stmts.append(
        f'create temp table _l (j jsonb);\n'
        f"\\copy _l (j) from '/tmp/aon-restore/{t}.jsonl' with (format csv, quote E'\\x01', delimiter E'\\x02')\n"
        f'insert into public."{t}" ({collist}) '
        f'select {sel} from (select jsonb_populate_record(null::public."{t}", j) as rec from _l) s '
        f'on conflict do nothing;\n'
        f'drop table _l;\n'
    )

script = "set session_replication_role = replica;\n" + "\n".join(stmts)
p = subprocess.run(['docker','exec','-i',db,'psql','-U','postgres','-d','postgres','-q'],
                   input=script, text=True, capture_output=True)
errs = [l for l in p.stderr.splitlines() if l.startswith('ERROR') or 'error' in l.lower()[:6]]
print(f'  loaded {len(stmts)} table(s); errors: {len(errs)}')
for e in errs[:6]:
    print('   ', e[:170])
PYLOAD

echo "Verifying row counts against the manifest …"
python3 - "$DUMP" "$DB" <<'PY'
import json, pathlib, subprocess, sys
dump, db = pathlib.Path(sys.argv[1]), sys.argv[2]
manifest = json.loads((dump / 'manifest.json').read_text())
bad = []
for t, meta in sorted(manifest['tables'].items()):
    out = subprocess.run(['docker','exec','-i',db,'psql','-U','postgres','-d','postgres','-tAc',
                          f'select count(*) from public."{t}"'], capture_output=True, text=True)
    got = int((out.stdout or '0').strip() or 0)
    if got != meta['rows']:
        bad.append((t, meta['rows'], got))
if bad:
    print('  MISMATCHES:')
    for t, want, got in bad:
        print(f'    {t}: manifest {want}, restored {got}')
    sys.exit(1)
print(f'  ✅ all {len(manifest["tables"])} tables match the manifest exactly '
      f'({manifest["total_rows"]} rows)')
PY

echo "verify-restore: the backup restores, and the restored database matches the manifest."
