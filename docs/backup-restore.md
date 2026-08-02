# Backup & Restore (zero-budget, encrypted)

AdventureOrNo is a private two-person memory journal + trip planner. Its data —
exact places, visit dates, notes, ratings, coordinates, and media — is
irreplaceable and private. This document is the **procedure**; it deliberately
contains **no destinations, keys, or credentials**. You supply those at run time.

> Status: procedure only. Running these commands is a manual, user-initiated
> step. No scheduled job, upload, or production mutation is created by committing
> this file. Nothing here has been executed against production.

## What gets backed up

1. **Postgres** (Supabase project) — all canonical rows: `profiles`, `people`,
   `places`, `visits`, `entries`, `trips`/`trip_stops`, `activities`,
   `location_pings`, `photos`/`videos` **metadata**, reactions, `place_categories`,
   membership, and `settings`. The concrete tool is **`scripts/export-data.sh
   <dir>`** — a versioned, integrity-checked export (`manifest.json` with format +
   schema version, per-table row counts + SHA-256; `data/<table>.copy`). It
   **excludes** the credential tables (`ingest_tokens`, `strava_accounts`,
   `google_tokens`) and never emits bytes or signed URLs. `pg_dump` is a fallback.
2. **R2 media objects** — the actual photo/video bytes, plus a manifest that maps
   object keys → owning visit/place. The DB export stores only keys, never signed
   URLs or bytes.

Never include: signed URLs, access tokens, service-role keys, `.env*`, or the
raw unencrypted dump on any synced/cloud path.

## Tools

- **`age`** — required, installed. Modern file encryption. One keypair; keep the
  **private** key offline (password manager / hardware token / paper), never in
  this repo or any synced folder.
- **`restic`** *(optional)* or **`rclone`** *(optional, installed)* — only if you
  already use them and explicitly configure a destination. Not required.

Generate a keypair once (store the output somewhere safe, NOT here):

```sh
age-keygen -o "$AGE_KEY_FILE"        # $AGE_KEY_FILE is a path OUTSIDE the repo
# note the "Public key: age1..." line — that's your $AGE_RECIPIENT
```

## Create an encrypted backup

All paths below are **placeholders you provide**. `$WORK` is a temp dir you
create and delete; `$OUT` is your explicit destination (external drive, etc.).

```sh
set -euo pipefail
WORK="$(mktemp -d)"                  # temp, deleted at the end
trap 'rm -rf "$WORK"' EXIT

# 1. DB export (schema + data). Use your read/service connection string; it is
#    passed via env, never written to disk or the repo.
pg_dump --no-owner --format=custom "$DATABASE_URL" > "$WORK/db.dump"

# 2. R2 object manifest + bytes (rclone example; destination is your R2 remote).
rclone copy "$R2_REMOTE:$R2_BUCKET" "$WORK/media/" --transfers 4
#    (or use the app's versioned export which emits media metadata + a manifest)

# 3. Metadata for restore (schema version, checksums).
( cd "$WORK" && shasum -a 256 db.dump media/* > CHECKSUMS.sha256 )
echo "{\"created\":\"$(date -u +%FT%TZ)\",\"schema\":\"$SCHEMA_VERSION\"}" > "$WORK/meta.json"

# 4. Archive, then ENCRYPT before anything leaves temp storage.
tar -C "$WORK" -czf "$WORK/backup.tar.gz" db.dump media CHECKSUMS.sha256 meta.json
age -r "$AGE_RECIPIENT" -o "$OUT/aon-backup-$(date -u +%Y%m%dT%H%M%SZ).age" "$WORK/backup.tar.gz"

# $WORK (with the plaintext) is removed by the trap. Only the .age file remains.
```

**Dry run first:** run steps 1–3 into `$WORK`, inspect `CHECKSUMS.sha256` and the
manifest, and confirm counts against Data Health before encrypting/copying.

## Verify a backup (without restoring)

```sh
age -d -i "$AGE_KEY_FILE" "$BACKUP.age" | tar -tzf - | head    # lists contents
age -d -i "$AGE_KEY_FILE" "$BACKUP.age" | tar -xzf - -C "$VERIFY" && \
  ( cd "$VERIFY" && shasum -a 256 -c CHECKSUMS.sha256 )        # checksums pass
```

## Restore — **disposable local target only** by default

Restore imports into a **local, disposable** Supabase + R2-compatible test stack,
never production. Refuse any production-like target unless you deliberately pass
a multi-step override (and have a fresh verified backup first).

```sh
# Local Supabase (docker) + local S3/R2 (e.g. MinIO). NEVER the production URL.
[ "${ALLOW_PROD_RESTORE:-}" = "I_UNDERSTAND_THIS_OVERWRITES_PRODUCTION" ] || \
  case "$TARGET_DATABASE_URL" in *aanfyhsjbtnqzphuoiem*) echo "refusing prod"; exit 1;; esac
pg_restore --no-owner --clean --if-exists -d "$TARGET_DATABASE_URL" "$VERIFY/db.dump"
rclone copy "$VERIFY/media/" "$LOCAL_R2:$LOCAL_BUCKET"
```

The concrete restore is **`scripts/restore-data.sh <dir>`** — it verifies the
manifest's schema version + every per-table SHA-256, then reloads under
`session_replication_role = replica` (triggers/FKs off) into the **local disposable
db only** (confirmation-gated; no path to production). A **synthetic round-trip
test** — `scripts/export-restore-roundtrip.sh` — seeds fictional data, exports,
restores, re-exports, and asserts the manifests are **byte-identical**. It runs in CI
(the `db-tests` job) and never touches production data.

## Pruning (separate, confirmed)

Deleting old backups is a distinct, explicit operation — never automatic, never
part of `create`. With `restic`, `restic forget --prune` only after listing
snapshots and confirming. Keep a minimum retention that covers your RPO.

## Disaster-recovery runbook

- **Keys:** the `age` private key is the single point of failure. Store ≥2 copies
  offline in different physical locations. **Rotate** by generating a new keypair,
  re-encrypting the latest verified backup to the new recipient, and destroying old
  key copies after confirming the new one decrypts.
- **RPO / RTO:** decide your tolerance (e.g. RPO ≤ 24h → back up daily; RTO ≤ 2h →
  keep the newest `.age` on a fast local drive, not only cloud).
- **Recovery order:** decrypt → verify checksums → restore DB into a fresh local
  stack → restore media → run the app locally → reconcile counts vs the last known
  Data Health snapshot → only then consider a production restore (manual approval,
  multi-step override, fresh backup taken first).
- A production restore is **manual and out of scope for automation** here.

## Optional macOS scheduling (documented, not created)

You *may* later wire the `create` step to a `launchd` agent
(`~/Library/LaunchAgents/`) or `cron`. This repo intentionally does **not** create
one, so no unattended job runs without your explicit setup. If you do, ensure the
job reads `$AGE_RECIPIENT`, `$DATABASE_URL`, and destinations from a file **outside
the repo** and writes only the encrypted `.age` output to your chosen destination.
