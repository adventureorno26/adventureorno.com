-- Keep the file you were given, and say what happened to it.
--
-- WHAT THIS PINS. Before 0227, production held 548 activity sources, 539 of them with no
-- ingest item, 10 items total, and ZERO artifacts — the provenance schema had existed since
-- 0202 and had never once been written to. An import recorded that an activity came from
-- "a file": not which file, not its bytes, and nothing at all about the ones that failed.
--
-- The three properties that make provenance real, and each was impossible before:
--   1. the same bytes are ONE artifact, however many times they arrive
--   2. a file that could not be read still lands in the ledger
--   3. a hash match is certainty, not inference — unlike 0216's content key
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values ('cccc0227-0000-0000-0000-000000000001','e0227@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('cccc0227-0000-0000-0000-000000000001','E0227','owner')
on conflict (id) do update set role = excluded.role;

do $$
declare
  e_id  uuid := 'cccc0227-0000-0000-0000-000000000001';
  sha   text := repeat('a1b2', 16);   -- 64 hex chars
  a1 uuid; a2 uuid; run uuid; fail uuid;
  seen jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);

  -- ---- 1. an unseen file is unseen -----------------------------------------
  seen := public.file_already_imported(sha);
  if (seen->>'seen')::boolean then
    raise exception 'FAIL: a file nobody has uploaded reported as already imported';
  end if;

  -- ---- 2. recording it, twice, is ONE artifact -----------------------------
  a1 := public.record_import_artifact(sha, 1234, 'application/gpx+xml', sha || '.gpx');
  a2 := public.record_import_artifact(sha, 1234, 'application/gpx+xml', sha || '.gpx');
  if a1 is distinct from a2 then
    raise exception 'FAIL: the same bytes produced two artifacts (% and %)', a1, a2;
  end if;

  seen := public.file_already_imported(sha);
  if not (seen->>'seen')::boolean then
    raise exception 'FAIL: a recorded file still reports as never seen — a re-upload would be invisible';
  end if;

  -- A SECOND UPLOAD MUST NOT BLANK THE STORED COPY. The upsert takes the newer size and
  -- type but keeps an object_key it already had; losing it would orphan the only copy of
  -- the original.
  perform public.record_import_artifact(sha, 4321, null, null);
  if (select object_key from public.import_artifacts where id = a1) is null then
    raise exception 'FAIL: re-recording the same file threw away the pointer to the stored original';
  end if;
  if (select byte_size from public.import_artifacts where id = a1) <> 4321 then
    raise exception 'FAIL: the artifact did not take the newer size';
  end if;

  -- ---- 3. a hash is not optional -------------------------------------------
  begin
    perform public.record_import_artifact('nope', 1, null, null);
    raise exception 'FAIL: an artifact was accepted without a real hash';
  exception when sqlstate '22023' then
    null; -- correct
  end;

  -- ---- 4. a failure is a fact about the import ----------------------------
  run  := public.begin_ingest_run('file-upload','user',null,null);
  fail := public.record_ingest_failure(run, 'no GPS track in the file', a1, 'broken.gpx');
  if not exists (select 1 from public.ingest_items
                  where id = fail and disposition = 'failed'
                    and artifact_id = a1 and external_key = 'broken.gpx') then
    raise exception 'FAIL: the unreadable file left no trace — 181 successes and no sign of the other 3';
  end if;

  perform public.finish_ingest_run(run);
  if (select failed from public.ingest_runs where id = run) <> 1 then
    raise exception 'FAIL: the run does not count its failure';
  end if;

  raise notice 'PASS: one artifact per file however often it arrives, the stored copy survives a re-upload, a hash is required, and a failure reaches the ledger.';
end $$;

rollback;
