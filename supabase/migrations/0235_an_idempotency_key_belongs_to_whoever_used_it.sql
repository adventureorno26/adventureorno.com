-- 0235 — an idempotency key belongs to whoever used it.
--
-- 0234 scoped the idempotency LOOKUP to the caller, closing a hole where reusing somebody
-- else's key joined their import run. The index stayed globally unique:
--
--     CREATE UNIQUE INDEX ingest_runs_idempotency ON ingest_runs (idempotency_key)
--
-- So the second person no longer joined the run — they got a raw
-- `23505 duplicate key value violates unique constraint` instead. Better than the hole and
-- still wrong twice over: an import fails for a reason that is nothing to do with the
-- person importing, and the error itself confirms that somebody else has used that key.
--
-- Caught by `0234`'s own regression test on its first run, which is the argument for
-- writing the test at the same time as the fix.
--
-- The key is scoped to its initiator, matching the lookup exactly. Two people may now use
-- "batch-1" independently and each gets their own run; one person reusing their own key
-- still rejoins the run they already started, which is the whole point of the mechanism.
--
-- Service callers keep a single shared namespace: `initiated_by` is NULL for cron and
-- migrations, and `IS NOT DISTINCT FROM` treats those NULLs as equal, so a scheduled job
-- reusing its key still finds its own run rather than opening a second one.
drop index if exists public.ingest_runs_idempotency;

create unique index ingest_runs_idempotency
  on public.ingest_runs (idempotency_key, coalesce(initiated_by, '00000000-0000-0000-0000-000000000000'::uuid))
  where idempotency_key is not null;
