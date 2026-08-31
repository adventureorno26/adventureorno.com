#!/usr/bin/env bash
# Run every supabase/tests/*.test.sql against a DISPOSABLE local Supabase stack and
# fail on the first error. Used by CI (item 13 of the ADR 0001 corrective pass) and
# runnable locally after `supabase start`.
#
# Each test file is a self-contained `begin … rollback` transaction that raises an
# exception on failure and `raise notice 'PASS…'` on success. We run under
# ON_ERROR_STOP=1, so any raised exception (a FAIL, a broken grant, an RLS leak)
# makes psql exit non-zero and this script aborts with that test named.
#
# Prereq: a running local stack (`supabase start`). This script first rebuilds the
# schema via scripts/db-bootstrap.sh (strict, network-isolated) so the tests run
# against the full migration chain with production-faithful grants.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
TESTS="$HERE/supabase/tests"
PROJECT="$(grep -E '^project_id' "$HERE/supabase/config.toml" | sed -E 's/.*"(.*)".*/\1/')"
DB="supabase_db_${PROJECT}"

docker inspect "$DB" >/dev/null 2>&1 || {
  echo "Local db container '$DB' not found. Run 'supabase start' first." >&2
  exit 1
}

# Apply the full migration chain + Supabase grants (strict; aborts on any unexpected
# error). Confirmation is implicit here — CI/test intent is unambiguous.
AON_BOOTSTRAP_CONFIRM=yes bash "$HERE/scripts/db-bootstrap.sh" --yes

psql_db() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

shopt -s nullglob
FILES=("$TESTS"/*.test.sql)
if [ ${#FILES[@]} -eq 0 ]; then
  echo "No test files found in $TESTS." >&2
  exit 1
fi

echo "Running ${#FILES[@]} SQL test file(s) ..."
FAIL=0
for f in "${FILES[@]}"; do
  name="$(basename "$f")"
  # The prelude defines test_support.* helpers in the disposable stack. Prepended rather
  # than run as its own file so a test can call a helper inside its own transaction; it is
  # not in the *.test.sql glob, so it is never mistaken for a test.
  if OUT="$(cat "$TESTS/_prelude.sql" "$f" | psql_db 2>&1)"; then
    # Surface the PASS notice; treat a missing PASS as a silent-failure guard.
    if echo "$OUT" | grep -q 'PASS'; then
      echo "  ok    $name — $(echo "$OUT" | grep 'PASS' | head -1 | sed 's/^psql:.*NOTICE:  //')"
    else
      echo "  WARN  $name — completed with no PASS notice"; echo "$OUT" | tail -3
    fi
  else
    echo "  FAIL  $name"
    echo "$OUT" | grep -E 'ERROR|FAIL|NOTICE' | tail -8 | sed 's/^/        /'
    FAIL=1
  fi
done

if [ "$FAIL" -ne 0 ]; then
  echo "DB tests FAILED." >&2
  exit 1
fi
echo "All SQL tests passed."

# SECDEF lockdown regression guard (0093/0105): no public SECURITY DEFINER function
# may be anon-executable — new SECDEF functions default-grant EXECUTE to PUBLIC, which
# silently reopens what the lockdown closed (this happened in 0101). st_estimatedextent
# is PostGIS/supabase_admin-owned and its anon grant is not revocable from the migration
# role — the one accepted residual.
ANON_SECDEF=$(psql_db -tA -c "
  select coalesce(string_agg(p.proname, ', '), '')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not like 'st\\_%';" | tr -d ' ')
if [ -n "$ANON_SECDEF" ]; then
  echo "FAILED: anon-executable SECURITY DEFINER function(s) — lockdown regression: $ANON_SECDEF" >&2
  echo "Run scripts/lockdown.sql after the offending migration (and revoke anon in it)." >&2
  exit 1
fi
echo "Lockdown OK: no anon-executable SECDEF functions (PostGIS st_* excepted)."
