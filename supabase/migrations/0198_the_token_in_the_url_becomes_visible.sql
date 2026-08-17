-- 0198 — make the token-in-the-URL visible, so the fallback can actually be retired.
--
-- §C5: "The device ingest token travels as `?token=` and is therefore in Supabase's
-- request logs in plaintext." It is recorded as ❌ not started, and half of it has in
-- fact been done for some time: `ingest-overland` already PREFERS
-- `Authorization: Bearer <token>` and only falls back to the query string.
--
-- So the leak does not persist because the code cannot do better. It persists because
-- Erica's iPhone Shortcut still calls the URL form, and **nothing anywhere says whether
-- it still does.** Deleting the fallback blind would break her phone ingest silently;
-- leaving it forever keeps a credential in the request logs forever. Both are bad, and
-- the reason it has sat is that there was no way to tell which one you were choosing.
--
-- One nullable column ends that. When it stops advancing, every caller has moved to the
-- header and the fallback can be deleted with evidence instead of hope.
--
-- WHY NOT JUST LOG IT. A `console.warn` is the obvious move and it is the wrong one
-- twice over: this repository has now watched a nightly job fail eight times into logs
-- nobody read, and log lines about a credential are exactly what should not accumulate
-- next to the credential. A column is queryable, it is one row, and it holds no secret —
-- only a timestamp.

alter table public.ingest_tokens
  add column if not exists last_query_auth_at timestamptz;

comment on column public.ingest_tokens.last_query_auth_at is
  'When this token was last accepted from the ?token= QUERY STRING rather than the '
  'Authorization header. The query form puts a credential in request logs in plaintext '
  '(§C5). NULL, or far in the past, means every caller has moved to the header and the '
  'fallback in ingest-overland can be removed. Deleting it while this is still advancing '
  'would break phone ingest silently.';
