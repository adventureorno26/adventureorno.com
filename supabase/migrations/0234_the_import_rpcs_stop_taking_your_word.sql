-- 0234 — the import RPCs stop taking the caller's word for who they are.
--
-- §3e Step 4, and Codex was right that they were "too trusting". Reading them closely found
-- three holes, and the second is worse than a mislabelled row.
--
-- 1. THE AUTHORIZATION CHECK COULD BE SKIPPED BY ASKING NICELY.
--        if p_actor_kind = 'user' and not public.is_editor_or_owner() then raise ...
--    The guard only ran when the caller SAID they were a user. Pass
--    `p_actor_kind => 'scheduled'` and the check never fired at all.
--
-- 2. A RUN COULD BE ATTACHED TO SOMEBODY ELSE'S CONNECTION.
--    `p_connection` was written straight through, and `source_owner_profile` is taken from
--    that connection's owner. `ingest_activity` then makes THAT PERSON the owner of every
--    activity the run creates. So the parameter was not just decorative: it decided whose
--    account the data landed in.
--
-- 3. IDEMPOTENCY WAS GLOBAL. `where idempotency_key = p_idempotency` searched every run in
--    the table, so reusing another person's key joined their run instead of starting one.
--
-- And `ingest_activity` itself took nothing but a run id — which is not a secret; it is
-- returned by `begin_ingest_run` and stored on every ledger row.
--
-- THE RULE NOW: a user-facing call says only WHAT it is importing. Who is importing, on
-- whose behalf, and into which run are read from the session, never from the arguments.
-- Service callers — cron, migrations, the Strava webhook — have no `auth.uid()`, are
-- trusted by the grant rather than by a parameter, and keep working unchanged.

