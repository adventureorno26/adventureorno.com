-- 0170 — the rules hold no matter which door the write comes through.
--
-- Three real defects, all found by reading 0163–0169 back critically.
--
-- 1. `accepted_visits` BYPASSES RLS. A Postgres view runs with its OWNER's permissions
--    unless `security_invoker` is set, and this one is owned by `postgres` with no
--    options — so `grant select … to authenticated` handed every authenticated caller
--    every visit row, straight past the `visits_select` policy. §0.4 warns about exactly
--    this: "Never assume RLS filters rows inside a definer function." The view was worse
--    than a definer function, because nothing in it even looked like a security
--    boundary.
--
-- 2. THE PARENT/CHILD RULES ONLY EXISTED INSIDE attach_child_visit. Any other writer —
--    a direct UPDATE, a future RPC, a fixup script — could set `parent_visit_id` to
--    anything at all: a visit outside the dates, one that is not a trip, another
--    person's visit, or a cycle. A rule enforced in one function is a convention; a rule
--    enforced by the database is a rule. §0.3 asks for constraints and guarded logic,
--    not guarded logic alone.
--
-- 3. A NOTE COULD NEVER BE CLEARED. `edit_visit` used `coalesce(p_note, note)`, so NULL
--    meant "leave it alone" and there was no way to say "delete what is there". Erica
--    would have deleted the text, pressed Save, and watched the old note come back —
--    which is precisely the shape of bug that has cost this project the most trust.
--
-- ROLLBACK: alter view public.accepted_visits set (security_invoker = false);
--           drop the two triggers and their functions;
--           recreate edit_visit from 0169.

begin;

-- ---------------------------------------------------------------------------
-- 1. The view stops bypassing RLS.
-- ---------------------------------------------------------------------------
alter view public.accepted_visits set (security_invoker = true);

comment on view public.accepted_visits is
  'Accepted, taken visits — the only rows historical statistics may count (§0.4). '
  'security_invoker = true: it filters through the CALLER''s RLS, not the owner''s. '
  'Without that it silently handed every authenticated caller every visit row.';

-- ---------------------------------------------------------------------------
-- 2. Parent/child rules, enforced by the database itself.
-- ---------------------------------------------------------------------------
create or replace function public.visits_check_parent()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_parent public.visits;
  v_cursor uuid;
  v_depth  int := 0;
begin
  if new.parent_visit_id is null then return new; end if;
  if new.parent_visit_id = new.id then
    raise exception 'a visit cannot contain itself';
  end if;

  select * into v_parent from public.visits where id = new.parent_visit_id;
  if v_parent.id is null then raise exception 'the trip this visit points at does not exist'; end if;

  if not public.counts_as_trip(v_parent.*) then
    raise exception 'a visit can only be grouped under an accepted, taken visit that qualifies as a trip';
  end if;
  if new.start_date < v_parent.start_date or new.end_date > v_parent.end_date then
    raise exception 'the visit falls outside the trip''s dates';
  end if;

  -- Everyone on the child must have been on the parent. Checked here as well as in
  -- the RPC, because this is the only place a direct UPDATE also has to pass.
  if exists (
    select 1 from public.visit_profiles c
     where c.visit_id = new.id
       and not exists (select 1 from public.visit_profiles p
                        where p.visit_id = new.parent_visit_id and p.profile_id = c.profile_id))
  then
    raise exception 'someone on that visit was not on the trip';
  end if;

  -- No cycles, bounded depth.
  v_cursor := v_parent.parent_visit_id;
  while v_cursor is not null and v_depth < 20 loop
    if v_cursor = new.id then raise exception 'that would make a loop'; end if;
    select parent_visit_id into v_cursor from public.visits where id = v_cursor;
    v_depth := v_depth + 1;
  end loop;
  if v_depth >= 20 then raise exception 'the trip nesting is too deep'; end if;

  return new;
end $function$;

revoke all on function public.visits_check_parent() from public, anon, authenticated;

drop trigger if exists visits_check_parent on public.visits;
create trigger visits_check_parent
  after insert or update of parent_visit_id, start_date, end_date on public.visits
  for each row execute function public.visits_check_parent();

-- The other direction: removing someone from a PARENT must not orphan a child's
-- participant. Without this, set_visit_participants on the parent could quietly leave a
-- child containing a person the trip no longer includes.
create or replace function public.visit_profiles_check_children()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare v_visit uuid := coalesce(old.visit_id, new.visit_id);
begin
  if exists (
    select 1
      from public.visits ch
      join public.visit_profiles cp on cp.visit_id = ch.id
     where ch.parent_visit_id = v_visit
       and not exists (select 1 from public.visit_profiles pp
                        where pp.visit_id = v_visit and pp.profile_id = cp.profile_id))
  then
    raise exception 'a visit grouped under this trip includes someone the trip would no longer include';
  end if;
  return null;
end $function$;

revoke all on function public.visit_profiles_check_children() from public, anon, authenticated;

drop trigger if exists visit_profiles_check_children on public.visit_profiles;
create constraint trigger visit_profiles_check_children
  after delete on public.visit_profiles
  deferrable initially deferred
  for each row execute function public.visit_profiles_check_children();

-- ---------------------------------------------------------------------------
-- 3. A note can be cleared.
-- ---------------------------------------------------------------------------
-- Dropped and recreated rather than overloaded: two edit_visit signatures differing
-- only by a trailing default is an ambiguity waiting to be called by the wrong one.
-- Nothing calls this yet — the frontend still writes directly — so dropping is safe.
drop function if exists public.edit_visit(uuid, date, date, text, boolean, text);

create or replace function public.edit_visit(
  p_visit      uuid,
  p_start      date default null,
  p_end        date default null,
  p_note       text default null,
  p_trip       boolean default null,
  p_status     text default null,
  -- NULL note + p_set_note = true means "clear it". Without this, `coalesce` makes a
  -- cleared note indistinguishable from an unmentioned one, and the old text comes back.
  p_set_note   boolean default false
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

  -- Coalesce first, THEN validate, so sending only one end of the range can never
  -- produce an inverted one (§0.6).
  v_row.start_date := coalesce(p_start, v_row.start_date);
  v_row.end_date   := coalesce(p_end,   v_row.end_date);
  if v_row.end_date < v_row.start_date then
    raise exception 'the end date is before the start date';
  end if;

  update public.visits
     set start_date  = v_row.start_date,
         end_date    = v_row.end_date,
         note        = case when p_set_note then nullif(btrim(coalesce(p_note, '')), '')
                            else coalesce(p_note, note) end,
         trip_marked = coalesce(p_trip, trip_marked),
         status      = coalesce(p_status, status),
         manual      = true
   where id = p_visit
  returning * into v_row;

  return v_row;
end $function$;

revoke all on function public.edit_visit(uuid, date, date, text, boolean, text, boolean)
  from public, anon;
grant execute on function public.edit_visit(uuid, date, date, text, boolean, text, boolean)
  to authenticated;

commit;
