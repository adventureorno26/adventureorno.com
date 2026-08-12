// BACK UP THE PHOTO AND VIDEO BYTES.
//
//   CLOUDFLARE_API_TOKEN_MASTER=… node scripts/backup-r2.mjs [--dry-run]
//
// THE DATABASE DUMP IS A MANIFEST, NOT THE PHOTOS. `photos` and `videos` rows carry
// only R2 object keys; the actual JPEGs and MP4s live in the `adventureorno-photos`
// bucket. Restoring the database without them gives you 177 rows pointing at
// nothing — every marker on the map is a photo, so that is not a restore.
//
// This mirrors `adventureorno-photos` into `aon-backups` under `objects/`. It is
// incremental: an object already present at the same size is skipped, so a nightly
// run after the first costs almost nothing.
//
// NOT ENCRYPTED, deliberately, and this is a real trade-off worth stating: these are
// opaque binary blobs under UUID keys, already private in R2, and re-encrypting them
// nightly would mean a full re-upload whenever the key rotates. The DATABASE backup —
// which holds the names, notes, coordinates and dates that make the photos meaningful
// — IS encrypted. If Erica wants the bytes encrypted too, the honest cost is a full
// re-copy per rotation.
const acct = "9bed5239120cee4e9e7d46fa69ef4784";
const token =
  process.env.CLOUDFLARE_API_TOKEN_MASTER || process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error("backup-r2: missing CLOUDFLARE_API_TOKEN_MASTER");
  process.exit(1);
}
const DRY = process.argv.includes("--dry-run");
const SRC = "adventureorno-photos";
const DST = "aon-backups";

const api = (bucket, path = "") =>
  `https://api.cloudflare.com/client/v4/accounts/${acct}/r2/buckets/${bucket}${path}`;
const auth = { Authorization: `Bearer ${token}` };

/** Every object in a bucket, following the cursor. */
async function list(bucket, prefix = "") {
  const out = [];
  let cursor = "";
  for (;;) {
    const u = new URL(api(bucket, "/objects"));
    u.searchParams.set("per_page", "1000");
    if (prefix) u.searchParams.set("prefix", prefix);
    if (cursor) u.searchParams.set("cursor", cursor);
    const res = await fetch(u, { headers: auth });
    if (!res.ok)
      throw new Error(
        `list ${bucket}: ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    const body = await res.json();
    out.push(...(body.result ?? []));
    cursor = body.result_info?.cursor ?? "";
    if (!cursor) break;
  }
  return out;
}

const src = await list(SRC);
const dstExisting = new Map(
  (await list(DST, "objects/")).map((o) => [
    o.key.replace(/^objects\//, ""),
    Number(o.size),
  ]),
);

const todo = src.filter((o) => dstExisting.get(o.key) !== Number(o.size));
const bytes = todo.reduce((n, o) => n + Number(o.size), 0);
console.log(
  `backup-r2: ${src.length} objects in ${SRC}; ${dstExisting.size} already mirrored; ` +
    `${todo.length} to copy (${(bytes / 1e6).toFixed(1)} MB)`,
);
if (DRY || todo.length === 0) process.exit(0);

let done = 0;
let failed = 0;
for (const o of todo) {
  const key = encodeURIComponent(o.key);
  try {
    const get = await fetch(api(SRC, `/objects/${key}`), { headers: auth });
    if (!get.ok) throw new Error(`get ${get.status}`);
    const buf = Buffer.from(await get.arrayBuffer());
    const put = await fetch(
      api(DST, `/objects/${encodeURIComponent("objects/" + o.key)}`),
      {
        method: "PUT",
        headers: {
          ...auth,
          "Content-Type":
            o.http_metadata?.contentType || "application/octet-stream",
        },
        body: buf,
      },
    );
    if (!put.ok) throw new Error(`put ${put.status}`);
    done += 1;
    if (done % 25 === 0) process.stdout.write(`  …${done}/${todo.length}\n`);
  } catch (e) {
    failed += 1;
    console.error(`  FAILED ${o.key}: ${e.message}`);
  }
}

console.log(`backup-r2: copied ${done}, failed ${failed}`);
// A partial object backup is a failed object backup — the run must go red so the
// alert fires rather than reporting a green night with missing photos.
process.exit(failed === 0 ? 0 : 1);
