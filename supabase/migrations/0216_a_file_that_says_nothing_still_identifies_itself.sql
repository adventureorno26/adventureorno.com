-- 0216 — a file that carries no id still identifies itself.
--
-- MEASURED BEFORE IT WAS WRITTEN. All **267** file-sourced activities in production carry
-- an `activity_sources` row with `external_key = NULL`. Not one has a de-dup key. So
-- re-uploading a file already imported does not attach — it creates a SECOND activity and
-- raises a card, every time. Erica's own GPX export proved it on 2026-08-17: no
-- `connect.garmin.com/.../activity/…` link in the file, so 0209's Tier 1 key could not be
-- built, and Tier 2 could only guess.
--
-- That is survivable for one file and not for a library. She is about to upload ~184, and
-- any overlap with what is already there — or a second attempt after a browser reload —
-- multiplies into duplicate activities and duplicate cards.
--
-- SO: WHEN THE FILE WILL NOT SAY WHO IT IS, THE RECORDING DOES.
--
--     file-content:<owner>:<start to the second>:<distance in whole metres>:<type>
--
-- This is NOT a similarity guess, and the difference is the whole justification for letting
-- Tier 1 attach on it. Tier 2 asks "could these be the same outing?" and must only propose,
-- because the answer is a judgement — Erica's two recordings of one run start 11 minutes
-- 21 seconds apart (7a-4). This key asks a different question: "is this the same RECORDING,
-- byte for byte in every field that matters?" One person cannot start two activities of the
-- same type in the same SECOND covering the same whole number of metres. There is no pair
-- of distinct outings this can merge.
--
-- SCOPED BY OWNER inside the key, because file imports have no `connection_id` and the
-- unique index is therefore global. Without the owner, two people who set off together and
-- both uploaded would collide into one activity — the exact failure 0203's Tier 3 exists to
-- prevent, arriving through the back door.
--
-- WHAT IT DOES NOT DO: a GPX and a TCX of the same activity usually differ by a metre or
-- two, so they get different keys and fall to Tier 2's proposal. That is correct. This key
-- is for *the same file arriving again*, which is the case that actually costs her.

create or replace function public.file_content_key(
  p_owner uuid, p_date timestamptz, p_distance double precision, p_type text)
returns text
language sql
immutable
as $function$
  select case
    when p_owner is null or p_date is null or coalesce(p_distance, 0) <= 0 then null
    else 'file-content:' || p_owner::text
         || ':' || to_char(p_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
         || ':' || round(p_distance::numeric)::text
         || ':' || lower(coalesce(p_type, 'workout'))
  end;
$function$;

comment on function public.file_content_key is
  'The identity a keyless upload has anyway: owner, start second, whole metres, type. Not a '
  'similarity score — one person cannot start two activities of the same type in the same '
  'second over the same distance, so Tier 1 may attach on it (0216).';

-- ---------------------------------------------------------------------------
-- The importer uses it when the file gave nothing better.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_activity(
  p_run          uuid,
  p_provider     text,
  p_origin       text default 'unknown',
  p_external_key text default null,
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
  v_key    text;
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

-- ---------------------------------------------------------------------------
-- The 267 already here get their keys, so a re-upload attaches instead of doubling.
-- ---------------------------------------------------------------------------
-- Collisions are LEFT ALONE rather than forced. Two file rows that produce the same key are
-- the same recording imported twice already — a real duplicate that a person should decide
-- about through the ordinary card, not something a migration should silently merge or
-- half-key. They keep `external_key = NULL` and stay reachable by Tier 2.
with keyed as (
  select s.id,
         public.file_content_key(a.owner_profile, a.start_date, a.distance, a.type) as k
    from public.activity_sources s
    join public.activities a on a.id = s.activity_id
   where s.provider = 'file'
     and s.external_key is null
),
unique_only as (
  -- (array_agg(id))[1], not min(id): there is no min() for uuid. The group has exactly one
  -- row by construction, so taking the first is taking the only one.
  select k, (array_agg(id))[1] as id
    from keyed
   where k is not null
   group by k
  having count(*) = 1
)
update public.activity_sources s
   set external_key = u.k
  from unique_only u
 where s.id = u.id;
