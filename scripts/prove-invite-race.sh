#!/usr/bin/env bash
# Two people, one single-use invite code, at the same moment. Only one gets in.
#
# WHY THIS IS NOT IN supabase/tests/. Every file there is ONE `begin … rollback`
# transaction on ONE connection, which is exactly the thing a race cannot happen
# inside. `0288_one_code_lets_in_one_person.test.sql` proves everything a single
# session can prove — including that the conditional `update … where redeemed_at is
# null` matches nothing once a code is spent — but the row lock that serialises two
# LIVE sessions needs two live sessions. This script opens them.
#
# The interleaving is FORCED rather than hoped for, so this either proves the claim or
# fails; it never passes by getting lucky with timing:
#
#   A: begin; redeem(code);            -- takes the row lock, holds it
#   B: begin; redeem(code);            -- BLOCKS on `for update` (asserted, not assumed)
#   A: commit;                         -- B wakes, re-reads under READ COMMITTED
#   B: ERROR "already been used"       -- and rolls back with no account
#
# Then it checks the only thing that actually matters afterwards: exactly one profile
# exists for the two contenders, and the code names that one person.
#
#   bash scripts/prove-invite-race.sh
#
# Prereq: a local stack (`supabase start`) with the migration chain applied
# (`scripts/db-bootstrap.sh` or `scripts/db-test.sh`). It writes and then deletes its
# own fixtures; it is for the DISPOSABLE local database and nothing else.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$(grep -E '^project_id' "$HERE/supabase/config.toml" | sed -E 's/.*"(.*)".*/\1/')"
DB="supabase_db_${PROJECT}"

docker inspect "$DB" >/dev/null 2>&1 || {
  echo "Local db container '$DB' not found. Run 'supabase start' first." >&2
  exit 1
}

psql_db() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_soft() { docker exec -i "$DB" psql -U postgres -d postgres -q "$@"; }

ISSUER=aaaa0288-face-0000-0000-000000000001
RACER_A=aaaa0288-face-0000-0000-00000000000a
RACER_B=aaaa0288-face-0000-0000-00000000000b

cleanup() {
  psql_soft >/dev/null 2>&1 <<SQL || true
delete from public.invite_codes where issued_by = '$ISSUER';
delete from public.profiles where id in ('$ISSUER','$RACER_A','$RACER_B');
delete from auth.users where id in ('$ISSUER','$RACER_A','$RACER_B');
SQL
}
trap cleanup EXIT
cleanup

echo "Setting up: one member, one single-use code, two people holding it."
CODE="$(psql_db -tA <<SQL
begin;
-- Empty-string tokens, not NULL. See the note in export-restore-roundtrip.sh: a NULL in
-- any of the GoTrue token columns makes the admin API return 500 for the life of the
-- stack. No apostrophes in this comment on purpose — it sits in a heredoc inside a
-- command substitution, where a stray quote breaks the shell parse.
insert into auth.users (id, email, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, reauthentication_token) values
  ('$ISSUER','race.issuer@example.invalid','','','','','',''),
  ('$RACER_A','race.a@example.invalid','','','','','',''),
  ('$RACER_B','race.b@example.invalid','','','','','','');
insert into public.profiles (id, role, display_name) values ('$ISSUER','editor','RaceIssuer');
set local request.jwt.claims = '{"sub":"$ISSUER","role":"authenticated"}';
select (public.create_invite_code('Race', 14, 'viewer')).code;
commit;
SQL
)"
echo "  code: $CODE"

claims() { printf '{"sub":"%s","role":"authenticated","email":"race.%s@example.invalid"}' "$1" "$2"; }

A_OUT=$(mktemp); B_OUT=$(mktemp)
trap 'rm -f "$A_OUT" "$B_OUT"; cleanup' EXIT

# A: redeem, then SIT ON THE LOCK for 4 seconds before committing.
(
  psql_soft <<SQL >"$A_OUT" 2>&1
begin;
set local role authenticated;
set local request.jwt.claims = '$(claims "$RACER_A" a)';
select 'A redeemed as ' || (public.redeem_invite_code('$CODE')).id;
select pg_sleep(4);
commit;
SQL
) &
A_PID=$!

sleep 1  # A is inside its transaction, holding the row lock.

# B: the same code, while A still holds it. This BLOCKS.
(
  psql_soft <<SQL >"$B_OUT" 2>&1
begin;
set local role authenticated;
set local request.jwt.claims = '$(claims "$RACER_B" b)';
select 'B redeemed as ' || (public.redeem_invite_code('$CODE')).id;
commit;
SQL
) &
B_PID=$!

sleep 2  # B has been waiting for a second by now — prove it is BLOCKED, not finished.
BLOCKED="$(psql_db -tA -c "
  select count(*) from pg_stat_activity
   where wait_event_type = 'Lock' and query like '%redeem_invite_code%';" | tr -d ' ')"
if [ "$BLOCKED" -lt 1 ]; then
  echo "INCONCLUSIVE: the second redemption never blocked on the row lock." >&2
  wait "$A_PID" "$B_PID" || true
  cat "$A_OUT" "$B_OUT" >&2
  exit 1
fi
echo "  the second redemption is BLOCKED on the row lock (as designed)"

wait "$A_PID" || true
wait "$B_PID" || true

echo
echo "--- session A ---"; sed 's/^/  /' "$A_OUT"
echo "--- session B ---"; sed 's/^/  /' "$B_OUT"
echo

FAIL=0
grep -q "A redeemed as $RACER_A" "$A_OUT" || { echo "FAILED: A did not get in." >&2; FAIL=1; }
grep -qi "already been used" "$B_OUT" || {
  echo "FAILED: B was not told the code had already been used." >&2; FAIL=1; }
grep -q "B redeemed as" "$B_OUT" && {
  echo "FAILED: B ALSO GOT IN — the code was not single-use." >&2; FAIL=1; }

# The only thing that matters afterwards: one account, and the code names whose.
WINNERS="$(psql_db -tA -c "
  select count(*) from public.profiles where id in ('$RACER_A','$RACER_B');" | tr -d ' ')"
NAMED="$(psql_db -tA -c "
  select coalesce(redeemed_by::text,'<none>') from public.invite_codes where code = '$CODE';" | tr -d ' ')"

if [ "$WINNERS" != "1" ]; then
  echo "FAILED: $WINNERS of the two contenders have an account; exactly 1 may." >&2; FAIL=1
fi
if [ "$NAMED" != "$RACER_A" ]; then
  echo "FAILED: the code says it let in '$NAMED', not the session that won." >&2; FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo "RACE PROOF FAILED." >&2
  exit 1
fi
echo "PASS: two concurrent redemptions of one single-use code — one account, and the"
echo "      code records which person it let in."
