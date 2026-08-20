-- The import RPCs stop taking the caller's word for who they are.
--
-- THREE HOLES, and the second decided whose ACCOUNT data landed in:
--
--   1. `if p_actor_kind = 'user' and not is_editor_or_owner()` — the authorization check
--      only ran when the caller SAID they were a user. Passing 'scheduled' skipped it.
--   2. `p_connection` was written through unchecked, and `source_owner_profile` comes from
--      that connection's owner — so `ingest_activity` made THAT PERSON the owner of every
--      activity the run created.
--   3. idempotency was global: reusing another person's key JOINED their run.
--
-- And `ingest_activity` took nothing but a run id — which is not a secret. It is returned by
-- `begin_ingest_run` and stored on every ledger row.
begin;

set local check_function_bodies = off;

insert into auth.users (id, email) values
  ('dddd0234-0000-0000-0000-000000000001','e0234@example.invalid'),
  ('dddd0234-0000-0000-0000-000000000002','j0234@example.invalid')
on conflict do nothing;
insert into public.profiles (id, display_name, role) values
  ('dddd0234-0000-0000-0000-000000000001','E0234','owner'),
  ('dddd0234-0000-0000-0000-000000000002','J0234','editor')
on conflict (id) do update set role = excluded.role;

do $$
declare
  e_id uuid := 'dddd0234-0000-0000-0000-000000000001';
  j_id uuid := 'dddd0234-0000-0000-0000-000000000002';
  e_conn uuid;
  e_run uuid; j_run uuid; res jsonb;
begin
  insert into public.source_connections (provider, external_id, owner_profile, label, connected_at)
  values ('strava', 'conn-0234', e_id, 'Strava', now())
  returning id into e_conn;

  -- ---- as Josh ------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', j_id, 'role','authenticated')::text, true);

  -- 1. he cannot promote himself to a system job
  begin
    perform public.begin_ingest_run('file-upload','scheduled',null,null);
    raise exception 'FAIL: a signed-in caller claimed actor_kind=scheduled and skipped the authorization check';
  exception when insufficient_privilege then null;
  end;

  -- 2. he cannot import through HER connection — which would have made her the owner
  --    of everything the run created
  begin
    perform public.begin_ingest_run('file-upload','user',e_conn,null);
    raise exception 'FAIL: a run was opened through somebody else''s connection';
  exception when insufficient_privilege then null;
  end;

  -- ---- Erica opens a run of her own ---------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  e_run := public.begin_ingest_run('file-upload','user',e_conn,'key-0234');

  -- 3. her idempotency key is HERS. Reusing it must not join her run.
  perform set_config('request.jwt.claims',
    json_build_object('sub', j_id, 'role','authenticated')::text, true);
  j_run := public.begin_ingest_run('file-upload','user',null,'key-0234');
  if j_run = e_run then
    raise exception 'FAIL: reusing her idempotency key joined HER run';
  end if;

  -- 4. a run id is not a secret, and is no longer enough
  begin
    perform public.ingest_activity(e_run,'file','garmin',null,'Sneaky','Run',null,
      5000.0,1500,39.1,-77.5,'2026-05-05T12:00:00Z',null);
    raise exception 'FAIL: he wrote an activity into her import run';
  exception when insufficient_privilege then null;
  end;

  -- 5. …and cannot close it either
  begin
    perform public.finish_ingest_run(e_run);
    raise exception 'FAIL: he finished her run';
  exception when insufficient_privilege then null;
  end;

  -- ---- and none of this broke the ordinary case ---------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', e_id, 'role','authenticated')::text, true);
  res := public.ingest_activity(e_run,'file','garmin',null,'Hers','Run',null,
    5000.0,1500,39.1,-77.5,'2026-05-05T12:00:00Z',null);
  if res->>'disposition' is null then
    raise exception 'FAIL: her own import stopped working';
  end if;

  -- FINISHING TWICE IS A NO-OP. The importer calls this in a `finally`, and a retry after a
  -- network wobble calls it again; an error there would surface as a failed import that
  -- actually succeeded.
  perform public.finish_ingest_run(e_run);
  perform public.finish_ingest_run(e_run);
  if (select status from public.ingest_runs where id = e_run) <> 'finished' then
    raise exception 'FAIL: the run did not finish';
  end if;

  raise notice 'PASS: no self-promotion, no borrowed connection, no shared idempotency, no writing into another person''s run — and her own import still works, twice-finishable.';
end $$;

rollback;
