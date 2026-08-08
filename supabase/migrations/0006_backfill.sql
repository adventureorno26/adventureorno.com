-- 0006_backfill.sql — Phase 6: owner-triggered clustering
-- Numbered migration; NEVER edit after merge.

-- cluster_now(): owner-guarded wrapper so the UI can run the nightly clustering
-- job on demand after a backfill/import, instead of waiting for 03:00 ET.
create or replace function public.cluster_now()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'owner role required';
  end if;
  return public.cluster_unassigned();
end;
$$;

revoke all on function public.cluster_now() from public;
grant execute on function public.cluster_now() to authenticated;
