-- 0203 — the importer: attach evidence, never swallow it, never rewrite whose outing it was.
--
-- This replaces the behaviour that caused everything in §7a. The old `import_file_activity`
-- did three things wrong, and each one is answered here:
--
--   1. It found a match and `return v_id` WITHOUT INSERTING. Josh's file was not stored, not
--      linked, not logged — the second recording of an outing simply ceased to exist.
--      → now it becomes a SOURCE on the activity, and an ingest_item either way.
--   2. It rewrote `activity_profiles` to every owner/editor when it matched someone else's
--      activity, which is how one person's upload changed whose outing it was.
--      → now it never touches attribution. Two people recording one outing is TWO
--        activities, linked, one owned by each. That is a joint outing, not a duplicate.
--   3. It kept no provenance at all.
--      → now every call opens an `ingest_runs` row and writes an `ingest_items` row per item.
--
-- THE DE-DUP IS TIERED BY CERTAINTY, because a match is not one kind of thing:
--
--   TIER 1  a shared source identifier  → the same SOURCE RECORD. Attach, silently, safely.
--   TIER 2  no id, same person, the physics agree → PROPOSE it. Never auto-merge.
--   TIER 3  a different person's recording of the same outing → NOT a duplicate. Link the
--           two activities as a shared outing and leave both owners alone.
--
-- WHY TIER 2 ONLY PROPOSES, decided by the data and not by taste. The first draft
-- auto-attached on start within 90s / distance within 1.5% / start point within 150m, and
-- the test built from the REAL 2026-03-07 fixture failed immediately: Erica's two
-- recordings of one run start **11 minutes 21 seconds apart** (13:10:36 vs 13:21:57) while
-- differing by 0.4% in distance. Thresholds tight enough to be safe are too tight to catch
-- the actual case, and thresholds wide enough to catch it are too wide to trust — which is
-- precisely why §2 says a machine may only propose, and why 0195 already routes the joint-
-- outing dedupe through `suggestions`.
--
-- So the net is WIDE and the consequence is SMALL: the activity is created (never dropped),
-- and a suggestion says "this looks like the same outing as X". A person merges it.

create or replace function public.begin_ingest_run(
  p_method text, p_actor_kind text default 'user', p_connection uuid default null,
  p_idempotency text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); v_id uuid;
begin
  if p_actor_kind = 'user' and not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Idempotency: a retried upload joins the run it already started rather than opening a
  -- second one. Without this, "click import twice" is indistinguishable from two imports.
  if p_idempotency is not null then
    select id into v_id from public.ingest_runs where idempotency_key = p_idempotency;
    if v_id is not null then return v_id; end if;
  end if;

  insert into public.ingest_runs
    (source, method, actor_kind, initiated_by, source_connection_id, source_owner_profile,
     status, idempotency_key, started_at)
  values
    (coalesce(p_method,'file'), p_method, coalesce(p_actor_kind,'user'), v_me, p_connection,
     coalesce((select owner_profile from public.source_connections where id = p_connection), v_me),
     'running', p_idempotency, now())
  returning id into v_id;
  return v_id;
end $function$;

