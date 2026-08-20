-- 0227 — keep the file you were given, and say what happened to it.
--
-- §3e Step 3. Measured on production before writing anything:
--
--     activity_sources              548
--     …with no ingest_item_id       539
--     ingest_items                   10
--     import_artifacts                0        ← not one, ever
--     storage buckets                 0        ← nowhere to put a file
--
-- The schema for provenance has existed since 0202 and has never been used. An import
-- recorded that an activity came from "a file" and nothing else: not which file, not its
-- bytes, not whether other files in the same batch failed. So "where did this come from?"
-- has, until now, been answerable only as far as the word `file`.
--
-- WHAT THIS ADDS, and each piece exists because something specific was impossible:
--
--   * A PRIVATE BUCKET. There was nowhere to keep an original. Without the file itself, a
--     parser bug found next year cannot be re-run against what she actually uploaded — the
--     evidence is gone and only the interpretation survives.
--   * `record_import_artifact` — the file's SHA-256, size and type, upserted BY HASH.
--     `import_artifacts_sha` is a plain unique index, so ON CONFLICT genuinely works here
--     (unlike 0202's expression index, which silently failed for weeks — see 0209).
--   * `file_already_imported` — the cheapest and most certain de-dup there is. 0216 keys a
--     keyless file by owner+start+distance+type, which is an inference. A SHA-256 match is
--     not an inference: it is the same bytes. This runs BEFORE any of that.
--   * `record_ingest_failure` — a file that could not be parsed never reached the database
--     at all, so a batch of 184 files with 3 unreadable ones recorded 181 successes and no
--     trace of the rest. A failure is a fact about an import and belongs in its ledger.
--
-- LEGACY IS LABELLED, NOT INVENTED. The 539 rows that predate this have no artifact and
-- never will; reconstructing one would mean writing down a hash of a file nobody kept.
-- They are left alone, and the integrity check learns to expect artifacts only from imports
-- made after this migration.

-- ---------------------------------------------------------------------------
-- 1. Somewhere to keep the original.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imports', 'imports', false, 52428800, null)
on conflict (id) do update set public = false;

-- Only the household writes, only the household reads. `public=false` already blocks
-- anonymous access; these make the authenticated rules explicit rather than implied.
drop policy if exists "imports are written by editors" on storage.objects;
create policy "imports are written by editors"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'imports' and public.is_editor_or_owner());

drop policy if exists "imports are read by editors" on storage.objects;
create policy "imports are read by editors"
  on storage.objects for select to authenticated
  using (bucket_id = 'imports' and public.is_editor_or_owner());

-- ---------------------------------------------------------------------------
-- 2. The artifact: this exact file, by its bytes.
-- ---------------------------------------------------------------------------
create or replace function public.record_import_artifact(
  p_sha256     text,
  p_byte_size  bigint default null,
  p_media_type text default null,
  p_object_key text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_sha256 is null or length(btrim(p_sha256)) < 32 then
    raise exception 'an artifact without its hash is not an artifact' using errcode = '22023';
  end if;

  insert into public.import_artifacts (sha256, byte_size, media_type, object_key, retention)
  values (lower(btrim(p_sha256)), p_byte_size, p_media_type, p_object_key, 'keep')
  on conflict (sha256) do update
    set byte_size  = coalesce(excluded.byte_size,  public.import_artifacts.byte_size),
        media_type = coalesce(excluded.media_type, public.import_artifacts.media_type),
        -- Never lose a key we already have: re-uploading the same bytes must not blank the
        -- pointer to the copy already stored.
        object_key = coalesce(public.import_artifacts.object_key, excluded.object_key)
  returning id into v_id;
  return v_id;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. Have I seen these exact bytes before?
-- ---------------------------------------------------------------------------
-- Returns what happened last time, so the screen can say "you uploaded this on 17 August"
-- instead of quietly making a second copy. Distinct from 0216's content key: that says
-- "this looks like the same recording", this says "this is the same FILE".
create or replace function public.file_already_imported(p_sha256 text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select jsonb_build_object(
              'seen', true,
              'artifact_id', a.id,
              'first_seen', a.created_at,
              'items', (select count(*) from public.ingest_items i where i.artifact_id = a.id),
              'last_run_at', (select max(r.started_at)
                                from public.ingest_items i
                                join public.ingest_runs r on r.id = i.run_id
                               where i.artifact_id = a.id))
       from public.import_artifacts a
      where a.sha256 = lower(btrim(p_sha256))),
    jsonb_build_object('seen', false));
$function$;

-- ---------------------------------------------------------------------------
-- 4. A file that could not be read is still something that happened.
-- ---------------------------------------------------------------------------
create or replace function public.record_ingest_failure(
  p_run      uuid,
  p_reason   text,
  p_artifact uuid default null,
  p_label    text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- The run must be the caller's own and still open. A failure written into somebody
  -- else's run is a lie about their import.
  if not exists (select 1 from public.ingest_runs r
                  where r.id = p_run and r.initiated_by = auth.uid()) then
    raise exception 'that import run is not yours' using errcode = '42501';
  end if;

  insert into public.ingest_items
    (run_id, artifact_id, entity_kind, external_key, event_at, disposition, reason)
  values (p_run, p_artifact, 'activity', p_label, null, 'failed',
          left(coalesce(p_reason, 'could not be read'), 500))
  returning id into v_id;
  return v_id;
end $function$;

revoke all on function public.record_import_artifact(text,bigint,text,text) from public, anon;
revoke all on function public.file_already_imported(text) from public, anon;
revoke all on function public.record_ingest_failure(uuid,text,uuid,text) from public, anon;
grant execute on function public.record_import_artifact(text,bigint,text,text) to authenticated;
grant execute on function public.file_already_imported(text) to authenticated;
grant execute on function public.record_ingest_failure(uuid,text,uuid,text) to authenticated;

comment on function public.file_already_imported is
  'Has this EXACT file been seen before, by SHA-256? The cheapest and most certain de-dup '
  'there is — 0216''s content key infers that two recordings are the same outing; a hash '
  'match is the same bytes, and needs no inference at all (0227).';
