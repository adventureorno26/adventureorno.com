// A MIGRATION MAY NOT SAY "DRAFT — NOT APPLIED" WHILE PRODUCTION HAS APPLIED IT.
//
//   SUPABASE_ACCESS_TOKEN=... node scripts/check-draft-migrations.mjs
//
// WHY THIS EXISTS. On 2026-08-30 `0289_a_space_is_the_boundary_and_it_says_so.sql` and
// `0290_the_readers_say_which_space_they_are_reading.sql` both carried this header:
//
//   -- DRAFT — REHEARSED, NOT APPLIED. Nothing in this file has been run against
//   -- production outside a transaction that was rolled back.
//
// Both were recorded in production's ledger, and the live schema carried `spaces`,
// `space_memberships` and a `space_id` on ~70 tables. The sentence was false, and it was
// the FIRST thing anyone opening those files would read. `docs/STATE.md` believed it too
// and went on calling the partition "queued" — so the one indivisible migration that gates
// every social feature was live, and the single source of truth said it had not started.
//
// This is the same class of defect as an unrecorded migration (`check-migration-ledger`),
// from the other direction: there the ledger lied about the schema, here the FILE lies
// about the ledger. Neither is caught by tests, because both are prose.
//
// A WARNING BY DEFAULT, like its sibling: a branch may legitimately hold a real draft that
// production has not seen. It fails hard with STRICT=1, which is what CI should use, and
// the failing direction is only ever "the file says draft, production says applied" —
// never the reverse, which is the normal state of unmerged work.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { fetchWithRetry } from './lib/retry.mjs';

const PROJECT_REF = 'aanfyhsjbtnqzphuoiem';
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '..', 'supabase', 'migrations');
const STRICT = process.env.STRICT === '1';

/** The header is where the claim has to be true — the first 40 lines of the file. */
function headerOf(sql) {
  return sql.split('\n').slice(0, 40).join('\n');
}

/** Does this file's header assert it has not been applied?
 *
 *  A POSITIVE ASSERTION WINS OVER A QUOTED ONE, and that is not a loophole — it is what
 *  makes the check compatible with the house rule that a corrected line records what it
 *  used to say. The first version of this function fired on its own fix: correcting 0290
 *  to "APPLIED TO PRODUCTION" while quoting the old "Nothing in this file has been run
 *  against production" left the old sentence in the header, and the check read the quote
 *  as a live claim. A guard that punishes writing down the history would just teach the
 *  next person to delete it.
 *
 *  So the rule is: if the header states plainly that it IS applied, that is the file's
 *  claim and any draft wording above or below it is history. If it does not, any
 *  not-applied wording is taken at face value. */
export function claimsUnapplied(sql) {
  const head = headerOf(sql);
  if (/^--.*\bAPPLIED TO PRODUCTION\b/im.test(head)) return false;
  if (/Nothing in this file has been run against production/i.test(head)) return true;
  if (/DO NOT APPLY/i.test(head)) return true;
  if (/DRAFT\s*[—-]\s*(REHEARSED,\s*)?NOT APPLIED/i.test(head)) return true;
  return false;
}

/** `0289_a_space….sql` → `0289` */
export function versionOf(filename) {
  const m = /^(\d+)/.exec(filename);
  return m ? m[1] : null;
}

/** The version a file's FIRST LINE claims to be, e.g. `-- 0287 — a space is…` → `0287`.
 *
 *  A file that calls itself by another number is the same class of lie as one that says
 *  it never ran: `0289_a_space_is_the_boundary_and_it_says_so.sql` opens
 *  `-- 0287 — a space is the boundary`, a leftover from being rebased out of the 0281
 *  slot, so every reference to "0287" in its own body points at a DIFFERENT applied
 *  migration (`0287_a_public_profile_that_was_never_once_read.sql`). */
export function headerVersion(sql) {
  const first = sql.split('\n', 1)[0];
  const m = /^--\s*(\d{3,4})\b/.exec(first);
  return m ? m[1] : null;
}

async function appliedVersions(token) {
  const res = await fetchWithRetry(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'select version from supabase_migrations.schema_migrations order by version',
      }),
    },
  );
  if (!res.ok) throw new Error(`Could not read the ledger (${res.status}): ${await res.text()}`);
  const rows = await res.json();
  return new Set(rows.map((r) => String(r.version)));
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error('Missing SUPABASE_ACCESS_TOKEN (see .env.local).');
    process.exit(STRICT ? 1 : 0);
  }

  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
  const applied = await appliedVersions(token);

  const lying = [];
  const misnumbered = [];
  for (const f of files) {
    const version = versionOf(f);
    if (!version) continue;
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    // Production's ledger records it. The file says it never ran.
    if (claimsUnapplied(sql) && applied.has(version)) lying.push(f);
    // The file calls itself by a number that is not its own.
    const claimed = headerVersion(sql);
    if (claimed && claimed !== version) misnumbered.push(`${f} — its header says ${claimed}`);
  }

  if (lying.length === 0 && misnumbered.length === 0) {
    console.log(
      `Draft-header check passed: ${files.length} migration(s), none claims to be unapplied ` +
        `while production has it, and none calls itself by another number.`,
    );
    return;
  }

  console.error('');
  if (lying.length > 0) {
    console.error('A MIGRATION CLAIMS IT WAS NEVER APPLIED, AND PRODUCTION HAS APPLIED IT:');
    console.error('');
    for (const f of lying) console.error(`  ${f}`);
    console.error('');
    console.error('The header is the first thing the next person reads, and it is false.');
    console.error('Correct the header to say it is applied, and the date, then re-run.');
    console.error('');
  }
  if (misnumbered.length > 0) {
    console.error('A MIGRATION CALLS ITSELF BY A NUMBER THAT IS NOT ITS OWN:');
    console.error('');
    for (const f of misnumbered) console.error(`  ${f}`);
    console.error('');
    console.error('Every "see 0NNN" inside it then points at a different applied migration.');
    console.error('');
  }
  process.exit(STRICT ? 1 : 0);
}

// Only run when invoked directly, so the pure helpers above can be unit-tested.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(STRICT ? 1 : 0);
  });
}
