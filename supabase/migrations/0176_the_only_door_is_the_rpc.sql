-- 0176 — the RPCs are now the ONLY door into a visit.
--
-- 0163–0175 built the guarded writers and moved the browser onto them. The browser
-- could still ignore all of it: `authenticated` held INSERT, UPDATE and DELETE on
-- `visits` and on every table hanging off it, so any of the rules those functions
-- enforce — validated ranges, explicit participants, idempotency keys, refusing to
-- orphan a trip's contents — could be walked straight past with a direct write.
--
-- The 0170 triggers already hold whoever writes, which was the important half. This is
-- the other half: there is no longer a second way in.
--
-- `visit_evidence` is the clearest evidence for why. 0166 created it deliberately
-- read-only — `revoke all ... from public, anon; grant select ... to authenticated` —
-- and yet `authenticated` has held INSERT, UPDATE and DELETE on it ever since, because
-- Supabase's default ACL granted them at CREATE TABLE and the revoke never named
-- `authenticated`. The migration's stated intent silently did not happen. 0174 stopped
-- that for new tables; this closes the ones already standing.
--
-- ONE GAP HAD TO BE FILLED FIRST. `setVisitPeople` in the browser did
-- `delete where visit_id = ...` then `insert`, as two separate statements: a dropped
-- connection between them left a visit with NOBODY on it, silently. It is now one
-- atomic RPC, like `set_visit_participants` beside it.
--
-- WHAT STILL WRITES: the SECURITY DEFINER RPCs (they run as the owner), triggers, and
-- anything holding the service key. Nothing changes for them.
--
-- ROLLBACK: grant insert, update, delete on public.visits, public.visit_profiles,
-- public.visit_people, public.visit_evidence to authenticated;
-- drop function public.set_visit_people(uuid, uuid[]).

begin;

-- ---------------------------------------------------------------------------
-- 1. The one write path that had no RPC
-- ---------------------------------------------------------------------------
create or replace function public.set_visit_people(p_visit uuid, p_people uuid[])
returns void
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

  -- One statement each, one transaction: a dropped connection can no longer leave
  -- the visit with nobody on it.
  delete from public.visit_people
   where visit_id = p_visit
     and person_id <> all (coalesce(p_people, '{}'::uuid[]));

  insert into public.visit_people (visit_id, person_id)
  select p_visit, x from unnest(coalesce(p_people, '{}'::uuid[])) x
  on conflict do nothing;
end $function$;

comment on function public.set_visit_people(uuid, uuid[]) is
  'Replace the companions on a visit — children, pets, friends without accounts — '
  'atomically. The browser used to DELETE then INSERT as two statements, so a dropped '
  'connection between them emptied the visit.';

revoke all on function public.set_visit_people(uuid, uuid[]) from public, anon;
grant execute on function public.set_visit_people(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Close the direct door
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.visits           from authenticated;
revoke insert, update, delete on public.visit_profiles   from authenticated;
revoke insert, update, delete on public.visit_people     from authenticated;
revoke insert, update, delete on public.visit_evidence   from authenticated;

comment on table public.visits is
  'A visit: a place, a date or date range, who was there. WRITES GO THROUGH THE RPCs '
  '(create_visit, edit_visit, delete_visit, restore_visit, set_visit_*, '
  'attach_child_visit) — authenticated holds SELECT only, so the rules those functions '
  'enforce cannot be walked past with a direct write (§0.3).';

commit;
