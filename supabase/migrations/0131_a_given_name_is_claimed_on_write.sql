-- 0131 — Whoever writes a real name claims it, on every path.
--
-- 0130 stopped the automatic naming and made set_place_name record ownership. But
-- naming does not only happen through that one RPC: a place gets a real name at
-- creation from FOUR different client paths —
--     NewPlaceDraft.tsx:153, AddWizard.tsx:158, DayView.tsx:122, PhotoSorter.tsx:264
-- — plus create_experience and any future path. Patching each call site is exactly
-- the pattern that has decayed every time: one gets missed, a name goes unclaimed,
-- and something later overwrites it.
--
-- So the claim happens in the DATABASE, on write, for every path at once:
--   * INSERT with a real name  -> locked, named_by = whoever inserted it
--   * UPDATE that changes name to a real one -> same
--   * 'New place' / blank is NOT a name, so it stays unclaimed and free
--   * a write by a background job (auth.uid() is null) claims nothing, so a future
--     automated path cannot silently take ownership
--
-- name_scope is left NULL — the shared Both space — because a place created while
-- adding photos is shared work. set_place_name is the way to claim one into your own
-- space, and it is the only thing that sets a personal scope.
--
-- The trigger never CHANGES a name and never blocks a write; it only records who a
-- name belongs to. set_place_name remains the enforcement point for renames.

create or replace function public.claim_place_name()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_me uuid := auth.uid();
begin
  -- Not a real name: nothing to claim.
  if coalesce(btrim(new.name), '') = '' or new.name = 'New place' then
    return new;
  end if;

  -- Only a logged-in person can claim a name.
  if v_me is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.name_locked := true;
    new.named_by    := coalesce(new.named_by, v_me);
  elsif new.name is distinct from old.name then
    -- The name genuinely changed, so re-stamp it to whoever made the change.
    new.name_locked := true;
    new.named_by    := v_me;
  end if;

  return new;
end $function$;

drop trigger if exists trg_claim_place_name on public.places;
create trigger trg_claim_place_name
  before insert or update of name on public.places
  for each row execute function public.claim_place_name();

revoke all on function public.claim_place_name() from public;
revoke all on function public.claim_place_name() from anon;
revoke all on function public.claim_place_name() from authenticated;
