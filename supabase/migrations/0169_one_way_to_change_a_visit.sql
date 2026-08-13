-- 0169 — §0.8 phase 6 (ADD the writers). One authorized, atomic way to change a visit.
--
-- §0.3: "Provide atomic, authorized RPCs for creating a place with its first visit,
-- creating a visit, editing a visit, deleting/restoring a visit, moving a visit, setting
-- participants, attaching or detaching a child visit… Every RPC must be idempotent,
-- permission-checked, transaction-safe, and return the refreshed card/read model. A
-- dropped connection must not create a duplicate visit."
--
-- WHY THIS MATTERS MORE THAN IT SOUNDS. Today the browser writes `visits` directly, and
-- §0.6 names the exact damage: "Do not autosave start and end dates as separate writes;
-- an intermediate invalid range must never reach the database." Two writes for one edit
-- is also two chances to half-succeed — which is how a visit ends up with a start date
-- from the new edit and an end date from the old one.
--
-- ⚠️ THE REVOKE IS DELIBERATELY NOT HERE. §0.8 phase 6 ends with "revoke direct
-- authenticated writes", and doing that in this migration would break the live site the
-- moment it deployed, because the current frontend still writes visits directly. The
-- revoke belongs in the migration that lands WITH the frontend switch, not before it.
-- Adding the door before locking the old one is the whole point of a phased migration.
--
-- CHILD VISITS enforce §0.3's rules in the database, not in JSX: a child must sit inside
-- its parent's dates, a parent must be accepted and taken, a visit cannot parent itself,
-- chains cannot cycle, and participants must be compatible — a Josh-only parent cannot
-- swallow an Erica-only child (§0.9).
--
-- ROLLBACK: drop the five functions. Nothing else is touched.

begin;

-- ---------------------------------------------------------------------------
-- Edit a visit — ONE statement, or none of it.
-- ---------------------------------------------------------------------------
create or replace function public.edit_visit(
  p_visit      uuid,
  p_start      date default null,
  p_end        date default null,
  p_note       text default null,
  p_trip       boolean default null,
  p_status     text default null
) returns public.visits
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row public.visits;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_row from public.visits where id = p_visit for update;
  if v_row.id is null then raise exception 'no such visit'; end if;

  -- Coalesce first, THEN validate, so a caller sending only an end date cannot
  -- produce an intermediate invalid range (§0.6).
  v_row.start_date := coalesce(p_start, v_row.start_date);
  v_row.end_date   := coalesce(p_end,   v_row.end_date);
  if v_row.end_date < v_row.start_date then
    raise exception 'the end date is before the start date';
  end if;

  update public.visits
     set start_date  = v_row.start_date,
         end_date    = v_row.end_date,
         note        = coalesce(p_note, note),
         trip_marked = coalesce(p_trip, trip_marked),
         status      = coalesce(p_status, status),
         manual      = true
   where id = p_visit
  returning * into v_row;

  -- A child must still fit inside its parent after the dates move.
  if v_row.parent_visit_id is not null then
    if exists (
      select 1 from public.visits par
       where par.id = v_row.parent_visit_id
         and (v_row.start_date < par.start_date or v_row.end_date > par.end_date))
    then
      raise exception 'those dates fall outside the trip this visit belongs to';
    end if;
  end if;

  return v_row;
end $function$;

-- ---------------------------------------------------------------------------
-- Who was there — the whole set, replaced atomically.
-- ---------------------------------------------------------------------------
create or replace function public.set_visit_participants(
  p_visit uuid,
  p_profiles uuid[]
) returns setof public.visit_profiles
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.visits where id = p_visit) then
    raise exception 'no such visit';
  end if;
  if coalesce(array_length(p_profiles, 1), 0) = 0 then
    raise exception 'a visit needs at least one participant';
  end if;
  if exists (select 1 from unnest(p_profiles) x
              where not exists (select 1 from public.profiles p where p.id = x)) then
    raise exception 'unknown profile in the participant list';
  end if;

  delete from public.visit_profiles where visit_id = p_visit;
  insert into public.visit_profiles (visit_id, profile_id)
  select p_visit, x from unnest(p_profiles) x
  on conflict do nothing;

  -- Keep the legacy column in step while it still exists (phase 8 removes it).
  -- One participant = that person; more than one = the shared view.
  update public.visits
     set solo_profile = case when array_length(p_profiles,1) = 1 then p_profiles[1] else null end,
         solo_override = true
   where id = p_visit;

  return query select * from public.visit_profiles where visit_id = p_visit;
