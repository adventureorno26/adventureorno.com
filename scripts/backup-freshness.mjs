// IS THERE A FRESH BACKUP? Fails loudly if not.
//
//   CLOUDFLARE_API_TOKEN_MASTER=… node scripts/backup-freshness.mjs
//
// A failing backup job is easy to notice — GitHub emails about it. The dangerous
// failure is SILENCE: the schedule stops (a disabled workflow, an expired token, a
// renamed bucket) and nothing goes red because nothing runs. Six weeks later the
// newest backup is six weeks old and nobody knew.
//
// So this asserts the only thing that actually matters: a recent artifact EXISTS,
// with a plausible size. It runs after the backup jobs and also stands alone —
// `npm run backup:check` answers "am I covered?" without reading any logs.
const acct = "9bed5239120cee4e9e7d46fa69ef4784";
const token =
  process.env.CLOUDFLARE_API_TOKEN_MASTER || process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error("backup-freshness: missing CLOUDFLARE_API_TOKEN_MASTER");
  process.exit(1);
}

const MAX_AGE_HOURS = Number(process.env.MAX_AGE_HOURS ?? 36); // nightly + slack
const MIN_BYTES = Number(process.env.MIN_BYTES ?? 100_000); // a truncated dump is a failure

async function list(prefix) {
  const out = [];
  let cursor = "";
  for (;;) {
    const u = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${acct}/r2/buckets/aon-backups/objects`,
    );
    u.searchParams.set("per_page", "1000");
    u.searchParams.set("prefix", prefix);
    if (cursor) u.searchParams.set("cursor", cursor);
    const res = await fetch(u, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`list ${prefix}: ${res.status}`);
    const b = await res.json();
    out.push(...(b.result ?? []));
    cursor = b.result_info?.cursor ?? "";
    if (!cursor) break;
  }
  return out;
}

const problems = [];

const db = (await list("db/")).sort((a, b) => (a.key < b.key ? 1 : -1));
if (db.length === 0) {
  problems.push("NO database backup exists in R2 at all.");
} else {
  const newest = db[0];
  const day = (newest.key.match(/db\/(\d{4}-\d{2}-\d{2})\//) || [])[1];
  const ageH = (Date.now() - new Date(`${day}T00:00:00Z`).getTime()) / 3.6e6;
  const size = Number(newest.size ?? 0);
  console.log(
    `newest database backup: ${newest.key} (${(size / 1e6).toFixed(2)} MB, ${ageH.toFixed(0)}h old)`,
  );
  console.log(`generations retained: ${db.length}`);
  if (ageH > MAX_AGE_HOURS)
    problems.push(
      `newest backup is ${ageH.toFixed(0)}h old (max ${MAX_AGE_HOURS}h).`,
    );
  if (size < MIN_BYTES)
    problems.push(`newest backup is only ${size} bytes — suspiciously small.`);
  if (!newest.key.endsWith(".age"))
    problems.push("newest backup is NOT age-encrypted.");
}

const objs = await list("objects/");
console.log(`photo/video objects mirrored: ${objs.length}`);
if (objs.length === 0)
  problems.push(
    "NO photo/video objects are backed up — the dump is only a manifest.",
  );

if (problems.length) {
  console.error("\nBACKUP FRESHNESS FAILED:");
  for (const p of problems) console.error(`  ✘ ${p}`);
  process.exit(1);
}
console.log("\nbackup-freshness: covered.");