create or replace function public.finish_ingest_run(p_run uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.ingest_runs
     set status = 'finished', finished_at = now(),
         ok     = (select count(*) from public.ingest_items i
                    where i.run_id = p_run and i.disposition in ('inserted','attached')),
         failed = (select count(*) from public.ingest_items i
                    where i.run_id = p_run and i.disposition = 'failed')
   where id = p_run;
$function$;

-- ---------------------------------------------------------------------------
-- The one door for bringing an activity in.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_activity(
  p_run          uuid,
  p_provider     text,                       -- how it reached us: strava | file | apple-health | …
  p_origin       text default 'unknown',     -- where it BEGAN, if the file says so
  p_external_key text default null,          -- the provider's own id for this record
  p_name         text default null,
  p_type         text default null,
  p_polyline     text default null,
  p_distance     double precision default null,
  p_moving       integer default null,
  p_lat          double precision default null,
  p_lng          double precision default null,
  p_date         timestamptz default null,
  p_device       text default null,
  p_artifact     uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me     uuid := auth.uid();
  v_conn   uuid;
  v_owner  uuid;
  v_id     uuid;
  v_place  uuid;
  v_other  uuid;
  v_dup    uuid;
  v_pt     geography;
  v_disp   text;
  v_reason text;
  v_item   uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select source_connection_id, coalesce(source_owner_profile, initiated_by)
    into v_conn, v_owner
    from public.ingest_runs where id = p_run;
  if v_owner is null then v_owner := v_me; end if;
  if p_lat is not null and p_lng is not null then
    v_pt := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  end if;

  -- ---- TIER 1: the same source record, seen again -------------------------
  -- Scoped to (provider, connection, external_key), never global: a provider key proves
  -- the same RECORD, not the same real-world outing.
  if p_external_key is not null then
    select s.activity_id into v_id
      from public.activity_sources s
     where s.provider = p_provider
       and s.external_key = p_external_key
       and coalesce(s.connection_id,'00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(v_conn,'00000000-0000-0000-0000-000000000000'::uuid)
     limit 1;
    if v_id is not null then
      v_disp := 'duplicate';
      v_reason := 'same source record, already attached';
    end if;
  end if;

  -- ---- create it, if it is genuinely new ----------------------------------
  if v_id is null then
    v_place := public.place_for_activity(p_lat, p_lng, p_type, p_name);
    insert into public.activities
      (strava_id, type, name, distance, moving_time, start_date, lat, lng, place_id,
       summary_polyline, source, original_source, owner_profile)
    values
      (null, coalesce(p_type,'Workout'),
       public.activity_display_name(p_name, v_place, p_type),
       coalesce(p_distance,0), p_moving, p_date, p_lat, p_lng, v_place,
       p_polyline, p_provider, coalesce(nullif(p_origin,'unknown'), p_provider), v_owner)
    returning id into v_id;

    -- The importer's own, and nobody else's. Sharing an outing is a TAG (0201), which the
    -- other person accepts — it is not a side effect of somebody uploading a file.
    insert into public.activity_profiles
      (activity_id, profile_id, claim_status, evidence, created_by)
    values (v_id, v_owner, 'accepted', 'own_recording', 'import')
    on conflict do nothing;

    v_disp := 'inserted';

    -- ---- TIER 2: does this look like MY OWN outing, already recorded? -----
    -- A wide net, because it only proposes. Same person, same type, within half an hour,
    -- distance within 2%, start within 400m — which comfortably covers the real case that
    -- broke the narrow version.
    if p_date is not null then
      select a.id into v_dup
        from public.activities a
       where a.owner_profile = v_owner
         and a.id <> v_id
         and (p_type is null or a.type = p_type)
         and abs(extract(epoch from (a.start_date - p_date))) <= 1800
         and (p_distance is null or a.distance is null
              or abs(a.distance - p_distance) <= greatest(160, p_distance * 0.02))
         and (v_pt is null or a.geom is null or st_dwithin(a.geom, v_pt, 400))
       order by abs(extract(epoch from (a.start_date - p_date)))
       limit 1;

      if v_dup is not null then
        insert into public.suggestions
          (subject_type, subject_id, field, current_value, proposed_value,
           label, source, confidence, evidence, group_key, rank, status)
        select 'activity', v_id, 'duplicate_of',
               to_jsonb(null::uuid), to_jsonb(v_dup),
               format('Looks like the same outing as "%s" — %s min apart, %s%% difference in distance',
                      coalesce(a.name,'(unnamed)'),
                      round(abs(extract(epoch from (a.start_date - p_date)))/60.0),
                      round((abs(coalesce(a.distance,0) - coalesce(p_distance,0))
                             / nullif(greatest(a.distance, p_distance),0) * 100)::numeric, 1)),
               'import', 0.7,
               jsonb_build_object('kept', v_dup, 'incoming', v_id, 'provider', p_provider),
               'import-dup:' || least(v_id, v_dup)::text, 1, 'pending'
          from public.activities a where a.id = v_dup
        on conflict do nothing;
        v_disp := 'proposed';
        v_reason := 'created, and proposed as a duplicate of an existing outing for a person to confirm';
      end if;
    end if;

    -- ---- TIER 3: someone ELSE already recorded this outing ----------------
    -- Not a duplicate — a joint outing. Both activities stand, each owned by the person who
    -- recorded it, linked so every reader counts the outing once.
    if v_pt is not null and p_date is not null then
      select a.id into v_other
        from public.activities a
       where a.owner_profile is not null and a.owner_profile <> v_owner
         and a.id <> v_id
         and (p_type is null or a.type = p_type)
         and abs(extract(epoch from (a.start_date - p_date))) <= 1800
         and a.geom is not null and st_dwithin(a.geom, v_pt, 800)
       limit 1;
      if v_other is not null then
        update public.activities
           set shared_group_id = coalesce(
                 (select shared_group_id from public.activities where id = v_other),
                 v_other)
         where id in (v_id, v_other) and shared_group_id is null;
        v_reason := 'linked to another person''s recording of the same outing';
      end if;
    end if;

    if v_place is not null then
      perform public.recompute_place_stats(v_place);
      perform public.rebuild_place_visits(v_place);
    end if;
  end if;

  -- ---- the evidence, always -----------------------------------------------
  insert into public.activity_sources
    (activity_id, connection_id, provider, origin, external_key, device_name, is_primary, confidence)
  values
    (v_id, v_conn, p_provider, coalesce(p_origin,'unknown'), p_external_key, p_device,
     (v_disp = 'inserted'), case when p_external_key is not null then 'exact' else 'strong' end)
  on conflict do nothing;

  -- ---- and the ledger entry, even when nothing was created ----------------
  insert into public.ingest_items
    (run_id, artifact_id, entity_kind, external_key, event_at, disposition, reason)
  values (p_run, p_artifact, 'activity', p_external_key, p_date, v_disp, v_reason)
  returning id into v_item;

  update public.activity_sources set ingest_item_id = v_item
   where activity_id = v_id and ingest_item_id is null
     and provider = p_provider and coalesce(external_key,'') = coalesce(p_external_key,'');

  return jsonb_build_object('activity_id', v_id, 'disposition', v_disp, 'reason', v_reason);
end $function$;

revoke all on function public.begin_ingest_run(text,text,uuid,text) from public, anon;
revoke all on function public.finish_ingest_run(uuid) from public, anon;
revoke all on function public.ingest_activity(uuid,text,text,text,text,text,text,double precision,integer,double precision,double precision,timestamptz,text,uuid) from public, anon;
grant execute on function public.begin_ingest_run(text,text,uuid,text) to authenticated;
grant execute on function public.finish_ingest_run(uuid) to authenticated;
grant execute on function public.ingest_activity(uuid,text,text,text,text,text,text,double precision,integer,double precision,double precision,timestamptz,text,uuid) to authenticated;

comment on function public.ingest_activity is
  'The one door for bringing an activity in. Attaches evidence to an outing that already '
  'exists, creates one that does not, links a DIFFERENT person''s recording as a joint '
  'outing rather than merging it, and never changes who was on anything — that is a tag '
  '(0201), which the other person accepts.';
