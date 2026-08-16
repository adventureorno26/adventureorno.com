-- 0195 — the nightly de-duplicator proposes, and stops failing in silence.
--
-- TWO THINGS ARE WRONG, AND THE SECOND ONE HID THE FIRST.
--
-- 1. `dedupe-joint-outings` has failed EVERY NIGHT since 2026-08-09 with
--    "not authorized". It succeeded every night from 2026-07-25 to 2026-08-08; the
--    break is exactly when the "a machine may only propose" guard work landed.
--    `group_duplicate_activities` opens with `if not public.is_editor_or_owner()`,
--    and pg_cron has no `auth.uid()`, so the guard fires every time.
--
--    This is the discriminator from 0157 working correctly and catching the wrong
--    job. `auth.uid() is null for every machine job` is a good rule; the mistake was
--    applying an editor check to a function a machine is supposed to call. Nobody
--    noticed for eight nights because a failing cron row looks like nothing at all.
--
-- 2. And the job should not have been APPLYING anyway. It called the grouper with
--    p_apply => true, so a machine was writing `shared_group_id` on its own — the
--    same shape as §2's rule that a machine may only propose. Erica, 2026-08-16:
--    make it "propose, not apply".
--
-- WHAT THIS DOES NOT CHANGE: the grouping rule itself (same type, starts within 20
-- minutes, distance within 10%) and the fact that NOTHING IS DELETED. Grouping is
-- how one outing recorded three times counts once — Erica's 45-mile Purcellville
-- run was 134.7 miles until 0140. This migration changes WHO decides, not WHAT is
-- detected.
--
-- ROLLBACK: restore the three functions from 0142/0173/0188 and set the cron back to
-- calling dedupe_joint_outings(). No data is migrated here, so nothing to undo.

