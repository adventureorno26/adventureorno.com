// Upload an encrypted backup to R2 and prune old ones.
//
//   CLOUDFLARE_API_TOKEN_MASTER=… node scripts/backup-upload.mjs <file> <key>
//
// RETENTION (grandfather-father-son). A single rolling copy is not a backup: it
// happily overwrites itself with the corrupted version the night after something
// goes wrong, and nobody notices for a week. Keeping dated generations means the
// question "what did this look like before that migration?" has an answer.
//
//   14 daily     — the last fortnight, day by day
//    8 weekly    — Sundays, ~2 months back
//   12 monthly   — the 1st, ~a year back
//
// At ~3 MB a night that is well under 100 MB total, i.e. inside R2's free tier.
import { readFileSync } from "node:fs";

const acct = "9bed5239120cee4e9e7d46fa69ef4784";
const token =
  process.env.CLOUDFLARE_API_TOKEN_MASTER || process.env.CLOUDFLARE_API_TOKEN;
const [file, key] = process.argv.slice(2);
if (!token || !file || !key) {
  console.error(
    "usage: CLOUDFLARE_API_TOKEN_MASTER=… node scripts/backup-upload.mjs <file> <key>",
  );
  process.exit(1);
}
const BUCKET = "aon-backups";
const api = (p = "") =>
  `https://api.cloudflare.com/client/v4/accounts/${acct}/r2/buckets/${BUCKET}${p}`;
const auth = { Authorization: `Bearer ${token}` };

const body = readFileSync(file);
const put = await fetch(api(`/objects/${encodeURIComponent(key)}`), {
  method: "PUT",
  headers: { ...auth, "Content-Type": "application/octet-stream" },
  body,
});
if (!put.ok) {
  console.error(
    `upload failed: ${put.status} ${(await put.text()).slice(0, 200)}`,
  );
  process.exit(1);
}
console.log(`backup-upload: ${key} (${(body.length / 1e6).toFixed(2)} MB)`);

// ---- prune ----------------------------------------------------------------
async function list(prefix) {
  const out = [];
  let cursor = "";
  for (;;) {
    const u = new URL(api("/objects"));
    u.searchParams.set("per_page", "1000");
    u.searchParams.set("prefix", prefix);
    if (cursor) u.searchParams.set("cursor", cursor);
    const res = await fetch(u, { headers: auth });
    if (!res.ok) throw new Error(`list: ${res.status}`);
    const b = await res.json();
    out.push(...(b.result ?? []));
    cursor = b.result_info?.cursor ?? "";
    if (!cursor) break;
  }
  return out;
}

const all = (await list("db/"))
  .map((o) => ({
    key: o.key,
    day: (o.key.match(/db\/(\d{4}-\d{2}-\d{2})\//) || [])[1],
  }))
  .filter((o) => o.day)
  .sort((a, b) => (a.day < b.day ? 1 : -1)); // newest first

const keep = new Set();
all.slice(0, 14).forEach((o) => keep.add(o.key)); // 14 daily
all
  .filter((o) => new Date(`${o.day}T00:00:00Z`).getUTCDay() === 0)
  .slice(0, 8)
  .forEach((o) => keep.add(o.key)); // 8 weekly (Sundays)
all
  .filter((o) => o.day.endsWith("-01"))
  .slice(0, 12)
  .forEach((o) => keep.add(o.key)); // 12 monthly

const doomed = all.filter((o) => !keep.has(o.key));
for (const o of doomed) {
  const res = await fetch(api(`/objects/${encodeURIComponent(o.key)}`), {
    method: "DELETE",
    headers: auth,
  });
  console.log(`  pruned ${o.key}${res.ok ? "" : " (FAILED)"}`);
}
console.log(
  `backup-upload: keeping ${keep.size} generation(s), pruned ${doomed.length}`,
);
