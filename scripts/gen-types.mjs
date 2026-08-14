// Regenerate app/src/lib/database.types.ts from the LIVE Supabase schema.
//
//   SUPABASE_ACCESS_TOKEN=... node scripts/gen-types.mjs
//
// Deterministic: CI runs the exact same script and `git diff --exit-code`s the
// output, so a schema change that isn't reflected in the committed types fails
// CI (catches migration↔frontend drift). Keep this the ONLY writer of that file.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchWithRetry } from './lib/retry.mjs';

const PROJECT_REF = 'aanfyhsjbtnqzphuoiem';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Missing SUPABASE_ACCESS_TOKEN. Set it in your shell (see .env.local).');
  process.exit(1);
}

const HEADER = [
  '// GENERATED FILE — do not edit by hand.',
  '// Regenerate with: npm run gen:types',
  '// Source of truth: the live Supabase schema (supabase/migrations).',
  '',
  '',
].join('\n');

// Retried: this failed CI once with a Management API 555 "Internal server error",
// which had nothing to do with the schema and went green on a re-run.
let res;
try {
  res = await fetchWithRetry(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/types/typescript`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        // Management API sits behind a WAF that blocks non-browser agents.
        'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36',
      },
    },
    { label: 'type generation' },
  );
} catch (err) {
  console.error(`Type generation failed: ${err.message}`);
  process.exit(1);
}
const { types } = await res.json();

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'src', 'lib', 'database.types.ts');
writeFileSync(out, HEADER + types);
console.log(`Wrote ${out}`);
