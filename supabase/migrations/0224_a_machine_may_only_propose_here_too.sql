-- 0224 — the two paths that still merged people's outings without asking.
--
-- §2 has said since it was written that a machine may only propose. Two paths never
-- complied, and Codex's review found both:
--
--   * `ingest_activity` Tier 3 — the importer itself, writing `shared_group_id` on two
--     rows the moment it thought two people had recorded one outing.
--   * `dedupe_shared_outings` (0033) — still invoked at the end of every Strava backfill,
--     on a 30-minute / 15% / 200m match, which is far looser than anything else here.
--
-- WHY THIS MATTERS MORE THAN A DUPLICATE NAME. Linking is what makes an outing count ONCE.
-- A wrong link does not add clutter — it silently deletes a day somebody actually had from
-- every total. That is the one kind of mistake this system is least able to notice.
--
-- And the groups grow. A match inherits the other row's existing group id, so links chain:
-- A-B, then C-B, then D-C. Measured on production before this migration:
--
--     40 shared groups
--      3 with no sibling at all
--      6 spanning more than an hour
--      1 spanning 12 hours 12 minutes
--
-- Both paths now raise the same card 0210/0221 built — two shapes, two owners, two answers.
-- Nothing they find is lost; it just stops being decided for her.
--
-- NOT DONE HERE, on purpose: the six long-spanning groups are left exactly as they are.
-- Unlinking is as much a decision as linking, and there is no card for it yet. They are
-- listed in §3e Step 1 and stay untrusted until a person looks.

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


-- ---------------------------------------------------------------------------
-- The OLD matcher stops writing too.
-- ---------------------------------------------------------------------------
-- `dedupe_shared_outings` (0033) is still called at the end of every Strava backfill. It
-- matched on a 30-minute window, 15% distance and 200 m, and then WROTE `shared_group_id`
-- on both rows. Its thresholds are far looser than anything else in this system, and
-- because a match inherits the other row's existing group id, groups grow transitively —
-- which is how one production group came to span **12 hours 12 minutes**.
--
-- Same matching, same return value, but it proposes now. Nothing it finds is lost; it
-- becomes a card with two shapes and two answers instead of a silent merge.
create or replace function public.dedupe_shared_outings()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count int := 0; r record; m record;
begin
  for r in
    select id, athlete_id, lat, lng, distance, start_date, owner_profile, name
      from activities
     where shared_group_id is null and lat is not null and start_date is not null
  loop
    select a2.id, a2.shared_group_id, a2.name, a2.start_date, a2.owner_profile into m
      from activities a2
     where a2.id <> r.id
       and a2.athlete_id is distinct from r.athlete_id
       and a2.lat is not null and a2.start_date is not null
       and abs(extract(epoch from (a2.start_date - r.start_date))) < 1800
       and abs(a2.distance - r.distance) <= 0.15 * greatest(r.distance, 1)
       and (6371000*acos(least(1, cos(radians(r.lat))*cos(radians(a2.lat))
             *cos(radians(a2.lng - r.lng)) + sin(radians(r.lat))*sin(radians(a2.lat))))) < 200
     order by abs(extract(epoch from (a2.start_date - r.start_date)))
     limit 1;

    if m.id is not null then
      insert into public.suggestions
        (subject_type, subject_id, field, current_value, proposed_value,
         label, source, confidence, evidence, group_key, rank, status)
      select 'activity', r.id, 'shared_group_id',
             to_jsonb(null::uuid), to_jsonb(coalesce(m.shared_group_id, m.id)),
             format('The same outing as "%s" — %s min apart',
                    coalesce(m.name,'(unnamed)'),
                    round(abs(extract(epoch from (m.start_date - r.start_date)))/60.0, 1)),
             'dedupe', 0.6,
             jsonb_build_object('kept', m.id, 'dropped', r.id, 'reason', 'joint outing',
                                'kept_name', m.name, 'dropped_name', r.name,
                                'minutes_apart', round(abs(extract(epoch from (m.start_date - r.start_date)))/60.0, 1)),
             'dedupe:' || r.id::text, 1, 'pending'
      where not exists (
        select 1 from public.suggestions s
         where s.group_key = 'dedupe:' || r.id::text and s.status = 'pending');
      if found then v_count := v_count + 1; end if;
    end if;
  end loop;
  return v_count;
end $function$;

comment on function public.dedupe_shared_outings is
  'Finds recordings by two different people that look like one outing and PROPOSES them '
  '(0224). It used to write shared_group_id outright on a 30-minute / 15% / 200m match, '
  'and because matches inherit an existing group id, groups grew transitively — one '
  'reached 12h12m. A bad link silently erases a day somebody had, so it is a person''s call.';

-- ---------------------------------------------------------------------------
-- A group of one is not a group.
-- ---------------------------------------------------------------------------
-- Three of the forty carry a shared_group_id with no sibling — the other member was
-- deleted, or the group id pointed at a row that no longer exists. Clearing them changes
-- no total (a lone row counts once either way, as coalesce(shared_group_id, id)) and stops
-- them being read as evidence that somebody reviewed something.
update public.activities a
   set shared_group_id = null
 where a.shared_group_id is not null
   and not exists (select 1 from public.activities b
                    where b.id <> a.id
                      and coalesce(b.shared_group_id, b.id) = coalesce(a.shared_group_id, a.id));