create or replace function public.begin_ingest_run(
  p_method text,
  p_actor_kind text default 'user',
  p_connection uuid default null,
  p_idempotency text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me     uuid := auth.uid();
  v_id     uuid;
  v_kind   text;
  v_owner  uuid;
begin
  if v_me is null then
    -- A service caller: cron, a migration, a webhook. The grant is the authorization, and
    -- its actor_kind is taken at face value because there is no session to read it from.
    v_kind := coalesce(nullif(btrim(p_actor_kind), ''), 'scheduled');
    v_owner := (select owner_profile from public.source_connections where id = p_connection);
  else
    if not public.is_editor_or_owner() then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    -- NOT taken from the argument. A signed-in caller is a user, whatever they pass.
    v_kind := 'user';
    if p_actor_kind is not null and btrim(p_actor_kind) <> 'user' then
      raise exception 'a signed-in import is a user import; % is for service callers', p_actor_kind
        using errcode = '42501';
    end if;
    -- A connection you do not own is not yours to import through, because its owner
    -- becomes the owner of everything the run creates.
    if p_connection is not null
       and not exists (select 1 from public.source_connections c
                        where c.id = p_connection and c.owner_profile = v_me) then
      raise exception 'that connection is not yours' using errcode = '42501';
    end if;
    v_owner := v_me;
  end if;

  -- Idempotency, SCOPED TO THE CALLER. Globally, a reused key joined a stranger's run.
  if p_idempotency is not null then
    select id into v_id from public.ingest_runs
     where idempotency_key = p_idempotency
       and initiated_by is not distinct from v_me;
    if v_id is not null then return v_id; end if;
  end if;

  insert into public.ingest_runs
    (source, method, actor_kind, initiated_by, source_connection_id, source_owner_profile,
     status, idempotency_key, started_at)
  values
    (coalesce(p_method,'file'), p_method, v_kind, v_me, p_connection,
     coalesce(v_owner, v_me), 'running', p_idempotency, now())
  returning id into v_id;
  return v_id;
end $function$;

-- ---------------------------------------------------------------------------
-- Finishing a run: yours, and safe to call twice.
-- ---------------------------------------------------------------------------
-- The importer calls this in a `finally`, and a retry after a network wobble would call it
-- again. Finishing an already-finished run is a no-op, not an error — and finishing
-- somebody else's is refused.
create or replace function public.finish_ingest_run(p_run uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null
     and not exists (select 1 from public.ingest_runs r
                      where r.id = p_run and r.initiated_by = auth.uid()) then
    raise exception 'that import run is not yours' using errcode = '42501';
  end if;

  update public.ingest_runs
     set status = 'finished',
         finished_at = coalesce(finished_at, now()),
         ok     = (select count(*) from public.ingest_items i
                    where i.run_id = p_run and i.disposition <> 'failed'),
         failed = (select count(*) from public.ingest_items i
                    where i.run_id = p_run and i.disposition = 'failed')
   where id = p_run;
end $function$;

-- ---------------------------------------------------------------------------
-- And the door itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_activity(p_run uuid, p_provider text, p_origin text DEFAULT 'unknown'::text, p_external_key text DEFAULT NULL::text, p_name text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_polyline text DEFAULT NULL::text, p_distance double precision DEFAULT NULL::double precision, p_moving integer DEFAULT NULL::integer, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_device text DEFAULT NULL::text, p_artifact uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_key    text;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- THE RUN MUST BE THE CALLER'S, AND STILL OPEN (0234).
  --
  -- It took only a run id. A run id is not a secret — it comes back from
  -- `begin_ingest_run`, it is in every ingest_items row — so any editor could append
  -- activities to somebody else's import. Worse, this function reads `source_owner_profile`
  -- FROM THE RUN and makes that person the owner of whatever it creates: writing into
  -- another person's run wrote activities into their account.
  --
  -- Service callers (cron, migrations, webhooks) have no `auth.uid()` and are trusted by
  -- the grant, so they are unaffected.
  if auth.uid() is not null then
    if not exists (
      select 1 from public.ingest_runs r
       where r.id = p_run
         and r.initiated_by = auth.uid()
         and r.status = 'running')
    then
      raise exception 'that import run is not yours, or is already finished'
        using errcode = '42501';
    end if;
  end if;
  select source_connection_id, coalesce(source_owner_profile, initiated_by)
    into v_conn, v_owner
    from public.ingest_runs where id = p_run;
  if v_owner is null then v_owner := v_me; end if;
  if p_lat is not null and p_lng is not null then
    v_pt := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  end if;

  -- The provider's own id when the file has one; otherwise the recording's own identity.
  -- Only for files: a provider that CAN give an id and did not is a different problem, and
  -- silently keying its records by content would hide it.
  v_key := p_external_key;
  if v_key is null and p_provider = 'file' then
    v_key := public.file_content_key(v_owner, p_date, p_distance, p_type);
  end if;

  -- ---- TIER 1: the same source record, seen again -------------------------
  if v_key is not null then
    select s.activity_id into v_id
      from public.activity_sources s
     where s.provider = p_provider
       and s.external_key = v_key
       and coalesce(s.connection_id,'00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(v_conn,'00000000-0000-0000-0000-000000000000'::uuid)
     limit 1;
    if v_id is not null then
      v_disp := 'duplicate';
      v_reason := case when p_external_key is null
                       then 'the same recording, already imported'
                       else 'same source record, already attached' end;
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

    insert into public.activity_profiles
      (activity_id, profile_id, claim_status, evidence, created_by)
    values (v_id, v_owner, 'accepted', 'own_recording', 'import')
    on conflict do nothing;

    v_disp := 'inserted';

    -- ---- TIER 2: does this look like MY OWN outing, already recorded? -----
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
        select 'activity', v_id, 'shared_group_id',
               to_jsonb(null::uuid), to_jsonb(coalesce(a.shared_group_id, a.id)),
               format('The same outing as "%s" — %s min apart, %s%% difference in distance, from %s',
                      coalesce(a.name,'(unnamed)'),
                      round(abs(extract(epoch from (a.start_date - p_date)))/60.0),
                      round((abs(coalesce(a.distance,0) - coalesce(p_distance,0))
                             / nullif(greatest(a.distance, p_distance),0) * 100)::numeric, 1),
                      coalesce(nullif(a.original_source,''), a.source, 'an earlier import')),
               'import', 0.7,
               jsonb_build_object('kept', v_dup, 'incoming', v_id, 'provider', p_provider),
               'import-dup:' || least(v_id, v_dup)::text, 1, 'pending'
          from public.activities a where a.id = v_dup
        on conflict do nothing;
        v_disp := 'proposed';
        v_reason := 'created, and proposed as the same outing as one already recorded, for a person to confirm';
      end if;
    end if;

    -- ---- TIER 3: someone ELSE already recorded this outing ----------------
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
        -- PROPOSES. It used to write `shared_group_id` on both rows outright, which is a
        -- machine deciding that two people's recordings are one outing — the exact thing §2
        -- forbids, sitting inside the importer that exists to enforce it. It was written
        -- before 0210 gave duplicates a card a person can answer, and it never caught up.
        --
        -- The cost of being wrong here is not small: linking is what makes an outing count
        -- ONCE, so a bad link silently erases a day somebody actually had.
        insert into public.suggestions
          (subject_type, subject_id, field, current_value, proposed_value,
           label, source, confidence, evidence, group_key, rank, status)
        select 'activity', v_id, 'shared_group_id',
               to_jsonb(null::uuid), to_jsonb(coalesce(o.shared_group_id, o.id)),
               format('The same outing as %s''s "%s" — %s min apart, both recorded separately',
                      coalesce(ow.display_name, 'someone else'),
                      coalesce(o.name, '(unnamed)'),
                      round(abs(extract(epoch from (o.start_date - p_date)))/60.0)),
               'import', 0.6,
               jsonb_build_object('kept', v_other, 'incoming', v_id,
                                  'reason', 'joint outing',
                                  'minutes_apart', round(abs(extract(epoch from (o.start_date - p_date)))/60.0, 1)),
               'import-dup:' || least(v_id, v_other)::text, 1, 'pending'
          from public.activities o
          left join public.profiles ow on ow.id = o.owner_profile
         where o.id = v_other
        on conflict do nothing;
        if v_disp = 'inserted' then v_disp := 'proposed'; end if;
        v_reason := 'created, and proposed as the same outing as another person''s recording';
      end if;
    end if;

    if v_place is not null then
      perform public.recompute_place_stats(v_place);
      perform public.rebuild_place_visits(v_place);
    end if;
  end if;

  insert into public.activity_sources
    (activity_id, connection_id, provider, origin, external_key, device_name, is_primary, confidence)
  values
    (v_id, v_conn, p_provider, coalesce(p_origin,'unknown'), v_key, p_device,
     (v_disp = 'inserted'),
     case when p_external_key is not null then 'exact'
          when v_key is not null then 'exact'   -- same recording, not a resemblance
          else 'strong' end)
  on conflict do nothing;

  insert into public.ingest_items
    (run_id, artifact_id, entity_kind, external_key, event_at, disposition, reason)
  values (p_run, p_artifact, 'activity', v_key, p_date, v_disp, v_reason)
  returning id into v_item;

  update public.activity_sources set ingest_item_id = v_item
   where activity_id = v_id and ingest_item_id is null
     and provider = p_provider and coalesce(external_key,'') = coalesce(v_key,'');

  return jsonb_build_object('activity_id', v_id, 'disposition', v_disp, 'reason', v_reason);
end $function$;
