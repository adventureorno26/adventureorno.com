-- 0167 — §0.8 phase 3 (BACKFILL). Every activity finds the visit it happened on.
--
-- §0.3: "Add activities.visit_id and link an activity to the accepted visit it occurred
-- during. Routes, photos, entries and notes displayed on a visit card must be selected
-- by visit identity, not merely by an overlapping date."
--
-- 0164 added the column. All 445 existing activities still have it NULL, so today a
-- visit card can only find its routes by date arithmetic — which is precisely the
-- inference §0.1 forbids and the reason a trail and its section both claim the same
-- outing.
--
-- THE MATCH, and it is deliberately narrow: an activity belongs to the accepted, taken
-- visit AT THE SAME PLACE whose date range covers the activity's LOCAL day. Same place,
-- covering dates, accepted. Nothing else.
--
--   * local_date, not start_date — an evening outing is stored in UTC and rolls to
--     tomorrow west of Greenwich (§8). Matching on the UTC date would file Erica's
--     evening runs under the wrong day.
--   * EXACTLY ONE candidate, or it is not matched. If two accepted visits at one place
--     both cover the day, the honest answer is "a person must decide", and the row goes
--     to `activity_visit_review`. That is the same refuse-and-review rule 0165 uses for
--     ambiguous participants, and it matters here because the 78 known trail/member
--     duplicate pairs are exactly the shape that produces two candidates.
--
-- Idempotent: only NULL visit_id rows are considered, so re-running is a no-op. It never
-- overwrites a link a person or an RPC already made.
--
-- ROLLBACK: update public.activities set visit_id = null where source <> 'manual';
--           drop table public.activity_visit_review;

begin;

create table if not exists public.activity_visit_review (
  activity_id uuid primary key references public.activities(id) on delete cascade,
  reason      text not null,
  candidates  integer not null default 0,
  noted_at    timestamptz not null default now()
);

comment on table public.activity_visit_review is
  'Activities whose visit could not be determined without guessing (§0.3). A person '
  'decides. Usually the trail/section duplicate shape: two accepted visits cover the '
  'same day at the same place.';

alter table public.activity_visit_review enable row level security;
drop policy if exists activity_visit_review_read on public.activity_visit_review;
create policy activity_visit_review_read on public.activity_visit_review
  for select using (public.is_owner());

revoke all on public.activity_visit_review from public, anon;
grant select on public.activity_visit_review to authenticated;

do $$
declare
  v_linked   int := 0;
  v_review   int := 0;
  v_orphan   int := 0;
begin
  -- 1. Unambiguous: exactly one accepted visit at this place covers the local day.
  with candidate as (
    select a.id as activity_id,
           (array_agg(v.id order by v.start_date))[1] as visit_id,
           count(*) as n
      from public.activities a
      join public.visits v
        on v.place_id = a.place_id
       and v.status = 'taken'
       and v.accepted_at is not null
       and coalesce(a.local_date, a.start_date::date)
             between v.start_date and coalesce(v.end_date, v.start_date)
     where a.visit_id is null
       and a.place_id is not null
       and coalesce(a.local_date, a.start_date::date) is not null
     group by a.id
  )
  update public.activities a
     set visit_id = c.visit_id
    from candidate c
   where a.id = c.activity_id and c.n = 1;
  get diagnostics v_linked = row_count;

  -- 2. Ambiguous: more than one accepted visit covers the day. Do not choose.
  with candidate as (
    select a.id as activity_id, count(*) as n
      from public.activities a
      join public.visits v
        on v.place_id = a.place_id
       and v.status = 'taken'
       and v.accepted_at is not null
       and coalesce(a.local_date, a.start_date::date)
             between v.start_date and coalesce(v.end_date, v.start_date)
     where a.visit_id is null
       and a.place_id is not null
     group by a.id
    having count(*) > 1
  )
  insert into public.activity_visit_review (activity_id, reason, candidates)
  select c.activity_id, 'more than one accepted visit covers this day at this place', c.n
    from candidate c
  on conflict (activity_id) do nothing;
  get diagnostics v_review = row_count;

  -- 3. No candidate at all — an activity at a place with no accepted visit covering it.
  --    Left alone and counted, not invented into existence.
  select count(*) into v_orphan
    from public.activities a
   where a.visit_id is null
     and not exists (select 1 from public.activity_visit_review r where r.activity_id = a.id);

  raise notice 'ACTIVITY→VISIT: % linked, % sent for review, % with no covering visit',
    v_linked, v_review, v_orphan;
end $$;

-- Every link that now exists is also evidence for that visit (§0.3).
insert into public.visit_evidence (visit_id, evidence_type, evidence_id, evidence_date)
select a.visit_id, 'activity', a.id, coalesce(a.local_date, a.start_date::date)
  from public.activities a
 where a.visit_id is not null
on conflict do nothing;

commit;
