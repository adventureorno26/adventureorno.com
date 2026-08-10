-- PHOTOS FROM THAT DAY.
--
-- Step 5. A photo suggestion is just a suggestion with subject_type='photo' and
-- field='visit_id', so it inherits approval, locking and undo for free — the whole
-- reason the ledger was built generically in 0148.
--
-- All 167 live photos are currently unpinned. The signal is the one the design names:
-- the same local date, near the place, not already on a visit. Approving PINS the
-- photo to that visit and KEEPS ITS REAL DATE — her rule, unchanged. `local_date` is
-- used rather than taken_at because a 9pm hike photo must not land on the next day.
--
-- These get their own cards (`group_key = 'visit:<id>'`) rather than being bolted onto
-- the activity cards: a visit is what a photo attaches to, one card can then offer the
-- whole day's photos at once, and activity naming stays untouched.

begin;

-- ---------------------------------------------------------------------------
-- 1. Propose photos for visits that have some.
-- ---------------------------------------------------------------------------
create or replace function public.propose_photos(p_limit int default 20)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_made int := 0;
  v_radius constant int := 5000;   -- ~5 km, per the design
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with candidate as (
    select
      ph.id                                   as photo_id,
      v.id                                    as visit_id,
      pl.name                                 as place_name,
      v.start_date                            as visit_date,
      ph.local_date                           as photo_date,
      round(st_distance(ph.geom, pl.geom))::int as distance_m,
      row_number() over (
        partition by ph.id
        order by st_distance(ph.geom, pl.geom)
      )                                       as best
    from public.photos ph
    join public.visits v
      on ph.local_date between v.start_date and coalesce(v.end_date, v.start_date)
    join public.places pl on pl.id = v.place_id
    where ph.deleted_at is null
      and ph.visit_id is null
      and ph.local_date is not null
      and ph.geom is not null
      and pl.geom is not null
      and st_dwithin(ph.geom, pl.geom, v_radius)
      -- Never re-ask about a photo whose home she has already decided.
      and public.may_autowrite('photo', ph.id, 'visit_id')
  ),
  chosen as (
    -- One proposal per photo: the NEAREST visit that day. Offering a photo to three
    -- visits at once is a question with no good answer.
    select * from candidate where best = 1 limit greatest(1, least(200, p_limit))
  ),
  ins as (
    insert into public.suggestions
      (subject_type, subject_id, field, current_value, proposed_value, label, source,
       confidence, evidence, group_key, rank)
    select
      'photo', c.photo_id, 'visit_id', null, to_jsonb(c.visit_id),
      'Add this photo to ' || coalesce(c.place_name, 'that visit'),
      'exif',
      -- Near and same-day is a strong signal, but it is still only a signal.
      greatest(0.4, least(0.95, 1 - (c.distance_m::numeric / (v_radius * 2)))),
      jsonb_build_object('distance_m', c.distance_m, 'local_date', c.photo_date,
                         'place', c.place_name),
      'visit:' || c.visit_id::text,
      c.distance_m
    from chosen c
    on conflict do nothing
    returning 1
  )
  select count(*) into v_made from ins;

  return jsonb_build_object('ok', true, 'proposed', v_made);
end
$function$;

revoke all on function public.propose_photos(int) from public, anon;
grant execute on function public.propose_photos(int) to authenticated;
grant execute on function public.propose_photos(int) to service_role;

comment on function public.propose_photos(int) is
  'Propose unpinned photos for the visit they were most likely taken on: same local '
  'date, within 5 km, nearest visit wins. Writes suggestions only.';

