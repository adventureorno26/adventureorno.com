-- 0205 — the cross-source duplicates already in the data get PROPOSED, never merged.
--
-- 0203 stops new ones arriving. It does nothing about the ones already here, and the
-- clearest example is 2026-03-07:
--
--   Purcellville to Arlington - Full WOD  08:10:36  45.12mi  strava  owner Erica
--   Purcellville Trailhead - W&OD         08:21:57  44.93mi  file    owner Erica
--
-- One run of Erica's, recorded by two apps, sitting as two activities. Ten of the readers
-- that touch `activities` aggregate without grouping by `shared_group_id`, so that run is
-- counted twice by every one of them.
--
-- IT IS PROPOSED, NOT MERGED, and the reason is measured rather than cautious: those two
-- recordings start ELEVEN MINUTES TWENTY-ONE SECONDS apart while differing 0.4% in
-- distance. A window tight enough to be safe would miss it; a window wide enough to catch
-- it would sweep up genuinely separate outings — a morning run and an evening one at the
-- same trailhead look identical to any rule written in seconds and metres. §2 has said it
-- since the beginning: a machine may propose; only an accepted write changes history. 0195
-- already routes the joint-outing dedupe through `suggestions`, and this uses the same road.
--
-- CROSS-PERSON PAIRS ARE EXCLUDED. Two people recording one outing is a JOINT OUTING, not
-- a duplicate, and collapsing those is exactly what the old importer did.

create or replace function public.propose_source_duplicates(p_days integer default 3650)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n int := 0;
begin
  with pairs as (
    select
      a.id            as keep_id,
      b.id            as dup_id,
      a.name          as keep_name,
      round(abs(extract(epoch from (a.start_date - b.start_date))) / 60.0)::int as mins_apart,
      round((abs(coalesce(a.distance,0) - coalesce(b.distance,0))
             / nullif(greatest(a.distance, b.distance), 0) * 100)::numeric, 1) as pct_diff
      from public.activities a
      join public.activities b
        on b.owner_profile = a.owner_profile          -- SAME PERSON only
       and b.id <> a.id
       and a.id < b.id                                 -- each pair once
       and coalesce(b.type,'') = coalesce(a.type,'')
       and abs(extract(epoch from (a.start_date - b.start_date))) <= 1800
       and (a.distance is null or b.distance is null
            or abs(a.distance - b.distance) <= greatest(160, greatest(a.distance,b.distance) * 0.02))
       and (a.geom is null or b.geom is null or st_dwithin(a.geom, b.geom, 400))
     where a.owner_profile is not null
       and a.start_date > now() - make_interval(days => p_days)
       -- Already understood to be one outing? Then there is nothing to ask.
       and (a.shared_group_id is null or b.shared_group_id is null
            or a.shared_group_id <> b.shared_group_id)
  )
  insert into public.suggestions
    (subject_type, subject_id, field, current_value, proposed_value,
     label, source, confidence, evidence, group_key, rank, status)
  select
    'activity', p.dup_id, 'duplicate_of',
    to_jsonb(null::uuid), to_jsonb(p.keep_id),
    format('Looks like the same outing as "%s" — %s min apart, %s%% difference in distance',
           coalesce(p.keep_name,'(unnamed)'), p.mins_apart, p.pct_diff),
    'import', 0.7,
    jsonb_build_object('kept', p.keep_id, 'duplicate', p.dup_id,
                       'minutes_apart', p.mins_apart, 'pct_diff', p.pct_diff),
    'import-dup:' || least(p.keep_id, p.dup_id)::text, 1, 'pending'
    from pairs p
   -- NOT ALREADY ASKED, whatever the answer was. Re-asking a question a person has already
   -- answered is how an accepted decision gets quietly undone (0195 learned this).
   where not exists (
     select 1 from public.suggestions s
      where s.subject_type = 'activity'
        and s.subject_id = p.dup_id
        and s.field = 'duplicate_of'
        and s.proposed_value = to_jsonb(p.keep_id));

  get diagnostics v_n = row_count;
  return v_n;
end $function$;

revoke all on function public.propose_source_duplicates(integer) from public, anon;
grant execute on function public.propose_source_duplicates(integer) to authenticated, service_role;

comment on function public.propose_source_duplicates(integer) is
  'Finds one person''s own outing recorded twice by different apps and PROPOSES the merge. '
  'Same person only — two people recording one outing is a joint outing, not a duplicate.';
