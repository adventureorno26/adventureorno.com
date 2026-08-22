-- 0268 — a view remembers the TABLE, not the name.
--
-- `0200_a_tag_is_not_a_key` failed in CI, alone, out of seventy-one — and it was right:
--
--     FAIL: the view hid an outing she has shared with him (0 rows)
--
-- Reproduced on production in four lines: an outing she has tagged him on, sharing on.
--
--     activity_profiles rows for it   2
--     his row present                 1
--     can_see_activity                TRUE
--     visible_activities rows         0        ← the same rule, the opposite answer
--
-- WHY. 0266 renamed `activity_profiles` to `activity_profiles_retired` and created a view of
-- the old name over `memory_people`. A FUNCTION resolves names when it runs, so
-- `can_see_activity` picked up the new view immediately. **A view does not.** Postgres records
-- a view's dependencies by OID at creation, so `visible_activities` — which has referenced
-- `activity_profiles` since 0196 — followed the rename and quietly kept reading the frozen
-- table. Everything written since the swap was invisible to it.
--
-- This is what "the readers do not move" cost: the readers that are FUNCTIONS did not move,
-- and the one reader that is a VIEW moved somewhere nobody asked it to. It is the only one —
-- checked through `pg_depend`, not assumed:
--
--     views still bound to the retired tables: visible_activities
--
-- Recreating it rebinds it by name. Nothing about the rule changes; this is the same
-- definition 0236 left, and 0233's warning still applies — `select a.*`, never a column list,
-- because an explicit list pins column ORDER and breaks a replay onto an empty database.
create or replace view public.visible_activities as
  select a.*
    from public.activities a
   where lower(coalesce(a.original_source, '')) <> 'strava'
      or a.owner_profile = auth.uid()
      -- 0228: an outing you were ON, when its owner has chosen to share what they tag.
      or exists (
           select 1
             from public.activity_profiles ap
             join public.profiles ow on ow.id = a.owner_profile
            where ap.activity_id = a.id
              and ap.profile_id = auth.uid()
              and coalesce(ap.claim_status, 'accepted') <> 'rejected'
              and ow.share_tagged_outings);

comment on view public.visible_activities is
  'Activities the caller may see: not Strava-sourced, or theirs, or an outing they were on '
  'whose owner shares what they tag (0228). Recreated in 0268 so it reads the activity_profiles '
  'VIEW rather than the table it was bound to by OID before the rename — a function resolves '
  'names when it runs, a view does not.';

-- And it has to agree with the helper that states the same rule, or one of them is lying.
do $$
declare v_helper int; v_view int;
begin
  select count(*) into v_helper from public.activities a where public.can_see_activity(a.id);
  select count(*) into v_view from public.visible_activities;
  if v_helper <> v_view then
    raise exception 'can_see_activity says % activities are visible and the view says %',
      v_helper, v_view;
  end if;
  raise notice '0268: the helper and the view agree on % activities', v_view;
end $$;
