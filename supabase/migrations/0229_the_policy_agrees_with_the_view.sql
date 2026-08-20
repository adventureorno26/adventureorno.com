-- 0229 — the row policy has to say the same thing the view says.
--
-- 0228 taught `can_see_activity` and `visible_activities` that an owner may share the
-- outings she tags someone on. The row-level policy on `activities` was left saying the
-- older thing, so the two disagreed: the view would show Josh an outing he is tagged on
-- while a direct read of the table would not.
--
-- A disagreement between a view and its table's policy is worse than either rule on its
-- own, because which one applies then depends on which query a screen happens to use. This
-- makes them identical, word for word.
--
-- Note what is NOT relaxed. `is_member()` still gates everything: this is about which rows
-- a member of the household may read, never about opening the table to anyone else.
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
              and coalesce(ap.claim_status, 'accepted') <> 'declined'
              and ow.share_tagged_outings)
    )
  );
