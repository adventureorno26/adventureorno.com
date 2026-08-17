-- 0212 — 0211 wrote a `via` that the column does not allow.
--
-- `approved_fields.via` is a CHECK-constrained set: inbox | edit | rule | backfill. 0211
-- invented 'inbox-bulk' to record that the approval came from one press covering many
-- cards, and every call raised
--   23514: new row for relation "approved_fields" violates check constraint
-- so `approve_import_duplicates` could never approve anything.
--
-- Caught by running it rather than by reading it, which is the only reason it is being
-- fixed before it shipped instead of after — the same lesson as 0209 and 0210, arriving
-- from the other direction: those failed silently, this one failed loudly, and loud is
-- the cheap kind.
--
-- 'inbox' is also the RIGHT answer, not merely the permitted one. It IS the inbox; she read
-- the cards there and pressed a button there. That it covered many cards at once is
-- recorded where it belongs — `approval_undo.group_key = 'bulk:import-dup'` — rather than
-- by widening a closed vocabulary that four other things depend on.
--
-- 0211 is left exactly as applied. This repository does not edit an applied migration, for
-- the reason that makes the ledger worth having: a file that changes after it ran no longer
-- describes what any environment actually did.

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
    values ('activity', v_sug.subject_id, 'shared_group_id', v_sug.proposed_value, v_me, 'inbox')
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
