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

  // AGE COMES FROM THE OBJECT, NOT THE FOLDER NAME. This used to read the date out of
  // the `db/YYYY-MM-DD/` prefix and measure from MIDNIGHT of that day, so the nightly
  // 07:17 UTC backup reported as "27h old" at 02:33 the next morning when it was 13
  // hours old. It only ever overstated, so it never hid a gap — but a number that can
  // be a day out is a number nobody trusts, and this is the check that answers "am I
  // covered?". R2 returns `last_modified`; the folder date is the fallback.
  const day = (newest.key.match(/db\/(\d{4}-\d{2}-\d{2})\//) || [])[1];
  const stamp = newest.last_modified ?? (day ? `${day}T00:00:00Z` : null);
  const ageH = stamp ? (Date.now() - new Date(stamp).getTime()) / 3.6e6 : NaN;
  const size = Number(newest.size ?? 0);
  console.log(
    `newest database backup: ${newest.key} (${(size / 1e6).toFixed(2)} MB, ${
      Number.isFinite(ageH) ? `${ageH.toFixed(1)}h old` : "age UNKNOWN"
    })`,
  );
  console.log(`generations retained: ${db.length}`);

  // AN AGE THAT CANNOT BE READ IS A FAILURE, NOT A PASS. The old code did
  // `new Date(`${undefined}T00:00:00Z`)` whenever a key did not match the expected
  // shape, got NaN, and `NaN > MAX_AGE_HOURS` is false — so a bucket full of
  // unparseable keys reported "covered". That is precisely the silence this file
  // opens by saying it exists to prevent.
  if (!Number.isFinite(ageH))
    problems.push(
      `cannot determine the age of ${newest.key} — no last_modified and no date in the key.`,
    );
  else if (ageH > MAX_AGE_HOURS)
    problems.push(
      `newest backup is ${ageH.toFixed(1)}h old (max ${MAX_AGE_HOURS}h).`,
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
