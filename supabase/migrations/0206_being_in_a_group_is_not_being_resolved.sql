-- 0206 — correcting 0205: sharing a group is not the same as not being a duplicate.
--
-- 0205 shipped and found NOTHING — zero proposals against a database that demonstrably
-- contains at least one duplicate. The 2026-03-07 pair is right there:
--
--   Purcellville to Arlington - Full WOD  ✕  Purcellville Trailhead - W&OD
--   same owner: true | 11 minutes apart | 0.4% difference | same shared_group: TRUE
--
-- It was skipped by 0205's own guard clause, which refused any pair already sharing a
-- `shared_group_id` on the reasoning that such a pair is "already understood to be one
-- outing".
--
-- THAT REASONING CONFUSES THE TWO THINGS THIS WHOLE PHASE EXISTS TO SEPARATE.
-- `shared_group_id` links recordings of ONE OUTING BY DIFFERENT PEOPLE so that counting
-- readers count it once — it is the joint-outing mechanism, and for a cross-person pair it
-- is the right answer and there is nothing to ask. For ONE PERSON'S OWN two recordings it
-- says nothing of the sort: it is the reason the pair is a duplicate, not the reason to
-- leave it alone. Erica's Strava copy and Erica's file copy of her own run are two
-- activities that should be one activity carrying two sources.
--
-- And the query was already same-person-only, so the clause could never do anything except
-- suppress exactly the cases it was meant to find. A zero result was the symptom; the
-- assumption underneath it was the bug.
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
        on b.owner_profile = a.owner_profile          -- SAME PERSON only. A different
       and b.id <> a.id                                -- person's recording is a joint
       and a.id < b.id                                 -- outing, never a duplicate.
       and coalesce(b.type,'') = coalesce(a.type,'')
       and abs(extract(epoch from (a.start_date - b.start_date))) <= 1800
       and (a.distance is null or b.distance is null
            or abs(a.distance - b.distance) <= greatest(160, greatest(a.distance,b.distance) * 0.02))
       and (a.geom is null or b.geom is null or st_dwithin(a.geom, b.geom, 400))
     where a.owner_profile is not null
       and a.start_date > now() - make_interval(days => p_days)
       -- NO shared_group_id EXCLUSION. See the note above: for one person's own pair that
       -- column is evidence FOR the duplicate, not against it.
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
   where not exists (
     select 1 from public.suggestions s
      where s.subject_type = 'activity'
        and s.subject_id = p.dup_id
        and s.field = 'duplicate_of'
        and s.proposed_value = to_jsonb(p.keep_id));

  get diagnostics v_n = row_count;
  return v_n;
end $function$;
