-- Security: cron/maintenance SECURITY DEFINER functions should not be callable by
-- clients. They run from pg_cron / triggers (as the owner), so revoking EXECUTE
-- from authenticated + anon closes the ability for a signed-in user to trigger a
-- global purge / merge / dedupe / rebuild, without affecting their scheduled use.
-- (match_photo + ai-suggest were hardened in 0087; the app-facing read RPCs stay
-- granted — a fuller is_member() pass over those remains in the backlog.)

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname in (
        'purge_trash', 'cluster_unassigned', 'dedupe_joint_outings',
        'dedupe_shared_outings', 'merge_nearby_dupes', 'merge_places_auto',
        'rebuild_revealed_area', 'rebuild_place_visits', 'recompute_place_stats',
        'rls_auto_enable'
      )
  loop
    -- Revoke from PUBLIC too — functions grant EXECUTE to PUBLIC by default, so
    -- revoking only from authenticated/anon leaves the inherited grant in place.
    execute format('revoke execute on function %s from public, authenticated, anon', r.sig);
  end loop;
end $$;
