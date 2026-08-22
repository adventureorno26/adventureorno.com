-- 0270 — the frozen tables go, and step two is finished.
--
-- 0266 renamed `activity_profiles` and `visit_profiles` to `*_retired` rather than dropping
-- them, for one stated reason: *"the alternative means the only copy of 1,278 participations
-- is one I wrote this afternoon."* That reason has now expired, and it expired for a checkable
-- reason rather than because enough time passed.
--
-- WHAT HAD TO BE TRUE FIRST, and was checked before this was written:
--
--   1. The newest off-site backup predated the swap. Triggered one; it reports
--      `memory_people: 1278` and `memory_subjects: 1119`, 29,227 rows across 54 tables,
--      encrypted, uploaded. The independent copy exists — and because `backup-db.mjs`
--      enumerates `pg_tables`, that archive contains the retired tables too.
--   2. Nothing stored points at them. 0268 and 0269 rebound the one view and the one policy
--      that had followed the rename by OID, and each ended by asserting there were no others.
--      Re-asserted below rather than assumed, because the first two were also "obviously" the
--      only ones until `pg_depend` was asked.
--   3. The views and the frozen tables still hold identical rows — 623 and 655, no difference
--      in either direction — which is the last moment that comparison can be made at all.
--
-- After this the participation of every person in every memory lives in exactly one place:
-- `memory_people`, keyed by a subject and a person rather than by an activity and an account.
-- Which is the whole point: a person no longer needs an account to have been somewhere.
do $$
declare v text; n_a int; n_v int;
begin
  -- (2) nothing stored may still point at them
  select string_agg(distinct coalesce(cls.relname, dep.relname), ', ') into v
    from pg_depend d
    join pg_class ref on ref.oid = d.refobjid
    left join pg_policy pol on pol.oid = d.objid
    left join pg_class cls on cls.oid = pol.polrelid
    left join pg_rewrite rw on rw.oid = d.objid
    left join pg_class dep on dep.oid = rw.ev_class
   where ref.relname in ('activity_profiles_retired','visit_profiles_retired')
     and (pol.oid is not null or rw.oid is not null)
     and coalesce(cls.relname, dep.relname) not in
         ('activity_profiles_retired','visit_profiles_retired');
  if v is not null then
    raise exception 'NOT DROPPING: these still point at the frozen tables: %', v;
  end if;

  -- (3) and they still agree, which is the last chance to ask
  select count(*) into n_a from (
    (select activity_id, profile_id from public.activity_profiles_retired
     except select activity_id, profile_id from public.activity_profiles)
    union all
    (select activity_id, profile_id from public.activity_profiles
     except select activity_id, profile_id from public.activity_profiles_retired)) x;
  select count(*) into n_v from (
    (select visit_id, profile_id from public.visit_profiles_retired
     except select visit_id, profile_id from public.visit_profiles)
    union all
    (select visit_id, profile_id from public.visit_profiles
     except select visit_id, profile_id from public.visit_profiles_retired)) x;
  if n_a > 0 or n_v > 0 then
    raise exception 'NOT DROPPING: the view and the frozen table disagree (% outing, % visit)',
      n_a, n_v;
  end if;

  raise notice '0270: dropping the frozen tables — % outing and % visit rows, matched exactly',
    (select count(*) from public.activity_profiles_retired),
    (select count(*) from public.visit_profiles_retired);
end $$;

drop table public.activity_profiles_retired;
drop table public.visit_profiles_retired;