-- ---------------------------------------------------------------------------
-- 1. Reading candidates is not the same permission as applying them.
-- ---------------------------------------------------------------------------
-- Applying still requires an editor — it writes. READING the candidate list is a
-- query, and a machine job must be able to run it or it cannot propose anything.
-- The two are now separate checks rather than one check on the door.
create or replace function public.group_duplicate_activities(
  p_minutes int default 20,
  p_pct numeric default 0.10,
  p_apply boolean default false
)
returns table(kept uuid, dropped uuid, kept_name text, dropped_name text,
              minutes_apart numeric, pct_diff numeric, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_changed int;
begin
  -- WRITING is an editor's decision.
  if p_apply and not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- READING is open to a member, and to a machine job — which has no auth.uid() at
  -- all. That null is the discriminator (0157); it is not an anonymous caller,
  -- because anon holds no execute grant on this function (0162/0154).
  if not p_apply and auth.uid() is not null and not public.is_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Temp tables live until COMMIT, not until the function returns, so a second
  -- call inside one transaction used to fail with "relation _pairs already
  -- exists". Clear them first; the nightly job only calls once, but the review
  -- screen and the tests call repeatedly.
  drop table if exists _pairs;
  drop table if exists _edge;
  drop table if exists _comp;

  create temp table _pairs on commit drop as
  select
    case when (a.summary_polyline is not null) >= (b.summary_polyline is not null)
         then a.id else b.id end as keep_id,
    case when (a.summary_polyline is not null) >= (b.summary_polyline is not null)
         then b.id else a.id end as drop_id,
    round((abs(extract(epoch from (a.start_date - b.start_date)))/60)::numeric, 1) as mins,
    round((abs(a.distance - b.distance) / nullif(greatest(a.distance, b.distance),0) * 100)::numeric, 1) as pct,
    case when a.owner_profile is distinct from b.owner_profile then 'joint outing'
         when a.source is distinct from b.source              then 'same outing from two sources'
         else 'imported twice' end as why
  from public.activities a
  join public.activities b
    on a.id < b.id
   and a.type = b.type
   and a.distance > 0 and b.distance > 0
   and abs(extract(epoch from (a.start_date - b.start_date))) <= p_minutes * 60
   and abs(a.distance - b.distance) <= greatest(a.distance, b.distance) * p_pct;

  if p_apply then
    -- Undirected edge list, then relax every member to the smallest id it can reach.
    create temp table _edge on commit drop as
      select keep_id as a, drop_id as b from _pairs
      union all
      select drop_id as a, keep_id as b from _pairs;

    create temp table _comp on commit drop as
      select id, id as root from (select a as id from _edge union select b from _edge) s;

    -- Iterate to a fixed point. Bounded: each pass strictly lowers at least one
    -- root, and there are finitely many ids, so it terminates.
    loop
      update _comp c
         set root = least(c.root, o.root)
        from _edge e
        join _comp o on o.id = e.b
       where c.id = e.a
         and o.root < c.root;
      get diagnostics v_changed = row_count;
      exit when v_changed = 0;
    end loop;

    update public.activities t
       set shared_group_id = c.root
      from _comp c
     where t.id = c.id
       and t.shared_group_id is distinct from c.root;
  end if;

  return query
    select p.keep_id, p.drop_id, ka.name, da.name, p.mins, p.pct, p.why
      from _pairs p
      join public.activities ka on ka.id = p.keep_id
      join public.activities da on da.id = p.drop_id
     order by da.start_date;
end $function$;

-- ---------------------------------------------------------------------------
-- 2. The inbox has to be able to WRITE what the job proposes.
-- ---------------------------------------------------------------------------
-- `apply_inbox_field` raises on any type/field it does not know, so a suggestion it
-- cannot apply is one a person can look at and never accept. Adding the field here
-- is what makes the proposal actionable.
create or replace function public.apply_inbox_field(p_type text, p_id uuid, p_field text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  prev jsonb;
  old_place uuid;
  new_place uuid;
begin
  if p_type = 'activity' and p_field = 'name' then
    select to_jsonb(a.name) into prev from public.activities a where a.id = p_id;
    update public.activities set name = p_value #>> '{}' where id = p_id;

  elsif p_type = 'activity' and p_field = 'place_id' then
    select to_jsonb(a.place_id), a.place_id into prev, old_place
      from public.activities a where a.id = p_id;
    new_place := nullif(p_value #>> '{}', '')::uuid;
    update public.activities set place_id = new_place where id = p_id;
    -- Counts and visit islands are derived, so both ends must be rebuilt or the old
    -- place keeps a visit that no longer has anything in it.
    if old_place is not null then
      perform public.recompute_place_stats(old_place);
      perform public.rebuild_place_visits(old_place);
    end if;
    if new_place is not null then
      perform public.recompute_place_stats(new_place);
      perform public.rebuild_place_visits(new_place);
    end if;

  -- NEW (0195): accepting "these two are the same outing". Writing the group id is
  -- all it takes — every mileage reader already counts one row per
  -- coalesce(shared_group_id, id), which is what 0140 built.
  elsif p_type = 'activity' and p_field = 'shared_group_id' then
    select to_jsonb(a.shared_group_id) into prev from public.activities a where a.id = p_id;
    update public.activities
       set shared_group_id = nullif(p_value #>> '{}', '')::uuid
     where id = p_id;

  elsif p_type = 'place' and p_field = 'name' then
    select to_jsonb(p.name) into prev from public.places p where p.id = p_id;
    update public.places set name = p_value #>> '{}' where id = p_id;

  elsif p_type = 'place' and p_field = 'is_trail' then
    select to_jsonb(p.is_trail) into prev from public.places p where p.id = p_id;
    update public.places set is_trail = (p_value #>> '{}')::boolean where id = p_id;

  elsif p_type = 'visit' and p_field = 'place_id' then
    select to_jsonb(v.place_id) into prev from public.visits v where v.id = p_id;
    update public.visits set place_id = (p_value #>> '{}')::uuid where id = p_id;

  elsif p_type = 'visit' and p_field = 'is_trip' then
    select to_jsonb(v.trip_marked) into prev from public.visits v where v.id = p_id;
    update public.visits set trip_marked = (p_value #>> '{}')::boolean where id = p_id;

  elsif p_type = 'photo' and p_field = 'visit_id' then
    select to_jsonb(ph.visit_id) into prev from public.photos ph where ph.id = p_id;
    update public.photos set visit_id = nullif(p_value #>> '{}', '')::uuid where id = p_id;

  else
    raise exception 'the inbox does not write %.%', p_type, p_field using errcode = '22023';
  end if;

  return prev;
end
$function$;

-- ---------------------------------------------------------------------------
-- 3. The nightly job proposes.
-- ---------------------------------------------------------------------------
create or replace function public.dedupe_joint_outings()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n int;
begin
  -- p_apply => false. The machine looks; it does not write the answer.
  insert into public.suggestions (
    subject_type, subject_id, field,
    current_value, proposed_value,
    label, source, confidence, evidence,
    group_key, rank, status)
  select
    'activity',
    g.dropped,
    'shared_group_id',
    to_jsonb(da.shared_group_id),
    to_jsonb(least(g.kept, g.dropped)),
    format('Same outing as "%s" — %s min apart, %s%% difference in distance (%s)',
           g.kept_name, g.minutes_apart, g.pct_diff, g.reason),
    'dedupe',
    -- Closer in distance is more confident. Bounded to the column's 0..1 check.
    greatest(0::numeric, least(1::numeric, round(1 - (g.pct_diff / 100), 2))),
    jsonb_build_object(
      'kept', g.kept, 'dropped', g.dropped,
      'kept_name', g.kept_name, 'dropped_name', g.dropped_name,
      'minutes_apart', g.minutes_apart, 'pct_diff', g.pct_diff, 'reason', g.reason),
    'dedupe:' || least(g.kept, g.dropped)::text,
    1,
    'pending'
  from public.group_duplicate_activities(20, 0.10, false) g
  join public.activities da on da.id = g.dropped
  -- Already grouped: there is nothing to decide.
  where da.shared_group_id is distinct from least(g.kept, g.dropped)
    -- AND NOT ALREADY ASKED — whatever the answer was.
    --
    -- Deduplicating against pending-only would re-ask every rejected pair the next
    -- night, forever, and a question a person has already answered coming back is
    -- how an accepted decision gets quietly undone. Match on the subject and the
    -- proposal, not on the status.
    and not exists (
      select 1 from public.suggestions s
       where s.subject_type = 'activity'
         and s.subject_id   = g.dropped
         and s.field        = 'shared_group_id'
         and s.proposed_value = to_jsonb(least(g.kept, g.dropped))
    );

  get diagnostics v_n = row_count;
  return v_n;
end $function$;

comment on function public.dedupe_joint_outings() is
  'Nightly. PROPOSES that two records are one outing, into the suggestions ledger; '
  'it never writes shared_group_id itself (§2: a machine may only propose). Returns '
  'the number of NEW suggestions — pairs already grouped, or already asked about in '
  'any status, are not re-raised.';