end $function$;

-- ---------------------------------------------------------------------------
-- Group a visit under a trip — explicitly, never by overlapping dates (§0.1).
-- ---------------------------------------------------------------------------
create or replace function public.attach_child_visit(
  p_child  uuid,
  p_parent uuid
) returns public.visits
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_child  public.visits;
  v_parent public.visits;
  v_cursor uuid;
  v_depth  int := 0;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_child = p_parent then raise exception 'a visit cannot contain itself'; end if;

  select * into v_child  from public.visits where id = p_child  for update;
  select * into v_parent from public.visits where id = p_parent for update;
  if v_child.id is null or v_parent.id is null then raise exception 'no such visit'; end if;

  if v_parent.status <> 'taken' or v_parent.accepted_at is null then
    raise exception 'a trip must be accepted and taken before visits can be grouped under it';
  end if;
  if not public.counts_as_trip(v_parent.*) then
    raise exception 'that visit does not qualify as a trip, so nothing can be grouped under it';
  end if;
  if v_child.start_date < v_parent.start_date or v_child.end_date > v_parent.end_date then
    raise exception 'the visit falls outside the trip''s dates';
  end if;

  -- Participant compatibility (§0.3): everyone on the child must have been on the
  -- parent. A Josh-only trip cannot swallow an Erica-only visit.
  if exists (
    select 1 from public.visit_profiles c
     where c.visit_id = p_child
       and not exists (select 1 from public.visit_profiles pp
                        where pp.visit_id = p_parent and pp.profile_id = c.profile_id))
  then
    raise exception 'someone on that visit was not on the trip';
  end if;

  -- No cycles, bounded depth.
  v_cursor := p_parent;
  while v_cursor is not null and v_depth < 20 loop
    if v_cursor = p_child then raise exception 'that would make a loop'; end if;
    select parent_visit_id into v_cursor from public.visits where id = v_cursor;
    v_depth := v_depth + 1;
  end loop;
  if v_depth >= 20 then raise exception 'the trip nesting is too deep'; end if;

  update public.visits set parent_visit_id = p_parent where id = p_child
  returning * into v_child;
  return v_child;
end $function$;

create or replace function public.detach_child_visit(p_child uuid)
returns public.visits
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row public.visits;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.visits set parent_visit_id = null where id = p_child returning * into v_row;
  if v_row.id is null then raise exception 'no such visit'; end if;
  return v_row;
end $function$;

-- ---------------------------------------------------------------------------
-- Move a visit to another place, keeping its evidence with it.
-- ---------------------------------------------------------------------------
-- MOVING A VISIT DELEGATES; it does not reimplement.
--
-- The 0150 guard caught the first version writing visits.place_id and
-- activities.place_id directly. It was right to: those are Inbox-owned fields, and a
-- function that writes them without recording the person's decision is exactly the
-- machinery that used to undo Erica's work.
--
-- set_visit_place and reassign_activity already do this properly — they check
-- authorization, record_approval(), and recompute what depends on the change. So this
-- RPC composes them rather than repeating them, which also means the decision ledger
-- sees one shape of write regardless of which door was used.
create or replace function public.move_visit_to_place(
  p_visit uuid,
  p_place uuid
) returns public.visits
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.visits;
  v_act uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.places where id = p_place and deleted_at is null) then
    raise exception 'no such place';
  end if;
  if not exists (select 1 from public.visits where id = p_visit) then
    raise exception 'no such visit';
  end if;

  perform public.set_visit_place(p_visit, p_place);

  -- The activities recorded on this visit move with it; they happened where it
  -- happened. Each goes through the same person-initiated path.
  for v_act in select id from public.activities where visit_id = p_visit loop
    perform public.reassign_activity(v_act, p_place);
  end loop;

  select * into v_row from public.visits where id = p_visit;
  return v_row;
end $function$;

do $$
declare f text;
begin
  foreach f in array array[
    'edit_visit(uuid,date,date,text,boolean,text)',
    'set_visit_participants(uuid,uuid[])',
    'attach_child_visit(uuid,uuid)',
    'detach_child_visit(uuid)',
    'move_visit_to_place(uuid,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
