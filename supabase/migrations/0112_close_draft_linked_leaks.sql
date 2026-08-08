-- 0112 — Close draft-linked read leaks (Prompt 3, privacy).
--
-- photos_select already hides photos on unsaved/draft places (visible only to the
-- uploader, or the owner for orphan uploads, or when the place is saved). But the
-- sibling SELECT policies for videos, entries, place_ratings, and photo_reactions
-- were `is_member()` only — so a member could read media/notes/ratings/reactions
-- attached to a place that isn't saved yet (a draft the creator is still composing),
-- even though the place row itself is hidden. This aligns those four with the
-- photos pattern.
--
-- NOT touched: visits_select. 110 legitimate visits currently hang off auto-created
-- unsaved places (activity-derived), and both the owner and the editor rely on
-- seeing them; gating visits by `saved` would hide real household data. Visit
-- attribution/privacy is handled at the place level instead.
--
-- Verified before applying (impersonating the editor): the new predicates hide
-- ZERO currently-visible rows (videos/entries/ratings on unsaved places = 0,
-- reactions total = 0). Additive/reversible — only SELECT USING changes.
--
-- ROLLBACK: recreate each policy with `using (public.is_member())`.

-- videos — mirror photos_select (videos have no deleted_at column).
drop policy if exists videos_select on public.videos;
create policy videos_select on public.videos for select using (
  public.is_member() and (
    uploaded_by = auth.uid()
    or (uploaded_by is null and public.is_owner())
    or (place_id is not null and public.place_is_saved(place_id))
  )
);

-- entries — visible to their author, to the owner for orphan entries, or when the
-- linked place is saved.
drop policy if exists entries_select on public.entries;
create policy entries_select on public.entries for select using (
  public.is_member() and (
    created_by = auth.uid()
    or (created_by is null and public.is_owner())
    or (place_id is not null and public.place_is_saved(place_id))
  )
);

-- place_ratings — a rater always sees their own rating; others only for saved places.
drop policy if exists place_ratings_select on public.place_ratings;
create policy place_ratings_select on public.place_ratings for select using (
  public.is_member() and (
    profile_id = auth.uid()
    or (place_id is not null and public.place_is_saved(place_id))
  )
);

-- photo_reactions — visible to their author, or when the reacted-to photo is on a
-- saved place (reaction visibility follows photo visibility).
drop policy if exists photo_reactions_select on public.photo_reactions;
create policy photo_reactions_select on public.photo_reactions for select using (
  public.is_member() and (
    profile_id = auth.uid()
    or exists (
      select 1 from public.photos ph
      where ph.id = photo_reactions.photo_id
        and ph.deleted_at is null
        and ph.place_id is not null
        and public.place_is_saved(ph.place_id)
    )
  )
);
