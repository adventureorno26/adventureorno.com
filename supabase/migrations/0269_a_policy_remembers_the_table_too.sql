-- 0269 — and so does a policy.
--
-- 0268 rebound `visible_activities`, which had followed the rename by OID and been reading a
-- frozen table. `0200_a_tag_is_not_a_key` then moved on to its next assertion and failed
-- there:
--
--     FAIL: the row policy disagrees with the view about a shared outing
--
-- Same cause, second place. A ROW POLICY is a stored expression tree, exactly like a view, so
-- `activities_select` — which has referenced `activity_profiles` since 0228 — followed the
-- rename too. `pg_depend` lists it three times, once per reference in the expression.
--
-- The lesson is worth the sentence it costs: **renaming a table moves every stored expression
-- that names it, silently.** A function is safe because it resolves names when it runs; a
-- view, a policy and a generated column are not. Both of the ones here were found by asking
-- `pg_depend` rather than by grepping for the name, which would have found the same two and
-- given no reason to believe there were only two.
--
-- The two policies on the retired tables themselves are left alone: nothing reads those
-- tables, they are dropped in the next migration, and a policy on a frozen backup is not a
-- rule anybody can reach.
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select
  using (
    public.is_member()
    and (
      lower(coalesce(original_source, '')) <> 'strava'
      or owner_profile = auth.uid()
      or exists (
           select 1
             from public.activity_profiles ap
             join public.profiles ow on ow.id = activities.owner_profile
            where ap.activity_id = activities.id
              and ap.profile_id = auth.uid()
              and coalesce(ap.claim_status, 'accepted') <> 'rejected'
              and ow.share_tagged_outings)
    )
  );

-- Nothing stored may still point at the frozen tables.
do $$
declare v text;
begin
  select string_agg(distinct coalesce(cls.relname, 'view:' || dep.relname), ', ') into v
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
    raise exception 'STILL BOUND TO THE FROZEN TABLES: %', v;
  end if;
end $$;