-- ---------------------------------------------------------------------------
-- 2. The Inbox has two shapes of card now.
-- ---------------------------------------------------------------------------
-- An activity card asks "what is this called". A visit card asks "are these your
-- photos". They are grouped the same way, so one query returns both; the group_key
-- prefix says which is which, and the subject is read from it rather than from the
-- rows (a photo card has many subjects — one per photo).
create or replace function public.inbox(p_limit int default 25, p_cursor timestamptz default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select coalesce(jsonb_agg(c.card order by c.newest desc), '[]'::jsonb)
  from (
    select
      g.group_key,
      max(g.created_at) as newest,
      split_part(g.group_key, ':', 1) as kind,
      nullif(split_part(g.group_key, ':', 2), '')::uuid as subject
    from public.suggestions g
    where g.status = 'pending'
      and (p_cursor is null or g.created_at < p_cursor)
    group by g.group_key
    order by max(g.created_at) desc
    limit greatest(1, least(100, p_limit))
  ) gk
  cross join lateral (
    select jsonb_build_object(
      'group_key',    gk.group_key,
      'subject_type', case when gk.kind = 'visit' then 'visit' else 'activity' end,
      'subject_id',   gk.subject::text,
      'created_at',   gk.newest,
      'activity',     case when gk.kind = 'activity' then (
                        select jsonb_build_object(
                                 'name', a.name, 'type', a.type, 'distance', a.distance,
                                 'start_date', a.start_date, 'place', p.name)
                          from public.activities a
                          left join public.places p on p.id = a.place_id
                         where a.id = gk.subject) end,
      'visit',        case when gk.kind = 'visit' then (
                        select jsonb_build_object(
                                 'place', p.name, 'start_date', v.start_date,
                                 'end_date', v.end_date)
                          from public.visits v
                          left join public.places p on p.id = v.place_id
                         where v.id = gk.subject) end,
      -- Naming-style options (one field, ranked choices).
      'fields',       coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', s.id::text, 'field', s.field, 'label', s.label,
                   'proposed', s.proposed_value, 'current', s.current_value,
                   'source', s.source, 'confidence', s.confidence,
                   'evidence', s.evidence, 'rank', s.rank)
                 order by s.field, s.rank)
          from public.suggestions s
         where s.group_key = gk.group_key and s.status = 'pending'
           and s.subject_type <> 'photo'), '[]'::jsonb),
      -- Photo candidates (many subjects, one per photo).
      'photos',       coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', s.id::text, 'photo_id', s.subject_id::text,
                   'confidence', s.confidence,
                   'distance_m', (s.evidence ->> 'distance_m')::int,
                   'local_date', s.evidence ->> 'local_date',
                   'taken_at', ph.taken_at)
                 order by (s.evidence ->> 'distance_m')::int)
          from public.suggestions s
          join public.photos ph on ph.id = s.subject_id
         where s.group_key = gk.group_key and s.status = 'pending'
           and s.subject_type = 'photo' and ph.deleted_at is null), '[]'::jsonb)
    ) as card, gk.newest
  ) c;
$function$;

