// Record a migration that is ALREADY APPLIED but missing from production's ledger.
//
//   SUPABASE_ACCESS_TOKEN=... node scripts/record-migration.mjs 0193_your_own_miles --yes
//
// This is the companion to apply-migration.mjs and the dangerous one of the pair, so it
// does as little as possible and refuses as often as it can.
//
// WHEN IT IS THE RIGHT TOOL. The Management API's query endpoint APPLIES sql and RECORDS
// NOTHING. Eight migrations were lost that way in 2026-08, then 0193 and 0194 again. The
// schema is right and the ledger is lying, and the fix is a ledger row — NOT re-running
// the migration, which is a write against live data to solve a bookkeeping problem.
//
// WHY IT IS DANGEROUS. Recording a migration that was never applied makes it skip
// forever: every future run treats it as done, and the schema silently never gets it.
// That is strictly worse than the gap it fixes. So the caller must have PROVED the
// migration is physically present first — this script cannot prove it for you, and says
// so rather than pretending otherwise.
//
// It writes one row to supabase_migrations.schema_migrations. It touches no data, no
// table, no policy and no function. Reversible by deleting that row.
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const PROJECT_REF = 'aanfyhsjbtnqzphuoiem';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (see .env.local).');
  process.exit(1);
}

const args = process.argv.slice(2);
const assumeYes = args.includes('--yes');
const targets = args.filter((a) => !a.startsWith('--'));
if (!targets.length) {
  console.error('usage: record-migration.mjs <0193_your_own_miles> [more…] [--yes]');
  process.exit(1);
}

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Cloudflare in front of the Management API rejects an unrecognised UA (STATE.md §8).
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
    },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body);
}

const strip = (s) => (s ?? '').replace(/^\d+_/, '');
const ledger = await query('select version, name from supabase_migrations.schema_migrations');

const rows = [];
for (const t of targets) {
  const stem = basename(t).replace(/\.sql$/, '');
  const version = stem.split('_')[0];
  const file = resolve('supabase/migrations', `${stem}.sql`);

  if (!existsSync(file)) {
    console.error(`  ✘ ${stem}: no such migration file — refusing.`);
    process.exit(1);
  }
  if (ledger.some((r) => r.version === version || strip(r.name) === strip(stem))) {
    console.log(`  – ${stem}: already recorded, skipping.`);
    continue;
  }
  rows.push({ version, stem });
}

if (!rows.length) {
  console.log('Nothing to record.');
  process.exit(0);
}

console.log('Recording as ALREADY APPLIED (writes no schema, no data):');
for (const r of rows) console.log(`     version='${r.version}'  name='${r.stem}'`);
console.log('');
console.log('  You must have PROVED each is physically present in production. Recording an');
console.log('  unapplied migration makes it skip forever — worse than the gap it fixes.');

if (!assumeYes && process.stdin.isTTY) {
  process.stdout.write('  proceed? [y/N] ');
  const answer = await new Promise((r) => process.stdin.once('data', (d) => r(String(d).trim())));
  if (answer.toLowerCase() !== 'y') {
    console.log('Aborted. Nothing recorded.');
    process.exit(1);
  }
}

const values = rows.map((r) => `('${r.version}', '${r.stem}')`).join(', ');
await query(
  `insert into supabase_migrations.schema_migrations (version, name) values ${values} ` +
    `on conflict (version) do nothing;`,
);

const after = await query('select version, name from supabase_migrations.schema_migrations');
for (const r of rows) {
  const ok = after.some((x) => x.version === r.version);
  console.log(`  ${ok ? '✓' : '✘'} ${r.stem}`);
  if (!ok) process.exitCode = 1;
}
