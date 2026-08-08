-- 0120 — Complete the 0112 draft-entry privacy fix and restore the 0115 callback grant.
--
-- PostgreSQL RLS policies are permissive by default: matching policies are ORed.
-- The legacy entries_write policy was declared FOR ALL, so its editor/owner USING
-- expression also applied to SELECT and bypassed 0112's draft-aware entries_select
-- policy for editors. Split mutation access into operation-specific policies so
-- reads are governed only by entries_select.
--
-- consume_oauth_state is intentionally callable only by the Strava callback's
-- service-role client. Migration 0115 revoked PUBLIC execution but omitted the
-- corresponding service_role grant.
--
-- ROLLBACK (restores the pre-0120 behavior, including its known privacy defect):
--   drop policy if exists entries_insert on public.entries;
--   drop policy if exists entries_update on public.entries;
--   drop policy if exists entries_delete on public.entries;
--   create policy entries_write on public.entries for all
--     using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());
--   revoke execute on function public.consume_oauth_state(text, text) from service_role;

drop policy if exists entries_write on public.entries;
drop policy if exists entries_insert on public.entries;
drop policy if exists entries_update on public.entries;
drop policy if exists entries_delete on public.entries;

create policy entries_insert on public.entries
  for insert with check (public.is_editor_or_owner());
create policy entries_update on public.entries
  for update using (public.is_editor_or_owner())
  with check (public.is_editor_or_owner());
create policy entries_delete on public.entries
  for delete using (public.is_editor_or_owner());

grant execute on function public.consume_oauth_state(text, text) to service_role;
