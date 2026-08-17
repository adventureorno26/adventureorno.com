-- 0211 — accepting a library's worth of duplicates without pressing a button 184 times.
--
-- THE PROBLEM ARRIVES WITH THE RELOAD. 7a-8 says both of them must reload their activities
-- as files, because an outing evidenced only by Erica's Strava copy is one Josh cannot see —
-- 46 of the 219 he is tagged on are invisible to him today for exactly that reason.
--
-- But her Garmin library is the same outings Strava already has. Each file that matches
-- raises its own `shared_group_id` proposal (0210), and she has ~184 Strava activities. One
-- card per outing, one press per card, is not a review — it is a data-entry job, and the
-- predictable outcome is that she stops halfway and the rest stay double-counted. The
-- system would have been right about every single one and still failed.
--
-- WHAT THIS IS NOT. It is not a machine deciding. §2's rule stands: a machine may only
-- propose. She sees the cards, she sees the count, she presses once, and she can put it all
-- back with one Undo. What changes is the number of presses, not who decides.
--
-- SCOPED TO HER OWN OUTINGS ON PURPOSE. Only proposals on activities the caller OWNS are
-- accepted in bulk. Tier 2 only ever matches same-owner recordings, so this changes nothing
-- today — but "accept everything pending" is the kind of function that later gets pointed
-- at somebody else's data, and the scope belongs in the function rather than in the caller.

-- ---------------------------------------------------------------------------
-- Undo has to survive a bulk approval.
-- ---------------------------------------------------------------------------
-- `undo_approval` restored suggestions by the undo ROW's single group_key, which is right
-- for one card and silently wrong for many: everything would be reverted in the activities
-- but only one card would come back to pending, leaving the rest approved-but-not-applied.
-- Each payload element may now carry its own group_key; the row's key remains the fallback,
-- so every undo token written before today behaves exactly as it did.
create or replace function public.undo_approval(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.approval_undo%rowtype;
  v_e   jsonb;
  v_key text;
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
    v_key := coalesce(v_e ->> 'group_key', v_row.group_key);

    perform public.apply_inbox_field(
      v_e ->> 'subject_type', (v_e ->> 'subject_id')::uuid,
      v_e ->> 'field', v_e -> 'prev_value');

    delete from public.approved_fields
     where subject_type = v_e ->> 'subject_type'
       and subject_id = (v_e ->> 'subject_id')::uuid
       and field = v_e ->> 'field';

    update public.suggestions
       set status = 'pending', decided_by = null, decided_at = null
     where group_key = v_key
       and field = v_e ->> 'field'
       and status in ('approved', 'superseded');
    v_n := v_n + 1;
  end loop;

  update public.approval_undo set used_at = now() where id = p_token;
  return jsonb_build_object('ok', true, 'restored', v_n);
end $function$;

-- ---------------------------------------------------------------------------
-- What is waiting, so she can see the size of it before agreeing to it.
-- ---------------------------------------------------------------------------
create or replace function public.import_duplicates_pending()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'count', count(*),
    'earliest', min(a.start_date)::date,
    'latest',   max(a.start_date)::date)
    from public.suggestions s
    join public.activities a on a.id = s.subject_id
   where s.status = 'pending'
     and s.field = 'shared_group_id'
     and s.source = 'import'
     and s.subject_type = 'activity'
     and a.owner_profile = auth.uid();
$function$;

-- ---------------------------------------------------------------------------
-- One press.
-- ---------------------------------------------------------------------------
create or replace function public.approve_import_duplicates(p_limit int default 1000)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me    uuid := auth.uid();
  v_sug   record;
  v_prev  jsonb;
  v_undo  jsonb := '[]'::jsonb;
  v_token uuid;
  v_n     int := 0;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  for v_sug in
    select s.id, s.group_key, s.subject_id, s.field, s.proposed_value
      from public.suggestions s
      join public.activities a on a.id = s.subject_id
     where s.status = 'pending'
       and s.field = 'shared_group_id'
       and s.source = 'import'
       and s.subject_type = 'activity'
       and a.owner_profile = v_me
     order by a.start_date
     limit greatest(1, p_limit)
  loop
    v_prev := public.apply_inbox_field('activity', v_sug.subject_id, 'shared_group_id',
                                       v_sug.proposed_value);

    insert into public.approved_fields
      (subject_type, subject_id, field, value, approved_by, via)
    values ('activity', v_sug.subject_id, 'shared_group_id', v_sug.proposed_value, v_me, 'inbox-bulk')
    on conflict (subject_type, subject_id, field)
      do update set value = excluded.value, approved_by = excluded.approved_by,
                    approved_at = now(), via = excluded.via;

    update public.suggestions
       set status = 'approved', decided_by = v_me, decided_at = now()
     where id = v_sug.id;

    -- group_key travels WITH the element, which is what makes one Undo put every card back.
    v_undo := v_undo || jsonb_build_object(
      'subject_type', 'activity', 'subject_id', v_sug.subject_id,
      'field', 'shared_group_id', 'prev_value', v_prev,
      'suggestion_id', v_sug.id, 'group_key', v_sug.group_key);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    return jsonb_build_object('ok', true, 'linked', 0, 'undo_token', null);
  end if;

  insert into public.approval_undo (group_key, payload, created_by)
  values ('bulk:import-dup', v_undo, v_me)
  returning id into v_token;

  return jsonb_build_object('ok', true, 'linked', v_n, 'undo_token', v_token);
end $function$;

revoke all on function public.import_duplicates_pending() from public, anon;
revoke all on function public.approve_import_duplicates(int) from public, anon;
grant execute on function public.import_duplicates_pending() to authenticated;
grant execute on function public.approve_import_duplicates(int) to authenticated;

comment on function public.approve_import_duplicates is
  'Accepts every pending import duplicate proposal on the caller''s OWN activities in one '
  'press, with a single undo token that puts all of them back. A machine still only '
  'proposes (0211) — this changes how many times a person has to say yes, not who says it.';
