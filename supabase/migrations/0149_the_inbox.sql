-- THE INBOX — one card, one button, and the decision is permanent.
--
-- Erica: "this could be the recent activities page too". It is the same screen: what
-- happened recently, and what the machine would like to call it.
--
-- The contract this file exists to keep is that APPROVING IS ATOMIC. A half-approved
-- card — the name written but the lock missing, or the lock written but the name not —
-- is exactly the class of inconsistency that produced every naming bug so far. So
-- approve_card does all of it in one transaction or none of it.
--
-- Note on skip: there is deliberately NO skip_card RPC. Skipping writes nothing by
-- definition, so it is handled in the client by dropping the card from the list; the
-- card returns on the next load. An RPC that does nothing would just be a thing to
-- maintain. See docs/INGEST-BUILD-PLAN.md step 3.

begin;

-- ---------------------------------------------------------------------------
-- 1. Undo. Every approval is reversible.
-- ---------------------------------------------------------------------------
-- The design promises undo by snackbar immediately AND reversibility later. Both need
-- the PRIOR values kept somewhere, because the lock is what stops a machine putting
-- them back — clearing the lock alone would not restore anything.
create table if not exists public.approval_undo (
  id         uuid primary key default gen_random_uuid(),
  group_key  text not null,
  payload    jsonb not null,   -- [{subject_type, subject_id, field, prev_value, suggestion_id}]
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
create index if not exists approval_undo_recent_idx on public.approval_undo (created_at desc);

alter table public.approval_undo enable row level security;
drop policy if exists approval_undo_select on public.approval_undo;
create policy approval_undo_select on public.approval_undo
  for select using (public.is_member());
revoke all on table public.approval_undo from public, anon;
grant select on table public.approval_undo to authenticated;
grant all on table public.approval_undo to service_role;

-- ---------------------------------------------------------------------------
-- 2. Writing one Inbox-owned field, generically but not dynamically.
-- ---------------------------------------------------------------------------
-- An explicit CASE rather than dynamic SQL: the set of fields the Inbox may write is
-- small, fixed, and worth stating out loud. Anything else raises rather than guessing.
-- Returns the PREVIOUS value so the caller can build an undo record.
create or replace function public.apply_inbox_field(
  p_type text, p_id uuid, p_field text, p_value jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  prev jsonb;
  old_place uuid;
  new_place uuid;
begin
  if p_type = 'activity' and p_field = 'name' then
    select to_jsonb(a.name) into prev from public.activities a where a.id = p_id;
    update public.activities set name = p_value #>> '{}' where id = p_id;

  elsif p_type = 'activity' and p_field = 'place_id' then
    select to_jsonb(a.place_id), a.place_id into prev, old_place
      from public.activities a where a.id = p_id;
    new_place := nullif(p_value #>> '{}', '')::uuid;
    update public.activities set place_id = new_place where id = p_id;
    -- Counts and visit islands are derived, so both ends must be rebuilt or the old
    -- place keeps a visit that no longer has anything in it.
    if old_place is not null then
      perform public.recompute_place_stats(old_place);
      perform public.rebuild_place_visits(old_place);
    end if;
    if new_place is not null then
      perform public.recompute_place_stats(new_place);
      perform public.rebuild_place_visits(new_place);
    end if;

  elsif p_type = 'place' and p_field = 'name' then
    select to_jsonb(p.name) into prev from public.places p where p.id = p_id;
    update public.places set name = p_value #>> '{}' where id = p_id;

  elsif p_type = 'place' and p_field = 'is_trail' then
    select to_jsonb(p.is_trail) into prev from public.places p where p.id = p_id;
    update public.places set is_trail = (p_value #>> '{}')::boolean where id = p_id;

  elsif p_type = 'visit' and p_field = 'place_id' then
    select to_jsonb(v.place_id) into prev from public.visits v where v.id = p_id;
    update public.visits set place_id = (p_value #>> '{}')::uuid where id = p_id;

  elsif p_type = 'visit' and p_field = 'is_trip' then
    select to_jsonb(v.is_trip) into prev from public.visits v where v.id = p_id;
    update public.visits set is_trip = (p_value #>> '{}')::boolean where id = p_id;

  elsif p_type = 'photo' and p_field = 'visit_id' then
    select to_jsonb(ph.visit_id) into prev from public.photos ph where ph.id = p_id;
    update public.photos set visit_id = nullif(p_value #>> '{}', '')::uuid where id = p_id;

  else
    raise exception 'the inbox does not write %.%', p_type, p_field using errcode = '22023';
  end if;

  return prev;
end
$function$;

revoke all on function public.apply_inbox_field(text, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. inbox() — the cards.
-- ---------------------------------------------------------------------------
create or replace function public.inbox(p_limit int default 25, p_cursor timestamptz default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- House rule: a SECURITY DEFINER read RPC bypasses RLS, so it states the membership
  -- check itself rather than relying on the caller having been checked elsewhere.
  select public.assert_member();

  select coalesce(jsonb_agg(c.card order by c.newest desc), '[]'::jsonb)
  from (
    -- Note: array_agg(...)[1], not min(). Every row in a group shares one subject, but
    -- PostgreSQL has no min() for uuid, and this is the group's subject either way.
    select
      g.group_key,
      max(g.created_at)                as newest,
      (array_agg(g.subject_type))[1]   as subject_type,
      (array_agg(g.subject_id))[1]     as subject_id
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
      'subject_type', gk.subject_type,
      'subject_id',   gk.subject_id::text,
      'created_at',   gk.newest,
      'activity',     case when gk.subject_type = 'activity' then (
                        select jsonb_build_object(
                                 'name', a.name, 'type', a.type, 'distance', a.distance,
                                 'start_date', a.start_date, 'place', p.name)
                          from public.activities a
                          left join public.places p on p.id = a.place_id
                         where a.id = gk.subject_id) end,
      'fields',       (
        select jsonb_agg(
                 jsonb_build_object(
                   'id',         s.id::text,
                   'field',      s.field,
                   'label',      s.label,
                   'proposed',   s.proposed_value,
                   'current',    s.current_value,
                   'source',     s.source,
                   'confidence', s.confidence,
                   'evidence',   s.evidence,
                   'rank',       s.rank)
                 order by s.field, s.rank)
          from public.suggestions s
         where s.group_key = gk.group_key and s.status = 'pending')
    ) as card, gk.newest
  ) c;
$function$;

comment on function public.inbox(int, timestamptz) is
  'Pending review cards, newest first. One card = one subject, its proposed fields ranked.';

create or replace function public.inbox_counts()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select jsonb_build_object(
    'cards',       (select count(distinct group_key) from public.suggestions where status = 'pending'),
    'suggestions', (select count(*) from public.suggestions where status = 'pending'));
$function$;

-- ---------------------------------------------------------------------------
-- 4. approve_card() — ONE transaction, or nothing.
-- ---------------------------------------------------------------------------
-- p_choices maps a field to what was chosen:
--   {"name": {"suggestion_id": "<uuid>"}}   pick one of the offered options
--   {"name": {"value": "Her own words"}}    type something else entirely
-- Either way the result is the same: the value is written AND locked, so no machine
-- proposes it again and no re-sync overwrites it.
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
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select subject_type, subject_id into v_type, v_id
    from public.suggestions where group_key = p_group_key limit 1;
  if v_type is null then
    raise exception 'no such card: %', p_group_key using errcode = '02000';
  end if;

  for v_field, v_choice in select * from jsonb_each(coalesce(p_choices, '{}'::jsonb)) loop
    if v_choice ? 'suggestion_id' then
      select * into v_sug from public.suggestions
       where id = (v_choice ->> 'suggestion_id')::uuid
         and group_key = p_group_key
         and status = 'pending';
      if not found then
        -- Stale card: the option is gone or already decided. Fail the WHOLE card
        -- rather than approve half of it.
        raise exception 'that option is no longer available — reload the card'
          using errcode = '40001';
      end if;
      v_value := v_sug.proposed_value;
    elsif v_choice ? 'value' then
      v_value := v_choice -> 'value';
      v_sug := null;
    else
      continue;  -- nothing chosen for this field
    end if;

    v_prev := public.apply_inbox_field(v_type, v_id, v_field, v_value);

    insert into public.approved_fields (subject_type, subject_id, field, value, approved_by, via)
    values (v_type, v_id, v_field, v_value, v_me, 'inbox')
    on conflict (subject_type, subject_id, field)
      do update set value = excluded.value, approved_by = excluded.approved_by,
                    approved_at = now(), via = excluded.via;

    -- The chosen one is approved; everything else offered for that field is
    -- superseded, NOT rejected — she didn't turn them down, she picked another.
    update public.suggestions
       set status = case when v_sug.id is not null and id = v_sug.id then 'approved' else 'superseded' end,
           decided_by = v_me, decided_at = now()
     where group_key = p_group_key and field = v_field and status = 'pending';

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

-- ---------------------------------------------------------------------------
-- 5. reject_suggestion() — never offer this again.
-- ---------------------------------------------------------------------------
create or replace function public.reject_suggestion(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- The row STAYS, with status 'rejected'. That is what the no-repeats index reads to
  -- stop the suggester offering it a second time.
  update public.suggestions
     set status = 'rejected', decided_by = auth.uid(), decided_at = now()
   where id = p_id and status = 'pending';
  if not found then
    raise exception 'no pending suggestion %', p_id using errcode = '02000';
  end if;
  return jsonb_build_object('ok', true);
end
$function$;

revoke all on function public.reject_suggestion(uuid) from public, anon;
grant execute on function public.reject_suggestion(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. undo_approval() — put it back, and unlock it.
-- ---------------------------------------------------------------------------
-- Restoring the value without clearing the lock would leave a record that no machine
-- may ever improve; clearing the lock without restoring the value would leave her
-- edit half-undone. Both, or it isn't undo.
create or replace function public.undo_approval(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.approval_undo%rowtype;
  v_e   jsonb;
  v_n   int := 0;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_row from public.approval_undo where id = p_token and used_at is null;
  if not found then
    raise exception 'nothing to undo' using errcode = '02000';
  end if;

  for v_e in select * from jsonb_array_elements(v_row.payload) loop
    perform public.apply_inbox_field(
      v_e ->> 'subject_type', (v_e ->> 'subject_id')::uuid,
      v_e ->> 'field', v_e -> 'prev_value');

    delete from public.approved_fields
     where subject_type = v_e ->> 'subject_type'
       and subject_id = (v_e ->> 'subject_id')::uuid
       and field = v_e ->> 'field';

    -- Back to pending so the card returns, exactly as it was.
    update public.suggestions
       set status = 'pending', decided_by = null, decided_at = null
     where group_key = v_row.group_key
       and field = v_e ->> 'field'
       and status in ('approved', 'superseded');
    v_n := v_n + 1;
  end loop;

  update public.approval_undo set used_at = now() where id = p_token;
  return jsonb_build_object('ok', true, 'restored', v_n);
end
$function$;

revoke all on function public.undo_approval(uuid) from public, anon;
grant execute on function public.undo_approval(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. clear_approval() — "actually, keep suggesting".
-- ---------------------------------------------------------------------------
create or replace function public.clear_approval(p_type text, p_id uuid, p_field text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.approved_fields
   where subject_type = p_type and subject_id = p_id and field = p_field;
  return jsonb_build_object('ok', true, 'cleared', found);
end
$function$;

revoke all on function public.clear_approval(text, uuid, text) from public, anon;
grant execute on function public.clear_approval(text, uuid, text) to authenticated;

-- Read RPCs follow the house rule: members only, never anon.
revoke all on function public.inbox(int, timestamptz) from public, anon;
grant execute on function public.inbox(int, timestamptz) to authenticated;
revoke all on function public.inbox_counts() from public, anon;
grant execute on function public.inbox_counts() to authenticated;

commit;