revoke all on function public.inbox(int, timestamptz) from public, anon;
grant execute on function public.inbox(int, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Approving a card can now include photos.
-- ---------------------------------------------------------------------------
-- p_choices gains an optional "photos": ["<suggestion_id>", ...]. Still ONE
-- transaction: every chosen photo pinned, every one locked, the unchosen superseded,
-- one undo token for the lot.
create or replace function public.approve_card(p_group_key text, p_choices jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me      uuid := auth.uid();
  v_type    text;
  v_id      uuid;
  v_field   text;
  v_choice  jsonb;
  v_sug     public.suggestions%rowtype;
  v_value   jsonb;
  v_prev    jsonb;
  v_undo    jsonb := '[]'::jsonb;
  v_token   uuid;
  v_n       int := 0;
  v_photo   jsonb;
  v_chosen  uuid[] := '{}';
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if not exists (select 1 from public.suggestions where group_key = p_group_key) then
    raise exception 'no such card: %', p_group_key using errcode = '02000';
  end if;

  -- --- photos -------------------------------------------------------------
  if p_choices ? 'photos' then
    for v_photo in select * from jsonb_array_elements(p_choices -> 'photos') loop
      select * into v_sug from public.suggestions
       where id = (v_photo #>> '{}')::uuid
         and group_key = p_group_key
         and subject_type = 'photo'
         and status = 'pending';
      if not found then
        raise exception 'that photo is no longer on this card — reload it'
          using errcode = '40001';
      end if;

      v_prev := public.apply_inbox_field('photo', v_sug.subject_id, 'visit_id',
                                         v_sug.proposed_value);

      insert into public.approved_fields
        (subject_type, subject_id, field, value, approved_by, via)
      values ('photo', v_sug.subject_id, 'visit_id', v_sug.proposed_value, v_me, 'inbox')
      on conflict (subject_type, subject_id, field)
        do update set value = excluded.value, approved_by = excluded.approved_by,
                      approved_at = now(), via = excluded.via;

      update public.suggestions
         set status = 'approved', decided_by = v_me, decided_at = now()
       where id = v_sug.id;

      v_chosen := v_chosen || v_sug.id;
      v_undo := v_undo || jsonb_build_object(
        'subject_type', 'photo', 'subject_id', v_sug.subject_id, 'field', 'visit_id',
        'prev_value', v_prev, 'suggestion_id', v_sug.id);
      v_n := v_n + 1;
    end loop;

    -- The ones she did NOT tick are superseded, not rejected: she passed on them
    -- this time, she did not say the photo never belongs there.
    update public.suggestions
       set status = 'superseded', decided_by = v_me, decided_at = now()
     where group_key = p_group_key and subject_type = 'photo'
       and status = 'pending' and not (id = any(v_chosen));
  end if;

  -- --- named fields -------------------------------------------------------
  for v_field, v_choice in
    select * from jsonb_each(coalesce(p_choices, '{}'::jsonb)) loop
    if v_field = 'photos' then continue; end if;

    select subject_type, subject_id into v_type, v_id
      from public.suggestions
     where group_key = p_group_key and subject_type <> 'photo' limit 1;
    if v_type is null then continue; end if;

    if v_choice ? 'suggestion_id' then
      select * into v_sug from public.suggestions
       where id = (v_choice ->> 'suggestion_id')::uuid
         and group_key = p_group_key and status = 'pending';
      if not found then
        raise exception 'that option is no longer available — reload the card'
          using errcode = '40001';
      end if;
      v_value := v_sug.proposed_value;
    elsif v_choice ? 'value' then
      v_value := v_choice -> 'value';
      v_sug := null;
    else
      continue;
    end if;

    v_prev := public.apply_inbox_field(v_type, v_id, v_field, v_value);

    insert into public.approved_fields (subject_type, subject_id, field, value, approved_by, via)
    values (v_type, v_id, v_field, v_value, v_me, 'inbox')
    on conflict (subject_type, subject_id, field)
      do update set value = excluded.value, approved_by = excluded.approved_by,
                    approved_at = now(), via = excluded.via;

    update public.suggestions
       set status = case when v_sug.id is not null and id = v_sug.id then 'approved'
                         else 'superseded' end,
           decided_by = v_me, decided_at = now()
     where group_key = p_group_key and field = v_field and status = 'pending'
       and subject_type <> 'photo';

    v_undo := v_undo || jsonb_build_object(
      'subject_type', v_type, 'subject_id', v_id, 'field', v_field,
      'prev_value', v_prev, 'suggestion_id', v_sug.id);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'nothing was chosen' using errcode = '22023';
  end if;

  insert into public.approval_undo (group_key, payload, created_by)
  values (p_group_key, v_undo, v_me)
  returning id into v_token;

  return jsonb_build_object('ok', true, 'fields', v_n, 'undo_token', v_token);
end
$function$;

revoke all on function public.approve_card(text, jsonb) from public, anon;
grant execute on function public.approve_card(text, jsonb) to authenticated;

commit;
