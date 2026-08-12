// NIGHTLY DATABASE BACKUP — encrypted before it leaves this process.
//
//   SUPABASE_ACCESS_TOKEN=… AGE_RECIPIENT=age1… node scripts/backup-db.mjs
//
// WHY THIS EXISTS: on 2026-08-12 an audit found that **no backup of this database
// existed anywhere**. Supabase's own list was empty and PITR was off, so a bad
// migration, a dropped table or a lost account meant 132 places, 488 visits and
// every note and rating were simply gone. Erica's whole record of where she has
// been lives here.
//
// WHAT IT PRODUCES, per run:
//
//   db/<YYYY-MM-DD>/<table>.jsonl     one JSON object per row
//   db/<YYYY-MM-DD>/manifest.json     row counts + sha256 per table, schema version
//
// …tarred, then **encrypted with age before upload**. R2 only ever receives
// ciphertext, so a leaked R2 token exposes nothing. The private key is not on this
// machine's PATH and is never in the repo.
//
// WHAT IS DELIBERATELY EXCLUDED: ingest_tokens, strava_accounts, google_tokens and
// oauth_states. Those are credentials, not data — restoring them would restore
// someone's ability to act as her. They are re-created by signing in again, which
// is written up in STATE.md under recovery.
//
// The photo and video ROWS are included, but they carry only R2 object keys — the
// bytes live in R2 and are backed up separately by scripts/backup-r2.mjs. A restore
// needs both halves.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_REF = "aanfyhsjbtnqzphuoiem";
const token = process.env.SUPABASE_ACCESS_TOKEN;
const recipient = process.env.AGE_RECIPIENT;
if (!token) die("Missing SUPABASE_ACCESS_TOKEN.");
if (!recipient)
  die("Missing AGE_RECIPIENT (the age public key — see STATE.md).");

function die(msg) {
  console.error(`backup-db: ${msg}`);
  process.exit(1);
}

// Credentials, not data. Restoring these would restore the ability to act as her.
// spatial_ref_sys is PostGIS's own EPSG reference table (8,500 rows) — `create
// extension postgis` recreates it, so backing it up nightly is pure noise.
const EXCLUDE = new Set([
  "ingest_tokens",
  "strava_accounts",
  "google_tokens",
  "oauth_states",
  "spatial_ref_sys",
]);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

async function query(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": UA, // Cloudflare 1010s an unrecognised agent (STATE.md §8)
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!res.ok)
    throw new Error(
      `Management API ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  return res.json();
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const day = new Date().toISOString().slice(0, 10);
const stamp = new Date().toISOString();
const work = resolve(root, `.backup-work/${day}`);
rmSync(resolve(root, ".backup-work"), { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const tables = (
  await query(`select tablename from pg_tables
               where schemaname = 'public' order by tablename`)
).map((r) => r.tablename);

const manifest = {
  exported_at: stamp,
  project: PROJECT_REF,
  tables: {},
  excluded: [...EXCLUDE],
};
let grandTotal = 0;

for (const t of tables) {
  if (EXCLUDE.has(t)) continue;
  // json_agg would build one huge value server-side; row_to_json per row streams and
  // keeps each line independently parseable if the file is ever truncated.
  const rows = await query(`select row_to_json(x) as r from public.${t} x`);
  const body =
    rows.map((r) => JSON.stringify(r.r)).join("\n") + (rows.length ? "\n" : "");
  writeFileSync(resolve(work, `${t}.jsonl`), body);
  manifest.tables[t] = {
    rows: rows.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
  grandTotal += rows.length;
  process.stdout.write(`  ${t}: ${rows.length}\n`);
}

// The migration ledger travels WITH the data. A restore that rebuilds the schema from
// migrations must know exactly which ones this dump corresponds to — the 2026-08-11
// audit found eight applied-but-unrecorded migrations, which would have made a
// restored database silently different from production.
const ledger = await query(
  "select version, name from supabase_migrations.schema_migrations order by version",
);
writeFileSync(
  resolve(work, "_migrations.jsonl"),
  ledger.map((r) => JSON.stringify(r)).join("\n"),
);
manifest.migrations = ledger.length;
manifest.total_rows = grandTotal;

writeFileSync(
  resolve(work, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);

// tar → age. The plaintext tar never leaves this directory, and the directory is
// removed below.
const tar = resolve(root, `.backup-work/aon-db-${day}.tar.gz`);
execFileSync("tar", ["-czf", tar, "-C", resolve(root, ".backup-work"), day]);
const enc = `${tar}.age`;
execFileSync("age", ["-r", recipient, "-o", enc, tar]);
rmSync(tar);
rmSync(work, { recursive: true, force: true });

const bytes = readFileSync(enc).length;
console.log(
  `\nbackup-db: ${grandTotal} rows across ${Object.keys(manifest.tables).length} tables, ` +
    `${ledger.length} migrations → ${enc} (${(bytes / 1e6).toFixed(2)} MB, encrypted)`,
);
console.log(`BACKUP_FILE=${enc}`);
console.log(`BACKUP_KEY=db/${day}/aon-db-${day}.tar.gz.age`);
