#!/usr/bin/env bash
# Synthetic export→restore→re-export round-trip proof (Prompt 5/10 acceptance). Seeds a
# deterministic fictional fixture into the LOCAL disposable db, exports it, restores it
# (truncate + reload), re-exports, and asserts the two manifests' per-table checksums
# are IDENTICAL — proving IDs, relationships, attribution, dates, counts, and bytes
# survive the round-trip. Disposable db only. CI-runnable after `supabase start`.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$(grep -E '^project_id' "$HERE/supabase/config.toml" | sed -E 's/.*"(.*)".*/\1/')"
DB="supabase_db_${PROJECT}"
psql_db() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "Seeding deterministic fixture ..."
psql_db >/dev/null <<'SQL'
set session_replication_role = replica;  -- fixture is self-consistent; skip triggers
insert into public.places (id,name,lat,lng,category,saved,first_visit,last_visit)
  values ('a1a1a1a1-0000-0000-0000-000000000001','RT Beach',10,20,'beach',true,'2026-06-01','2026-06-02')
  on conflict (id) do nothing;
insert into public.visits (id,place_id,start_date,end_date,manual)
  values ('b1b1b1b1-0000-0000-0000-000000000001','a1a1a1a1-0000-0000-0000-000000000001','2026-06-01','2026-06-02',true)
  on conflict (id) do nothing;
insert into public.activities (id,type,distance,lat,lng,place_id,start_date)
  values ('c1c1c1c1-0000-0000-0000-000000000001','Hike',1609.344,10,20,'a1a1a1a1-0000-0000-0000-000000000001','2026-06-01T10:00:00Z')
  on conflict (id) do nothing;
-- `trip_marked`, not `is_trip`. 0191 dropped the column, and this fixture kept setting
-- it — so this whole round trip has been failing since 0191 merged, unnoticed, because
-- CI was blocked on billing from 2026-08-15 and never ran it. The two facts are the
-- same fact: a gate nobody runs is a gate that is already broken.
update public.visits set trip_marked = true
  where id = 'b1b1b1b1-0000-0000-0000-000000000001';

-- WHO WAS THERE. Until 2026-08-15 this fixture had no participants at all, so a
-- round-trip that advertises "attribution survives" was not testing any: triggers are
-- off here (replica role), so the everyone-by-default trigger from 0188 never fired,
-- and visit_profiles/activity_profiles were empty in both exports. They matched because
-- they were both empty.
--
-- THOSE TWO ARE VIEWS NOW (0266). Participation lives in `memory_subjects` + `memory_people`,
-- and the fixture writes there — a fixture that writes a view is how this job started failing
-- with "cannot insert into view", which is also exactly the failure it was built to catch on
-- the real data. It is still the ONLY record of who was on a visit and who did an activity,
-- so it is still exactly what a restore must not lose.
insert into auth.users (id,email)
  values ('d1d1d1d1-0000-0000-0000-000000000001','rt@example.invalid')
  on conflict (id) do nothing;
insert into public.profiles (id,display_name,role)
  values ('d1d1d1d1-0000-0000-0000-000000000001','RT Person','owner')
  on conflict (id) do nothing;
-- Written directly rather than through the helpers: triggers are off under the replica role,
-- so `person_for_profile` would find no self-contact to use. This is the shape a restore has
-- to carry, so it is the shape the fixture builds.
insert into public.people (id,display_name,kind,owner_profile,linked_profile,created_by)
  values ('d2d2d2d2-0000-0000-0000-000000000001','RT Person','person',
          'd1d1d1d1-0000-0000-0000-000000000001','d1d1d1d1-0000-0000-0000-000000000001',
          'd1d1d1d1-0000-0000-0000-000000000001')
  on conflict (id) do nothing;
insert into public.memory_subjects (id,kind,owner_profile,visit_id)
  values ('d3d3d3d3-0000-0000-0000-000000000001','visit',
          'd1d1d1d1-0000-0000-0000-000000000001','b1b1b1b1-0000-0000-0000-000000000001')
  on conflict (id) do nothing;
insert into public.memory_subjects (id,kind,owner_profile,activity_id)
  values ('d3d3d3d3-0000-0000-0000-000000000002','outing',
          'd1d1d1d1-0000-0000-0000-000000000001','c1c1c1c1-0000-0000-0000-000000000001')
  on conflict (id) do nothing;
insert into public.memory_people (subject_id,person_id)
  values ('d3d3d3d3-0000-0000-0000-000000000001','d2d2d2d2-0000-0000-0000-000000000001'),
         ('d3d3d3d3-0000-0000-0000-000000000002','d2d2d2d2-0000-0000-0000-000000000001')
  on conflict do nothing;
insert into public.visit_evidence (visit_id,evidence_type,evidence_id,evidence_date)
  values ('b1b1b1b1-0000-0000-0000-000000000001','activity',
          'c1c1c1c1-0000-0000-0000-000000000001','2026-06-01')
  on conflict do nothing;
reset session_replication_role;
SQL

echo "Export A ..."; bash "$HERE/scripts/export-data.sh" "$TMP/a" 2026-01-01T00:00:00Z >/dev/null

# The round-trip is only meaningful if attribution is IN it. Two empty tables compare
# equal, which is how this passed for days without testing what it claimed to.
python3 - "$TMP/a/manifest.json" <<'PY'
import json, sys
tables = {t['name']: t['rows'] for t in json.load(open(sys.argv[1]))['tables']}
for t in ('memory_subjects', 'memory_people', 'visit_evidence'):
    if tables.get(t, 0) < 1:
        raise SystemExit(f'FAIL: the export has no {t} rows — attribution is not being tested')
print('  attribution present in the export: '
      + ', '.join(f'{t}={tables[t]}' for t in ('memory_subjects','memory_people','visit_evidence')))
PY
echo "Restore from A ..."; AON_RESTORE_CONFIRM=yes bash "$HERE/scripts/restore-data.sh" "$TMP/a" >/dev/null
echo "Export B ..."; bash "$HERE/scripts/export-data.sh" "$TMP/b" 2026-01-01T00:00:00Z >/dev/null

# Compare per-table checksums (ignore the timestamp, which we pinned identical anyway).
A="$(python3 -c "import json;print('\n'.join(f\"{t['name']} {t['rows']} {t['sha256']}\" for t in json.load(open('$TMP/a/manifest.json'))['tables']))")"
B="$(python3 -c "import json;print('\n'.join(f\"{t['name']} {t['rows']} {t['sha256']}\" for t in json.load(open('$TMP/b/manifest.json'))['tables']))")"
if [ "$A" = "$B" ]; then
  # sanity: the fixture rows are actually present (not an empty-vs-empty match)
  PLACES="$(python3 -c "import json;print(next(t['rows'] for t in json.load(open('$TMP/a/manifest.json'))['tables'] if t['name']=='places'))")"
  if [ "$PLACES" -lt 1 ]; then echo "FAIL: fixture not present (places=0)"; exit 1; fi
  echo "PASS: export→restore→re-export round-trip is byte-identical (places=$PLACES seeded)."
else
  echo "FAIL: manifests differ after round-trip:"; diff <(echo "$A") <(echo "$B") || true; exit 1
fi

# Clean the fixture so the disposable db is left as the tests expect.
psql_db >/dev/null <<'SQL'
set session_replication_role = replica;
delete from public.activities where id='c1c1c1c1-0000-0000-0000-000000000001';
delete from public.visits where id='b1b1b1b1-0000-0000-0000-000000000001';
delete from public.places where id='a1a1a1a1-0000-0000-0000-000000000001';
reset session_replication_role;
SQL
