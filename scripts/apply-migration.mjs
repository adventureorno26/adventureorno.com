// Apply ONE migration to production and record it in the ledger, atomically.
//
//   SUPABASE_ACCESS_TOKEN=... node scripts/apply-migration.mjs 0195_the_thing
//   ... node scripts/apply-migration.mjs supabase/migrations/0195_the_thing.sql --yes
//
// WHY THIS EXISTS, AND WHY IT IS NOT `supabase db push`.
//
// Two things have to be true at once, and until now nothing did both:
//
//   * the Management API's query endpoint APPLIES sql but RECORDS NOTHING, which is
//     how eight migrations — and later 0193 and 0194 — ended up applied but absent
//     from `supabase_migrations.schema_migrations`;
//   * `supabase db push` records what it applies, but DECIDES what to apply by
//     comparing version keys. This repo's ledger is keyed two ways (152 rows as
//     `0NNN`, 75 as a 14-digit timestamp), so `--include-all` reads 42 already-applied
//     migrations as pending and re-runs them against live data. Several of those
//     backfill. Re-deriving a value a person has since corrected by hand is the exact
//     failure this repository keeps having.
//
// So: apply exactly the file you name, and write the ledger row in the SAME
// transaction. Either both happen or neither, which means the ledger cannot drift
// away from the schema again — recording is part of applying, not a follow-up someone
// forgets. Nothing is inferred, nothing is batched, and no database password exists.
//
// TRANSACTIONS. The Management API runs a multi-statement body through the simple
// query protocol, which Postgres wraps in one implicit transaction. 49 of the
// migrations also open their own `begin; ... commit;`, and an inner `commit;` would
// close that implicit transaction early and leave the ledger insert outside it. So a
// self-wrapping file has its outer `begin`/`commit` stripped and is re-wrapped by us.
import { readFileSync, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const PROJECT_REF = 'aanfyhsjbtnqzphuoiem';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (see .env.local).');
  process.exit(1);
}

const args = process.argv.slice(2);
const assumeYes = args.includes('--yes');
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('usage: apply-migration.mjs <0195_the_thing | path/to/0195_the_thing.sql> [--yes]');
  process.exit(1);
}

const path = existsSync(target)
  ? resolve(target)
  : resolve('supabase/migrations', target.endsWith('.sql') ? target : `${target}.sql`);
if (!existsSync(path)) {
  console.error(`No such migration: ${path}`);
  process.exit(1);
}

const stem = basename(path).replace(/\.sql$/, '');
const version = stem.split('_')[0];
if (!/^\d+$/.test(version)) {
  console.error(`Cannot derive a version key from "${stem}" — expected a leading number.`);
  process.exit(1);
}

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Cloudflare in front of the Management API rejects an unrecognised
      // User-Agent with 1010; see docs/STATE.md §8.
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
    },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${body.slice(0, 600)}`);
  return JSON.parse(body);
}

// ---------------------------------------------------------------------------
// Refuse to apply something production already has.
// ---------------------------------------------------------------------------
const strip = (s) => (s ?? '').replace(/^\d+_/, '');
const ledger = await query('select version, name from supabase_migrations.schema_migrations');
const byVersion = ledger.some((r) => r.version === version);
const byName = ledger.some((r) => strip(r.name) === strip(stem));

if (byVersion || byName) {
  console.error(`${stem} is ALREADY in production's ledger (${byVersion ? 'version' : 'name'}).`);
  console.error('Nothing applied. A migration is never edited after it has been applied —');
  console.error('write the next numbered one instead.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Strip a self-wrapping begin/commit so our transaction is the only one.
// Only the FIRST and LAST non-comment statements are considered, so a `commit`
// inside a function body is left alone.
// ---------------------------------------------------------------------------
let sql = readFileSync(path, 'utf8');
const meaningful = sql
  .split('\n')
  .filter((l) => !/^\s*--/.test(l) && l.trim() !== '');
const opensOwn = /^\s*begin\s*;\s*$/i.test(meaningful[0] ?? '');
const closesOwn = /^\s*commit\s*;\s*$/i.test(meaningful.at(-1) ?? '');

if (opensOwn && closesOwn) {
  sql = sql.replace(/^(\s*(?:--[^\n]*\n|\s*\n)*)\s*begin\s*;/i, '$1');
  sql = sql.replace(/commit\s*;\s*$/i, '');
} else if (opensOwn !== closesOwn) {
  console.error(`${stem} opens or closes a transaction but not both — apply it by hand.`);
  process.exit(1);
}

const payload = [
  'begin;',
  sql.trim(),
  '',
  '-- Recorded in the same transaction as the change it describes, so the ledger',
  '-- cannot drift away from the schema (scripts/apply-migration.mjs).',
  `insert into supabase_migrations.schema_migrations (version, name)`,
  `values ('${version}', '${stem}');`,
  'commit;',
].join('\n');

console.log(`Applying ${stem} to ${PROJECT_REF}`);
console.log(`  self-wrapped: ${opensOwn ? 'yes (unwrapped and re-wrapped)' : 'no'}`);
console.log(`  ledger row:   version='${version}', name='${stem}'`);

if (!assumeYes && process.stdin.isTTY) {
  process.stdout.write('  proceed? [y/N] ');
  const answer = await new Promise((r) => process.stdin.once('data', (d) => r(String(d).trim())));
  if (answer.toLowerCase() !== 'y') {
    console.log('Aborted. Nothing applied.');
    process.exit(1);
  }
}

await query(payload);

// ---------------------------------------------------------------------------
// Prove it, rather than trusting the absence of an error.
// ---------------------------------------------------------------------------
const after = await query(
  `select version, name from supabase_migrations.schema_migrations where version = '${version}'`,
);
if (after.length !== 1) {
  console.error('APPLIED BUT NOT RECORDED — the ledger has no row for it. Investigate before');
  console.error('deploying: check:ledger will now block, which is the correct outcome.');
  process.exit(1);
}
console.log(`Applied and recorded: ${after[0].version} ${after[0].name}`);
