// Does production's migration ledger know about every migration in this repo?
//
//   SUPABASE_ACCESS_TOKEN=... node scripts/check-migration-ledger.mjs
//
// WHY THIS EXISTS. On 2026-08-11 an audit found EIGHT migrations that were applied
// to production but absent from `supabase_migrations.schema_migrations`. They had
// been executed through the Management API's query endpoint, which runs SQL and
// records nothing. The schema was right and the ledger was lying.
//
// That matters in exactly the moment you cannot afford it:
//
//   * a restore rebuilds from the ledger, so an unrecorded migration is silently
//     missing from the restored database;
//   * `supabase db push` re-runs anything unrecorded, and a migration that is not
//     idempotent then fails or double-applies;
//   * "what is deployed?" has no trustworthy answer.
//
// It is a WARNING, not a hard failure, for one honest reason: this compares a
// hosted database against the working tree, so a branch that legitimately ADDS a
// migration is "ahead" until it merges and deploys. Failing on that would block
// every database PR. It prints loudly and exits 0 unless STRICT=1.
//
// Related: `db-types-drift` catches schema-vs-types drift; this catches
// schema-vs-LEDGER drift, which nothing else looked at.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PROJECT_REF = 'aanfyhsjbtnqzphuoiem';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (see .env.local).');
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(resolve(root, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();

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
  if (!res.ok) throw new Error(`Management API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// The ledger's `version` is a timestamp and its `name` is free-form — some rows
// carry the 0NNN prefix and some do not — so match on the descriptive part only.
const strip = (s) => (s ?? '').replace(/^\d+_/, '');

const recorded = new Set(
  (await query('select name from supabase_migrations.schema_migrations')).map((r) => strip(r.name)),
);

const missing = files.filter((f) => !recorded.has(strip(f.replace(/\.sql$/, ''))));

if (missing.length === 0) {
  console.log(`Migration ledger OK: all ${files.length} migrations are recorded in production.`);
  process.exit(0);
}

console.log('');
console.log(`⚠️  ${missing.length} migration(s) are NOT in production's ledger:`);
for (const m of missing) console.log(`      ${m}`);
console.log('');
console.log('  If they are UNAPPLIED, apply them.');
console.log('  If they are applied but unrecorded (the Management API does that), record them:');
console.log('      insert into supabase_migrations.schema_migrations (version, name)');
console.log("      values ('<YYYYMMDDHHMMSS>', '<file stem>');");
console.log('  VERIFY each is genuinely present first — recording an unapplied migration');
console.log('  makes it skip forever, which is worse than the gap.');
console.log('');

process.exit(process.env.STRICT === '1' ? 1 : 0);
