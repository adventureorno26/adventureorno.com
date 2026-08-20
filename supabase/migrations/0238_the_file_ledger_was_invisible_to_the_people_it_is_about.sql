-- 0238 — the file ledger was invisible to the people it is a record of.
--
-- Found by 0237's own test, on its first run, and it is exactly the kind of thing a
-- SECURITY INVOKER export is FOR:
--
--     ERROR: 42501: permission denied for table import_artifacts
--
-- `import_artifacts` (0227) is the record of every original file uploaded: its sha256, its
-- size, its media type and its object key. RLS is on and it has **no SELECT policy at all**,
-- and `authenticated` was never granted SELECT — so it was reachable only by the service role.
-- Not a decision anybody wrote down; the grant block that every other table in that migration
-- got was simply not repeated for this one.
--
-- Its two siblings in the same provenance chain are both `is_member()`:
--
--     ingest_runs_select   → is_member()
--     ingest_items_select  → is_member()
--
-- and `ingest_items` already exposes `artifact_id`, so a member could already see that an
-- artifact EXISTS and could not see what it was. That is the worst of both: no privacy gained,
-- provenance broken. Step 3 promised "every upload hashed, stored, recorded"; a record the
-- person who uploaded the file cannot read is not a record they have.
--
-- So: the same rule as its siblings. The row is a hash, a size and an object KEY — the file
-- itself lives in private storage behind a signed URL, and this changes nothing about that.
grant select on public.import_artifacts to authenticated;

drop policy if exists import_artifacts_select on public.import_artifacts;
create policy import_artifacts_select on public.import_artifacts for select
  using (public.is_member());

comment on table public.import_artifacts is
  'Every original uploaded file: sha256, size, media type, object key. Readable by members, '
  'like ingest_runs and ingest_items beside it — it had no SELECT policy at all until 0238, '
  'which made the provenance chain unreadable by the people it is about. Never the bytes.';
