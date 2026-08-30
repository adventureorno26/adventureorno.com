-- 0276 — `prune_service_health()` has existed since 0194 and has never once run.
--
-- 0194 wrote the function, wrote the reason above it — *"Keep the ledger from growing
-- without bound; a fortnight is plenty to see a pattern"* — and even revoked its grants
-- properly. It never scheduled it. Every other maintenance function in this database got a
-- `cron.schedule` line in the migration that created it: `rebuild-revealed-area` (0045),
-- `dedupe-joint-outings` (0079), `purge-trash` (0088), `cluster-nightly` (0003). This one
-- did not, and nothing else calls it — not `purge_trash`, not the watchtower Worker.
--
-- So it is the same shape as §7d's Strava finding and §6c's SECURITY DEFINER views: a lock
-- built and fitted nowhere. Found by asking production how big its tables are, not by
-- reading the code — `service_health` was 11,885 rows across 15 days, ~792/day, with the
-- oldest row already past the 14-day retention the function was written to enforce.
--
-- It is not urgent: at 792 rows/day this is a slow leak on a database whose largest table
-- is 17k rows, and nothing was breaking. It is worth fixing because an unbounded log is
-- only ever cheap until it isn't, and because the fix is the one line that was missed.
--
-- 04:40 UTC keeps it with the other nightly maintenance (04:20 dedupe, 04:30 purge) and
-- clear of 07:10's revealed-area rebuild.

begin;

-- cron.schedule upserts on the job name, which is what makes this replayable — the same
-- property 0045/0079/0088 rely on.
select cron.schedule(
  'prune-service-health',
  '40 4 * * *',
  $$select public.prune_service_health()$$
);

-- Clear the backlog that accumulated while nothing was calling it. This is the function's
-- own defined behaviour, run once now rather than waiting for 04:40 — and it only ever
-- touches health-check rows, never anything about where anyone has been.
select public.prune_service_health();

do $$
declare n int;
begin
  select count(*) into n from cron.job
   where jobname = 'prune-service-health' and active
     and command like '%prune_service_health%';
  if n <> 1 then
    raise exception 'prune-service-health is not scheduled and active (found %)', n;
  end if;

  -- Nothing older than the retention window may survive the call above. On a freshly
  -- replayed schema `service_health` is empty and this is trivially true.
  select count(*) into n from public.service_health
   where checked_at < now() - interval '14 days';
  if n <> 0 then
    raise exception '% service_health row(s) older than 14 days survived the prune', n;
  end if;
end $$;

commit;
