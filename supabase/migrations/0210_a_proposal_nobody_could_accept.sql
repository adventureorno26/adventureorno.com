-- 0210 — the importer raised a proposal the Inbox could not apply.
--
-- FOUND BY USING IT. Erica imported one Garmin GPX on 2026-08-17. It behaved exactly as
-- designed right up to the last step:
--
--     Loudoun County Walking   2024-09-26 12:13:40  1225 m  file    origin garmin
--     Lake of the Red Rocks    2024-09-26 12:13:22  1254 m  strava  origin garmin
--     → "Looks like the same outing … 0 min apart, 2.3% difference in distance"
--
-- The card appeared in her Inbox. Approving it would have raised
-- `22023: the inbox does not write activity.duplicate_of`, because `apply_inbox_field`
-- has no branch for that field and never did. The proposal was unacceptable in the
-- literal sense: there was no way for a person to say yes.
--
-- So the two activities stay unlinked, and until they are linked, **every reader that does
-- not group counts that walk twice** — the precise failure 7a exists to end. A de-duplication
-- system whose last step cannot be completed has not de-duplicated anything; it has only
-- moved the double-count into a queue and put a badge on it.
--
-- THE FIELD ALREADY EXISTED. 0195 routes joint-outing dedupe through `shared_group_id`,
-- `apply_inbox_field` has written it since, and every mileage reader counts one row per
-- `coalesce(shared_group_id, id)` (0140). `duplicate_of` was a new name for a decided
-- question — and inventing a field is how you end up proposing something nothing can accept.
--
-- Same shape as this phase's other faults: 0209's writes reported success and did nothing;
-- this one offered a choice that could not be made. Both were invisible until something
-- counted.

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
        -- PROPOSE `shared_group_id`, NOT `duplicate_of`.
        --
        -- This is the whole fix. The proposed value is the outing the existing recording
        -- already belongs to — its own group if it has one, otherwise itself — so accepting
        -- puts both recordings in one group and every reader counts the outing once
        -- (0140: one row per coalesce(shared_group_id, id)).
        --
        -- Both copies are kept. Neither is deleted and neither is "the loser": two
        -- recordings of one walk are two pieces of evidence for one outing, which is the
        -- distinction 0202 exists to make.
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
    (v_id, v_conn, p_provider, coalesce(p_origin,'unknown'), p_external_key, p_device,
     (v_disp = 'inserted'), case when p_external_key is not null then 'exact' else 'strong' end)
  on conflict do nothing;

  insert into public.ingest_items
    (run_id, artifact_id, entity_kind, external_key, event_at, disposition, reason)
  values (p_run, p_artifact, 'activity', p_external_key, p_date, v_disp, v_reason)
  returning id into v_item;

  update public.activity_sources set ingest_item_id = v_item
   where activity_id = v_id and ingest_item_id is null
     and provider = p_provider and coalesce(external_key,'') = coalesce(p_external_key,'');

  return jsonb_build_object('activity_id', v_id, 'disposition', v_disp, 'reason', v_reason);
end $function$;

-- ---------------------------------------------------------------------------
-- The proposals already raised, made acceptable.
-- ---------------------------------------------------------------------------
-- Erica's walk and the two from 0205/0206 are all pending against a field nothing can
-- write. Rewritten in place rather than withdrawn and re-raised: she has already seen these
-- cards, and a card that disappears and comes back is indistinguishable from a bug.
update public.suggestions s
   set field = 'shared_group_id',
       proposed_value = to_jsonb(coalesce(a.shared_group_id, a.id)),
       label = replace(s.label, 'Looks like the same outing as', 'The same outing as')
  from public.activities a
 where s.field = 'duplicate_of'
   and s.status = 'pending'
   and a.id = (s.proposed_value #>> '{}')::uuid;

-- ---------------------------------------------------------------------------
-- A run that created something must not report that it did nothing.
-- ---------------------------------------------------------------------------
-- `ok` counted only 'inserted' and 'attached', so the run that imported Erica's walk
-- recorded ok=0 failed=0 for one activity created and one proposal raised. The UI said "1
-- imported" while the ledger said nothing happened, and the ledger is what anybody would
-- read later. Anything that is not a failure is an item the run handled.
create or replace function public.finish_ingest_run(p_run uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.ingest_runs
     set status = 'finished', finished_at = now(),
         ok     = (select count(*) from public.ingest_items i
                    where i.run_id = p_run and i.disposition <> 'failed'),
         failed = (select count(*) from public.ingest_items i
                    where i.run_id = p_run and i.disposition = 'failed')
   where id = p_run;
$function$;

update public.ingest_runs r
   set ok = (select count(*) from public.ingest_items i
              where i.run_id = r.id and i.disposition <> 'failed'),
       failed = (select count(*) from public.ingest_items i
                  where i.run_id = r.id and i.disposition = 'failed')
 where r.status = 'finished';

comment on function public.ingest_activity is
  'The one door for bringing an activity in. Attaches evidence to an outing that already '
  'exists, creates one that does not, links a DIFFERENT person''s recording as a joint '
  'outing rather than merging it, and never changes who was on anything. When it thinks two '
  'recordings are one outing it proposes SHARED_GROUP_ID — the field the Inbox can actually '
  'write (0210) — because a proposal nobody can accept leaves the outing counted twice.';
