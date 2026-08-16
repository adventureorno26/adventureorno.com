-- 0197 — somebody finally reads cron.job_run_details.
--
-- `dedupe-joint-outings` succeeded every night up to 2026-08-08 and failed every night
-- from 2026-08-09 with `not authorized`. It was found on 2026-08-16 by a person looking,
-- eight nights later. Nothing was watching, and **a failed cron row looks like nothing at
-- all** — there is no page it breaks, no request that 500s, no user who complains. The
-- watchtower Worker probes URLs every 15 minutes and had no idea the database was running
-- anything at all.
--
-- This is the same lesson 0194 was written for, one layer down. 0194: a 200 from the wrong
-- server looks like success, so ask WHAT came back. Here: a job that is scheduled looks
-- like a job that is working, so ask WHETHER ITS LAST RUN SUCCEEDED.
--
-- WHY STALENESS IS MEASURED, NOT PARSED. A job can also fail by not running — pg_cron
-- silently stops a job whose database is unreachable, and a job nobody has triggered
-- since it was created has no failures either. There is no `next_run` in pg_cron and
-- parsing five-field cron expressions in SQL to compute one is a bug generator. Instead
-- the job's OWN HISTORY sets the expectation: the median gap between its recent runs,
-- doubled. A daily job tolerates ~48h, a quarter-hourly one ~30m, and nothing has to know
-- which is which. With fewer than three runs to learn from there is no median, so it
-- falls back to 25 hours — every job in this database is daily today.

create or replace function public.cron_health()
returns table (
  jobname       text,
  schedule      text,
  last_start    timestamptz,
  last_status   text,
  last_message  text,
  failures_24h  integer,
  ok            boolean,
  detail        text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with last_run as (
    select distinct on (r.jobid)
           r.jobid, r.start_time, r.status, r.return_message
      from cron.job_run_details r
     order by r.jobid, r.start_time desc
  ),
  -- The gap between consecutive runs, from the job's own history. This is what makes the
  -- staleness check schedule-agnostic.
  gaps as (
    select r.jobid,
           extract(epoch from (r.start_time - lag(r.start_time) over (partition by r.jobid
                                                                     order by r.start_time)))
             as secs
      from cron.job_run_details r
     where r.start_time > now() - interval '30 days'
  ),
  expected as (
    select jobid,
           percentile_cont(0.5) within group (order by secs) as median_secs,
           count(*) as gap_count
      from gaps
     where secs is not null
     group by jobid
  )
  select
    j.jobname::text,
    j.schedule::text,
    lr.start_time,
    lr.status::text,
    -- The message can be long and can carry a query in it; the first line is the error.
    left(split_part(coalesce(lr.return_message, ''), E'\n', 1), 200),
    (select count(*)::integer
       from cron.job_run_details d
      where d.jobid = j.jobid
        and d.status <> 'succeeded'
        and d.start_time > now() - interval '24 hours'),
    -- OK means: it has run, the last run succeeded, and it has run recently enough for
    -- its own rhythm. Any one of those failing is a failure.
    (lr.status = 'succeeded')
      and lr.start_time > now() - make_interval(secs =>
            coalesce(case when e.gap_count >= 3 then e.median_secs * 2 end, 90000)),
    case
      when lr.jobid is null then 'has never run'
      when lr.status <> 'succeeded' then
        lr.status || ': ' || left(split_part(coalesce(lr.return_message, ''), E'\n', 1), 160)
      when lr.start_time <= now() - make_interval(secs =>
             coalesce(case when e.gap_count >= 3 then e.median_secs * 2 end, 90000)) then
        'no run since ' || to_char(lr.start_time, 'YYYY-MM-DD HH24:MI')
        || ' — overdue for a job that normally runs every '
        || coalesce(round(e.median_secs / 3600)::text || 'h', 'day')
      else null
    end
  from cron.job j
  left join last_run lr on lr.jobid = j.jobid
  left join expected e  on e.jobid  = j.jobid
  where j.active
  order by j.jobname;
$function$;

-- The watchtower Worker calls this with the service key. No member needs it directly —
-- they see the result through service_status(), like every other probe.
revoke all on function public.cron_health() from public, anon, authenticated;
grant execute on function public.cron_health() to service_role;

comment on function public.cron_health() is
  'One row per active pg_cron job: did its last run succeed, and has it run recently '
  'enough for its own measured rhythm. Written because dedupe-joint-outings failed eight '
  'consecutive nights in silence — a failed cron row breaks no page and nobody complains, '
  'so it has to be asked about. Staleness comes from the median gap between the job''s own '
  'recent runs rather than from parsing its cron expression.';
