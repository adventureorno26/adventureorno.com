-- 0236 — saying who was there stops deleting what everyone said about it.
--
-- §3e Step 6. `set_activity_solo` backs the `Together / Just me / Just Josh` picker, and it
-- did this:
--
--     delete from public.activity_profiles where activity_id = p_activity;
--     insert into public.activity_profiles (activity_id, profile_id) select ...
--
-- Every participant row for the outing, wiped and replaced with bare ones. Four consequences,
-- and the last only became true this afternoon:
--
--   1. IT ERASES HIS ANSWER. `claim_status`, `evidence`, `asserted_by`, `decided_by`,
--      `decided_at`, `rule_id` — all dropped. If Josh had ACCEPTED a tag, the record that he
--      accepted it is gone, and 7a-12 exists precisely to keep it.
--   2. IT TAGS HIM WITHOUT ASKING. A direct insert, around `tag_claims` entirely. §A has
--      required acceptance since it was written.
--   3. THE "everyone" BRANCH re-adds every owner and editor — the 0039 behaviour that put
--      46 of her activities on his stats in the first place.
--   4. AND NOW IT SHARES. Since 0228, an `activity_profiles` row is what lets a tagged
--      person SEE a Strava recording. So a picker that silently writes rows is a picker that
--      silently shares — the opposite of "sharing is a choice the owner makes".
--
-- THE RULE, which is Codex's and is right:
--
--     you may change YOUR OWN participation directly
--     adding ANOTHER USER proposes a claim they can accept or decline
--     removing them retracts the claim and never touches their own recording
--
-- A proposed claim still shares (0228 excludes only `declined`), so she gets what she asked
-- for — he sees the outing immediately — and he keeps the ability to say "I wasn't there",
-- which un-shares it. Nothing is deleted wholesale, ever.

create or replace function public.set_activity_solo(p_activity uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me      uuid := auth.uid();
  v_place   uuid;
  v_wanted  uuid[];
  v_person  uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select place_id into v_place from public.activities where id = p_activity;

  -- Who the picker is asking for. NULL still means "everyone in the household", which is
  -- what "Together" sends.
  v_wanted := case
    when p_profile is not null then array[p_profile]
    else array(select id from public.profiles
                where role in ('owner','editor')
                  and coalesce(display_name,'') !~* '(test|bot)')
  end;

  -- ---- ADD ----------------------------------------------------------------
  foreach v_person in array v_wanted loop
    if v_person = v_me then
      -- MY OWN participation is mine to state. No claim, no waiting.
      insert into public.activity_profiles
        (activity_id, profile_id, claim_status, evidence, created_by, decided_by, decided_at)
      values (p_activity, v_person, 'accepted', 'own_statement', 'user', v_me, now())
      on conflict (activity_id, profile_id) do update
        set claim_status = 'accepted',
            decided_by   = v_me,
            decided_at   = now();
    else
      -- SOMEBODY ELSE is a claim, not a fact. Left alone entirely if they have already
      -- answered — an accepted tag stays accepted, and a DECLINED one is not quietly
      -- re-added by pressing the picker again.
      insert into public.activity_profiles
        (activity_id, profile_id, claim_status, evidence, created_by, asserted_by)
      values (p_activity, v_person, 'proposed', 'owner_asserted', 'user', v_me)
      on conflict (activity_id, profile_id) do nothing;

      insert into public.tag_claims
        (subject_kind, subject_id, profile_id, asserted_by, status)
      select 'activity', p_activity, v_person, v_me, 'proposed'
       where not exists (select 1 from public.tag_claims c
                          where c.subject_kind = 'activity'
                            and c.subject_id = p_activity
                            and c.profile_id = v_person);
    end if;
  end loop;

  -- ---- REMOVE -------------------------------------------------------------
  -- Only people the picker did NOT name, and only rows that are somebody's CLAIM about
  -- them. A row evidencing their own recording ('own_recording') is not the tagger's to
  -- delete — that is the difference between "you weren't with me" and "your run did not
  -- happen".
  delete from public.activity_profiles ap
   where ap.activity_id = p_activity
     and not (ap.profile_id = any(v_wanted))
     and coalesce(ap.evidence, '') <> 'own_recording';

  update public.tag_claims c
     set status = 'retracted', decided_at = now()
   where c.subject_kind = 'activity'
     and c.subject_id = p_activity
     and not (c.profile_id = any(v_wanted))
     and c.status in ('proposed', 'accepted_legacy');

  if v_place is not null then
    perform public.recompute_place_stats(v_place);
    perform public.rebuild_place_visits(v_place);
  end if;
end $function$;

comment on function public.set_activity_solo is
  'Who was on an outing. Your OWN participation you may state; adding anyone else PROPOSES '
  'a claim they can accept or decline, and removing them retracts it. It never deletes a '
  'row evidencing somebody''s own recording, and never overwrites an answer they already '
  'gave — it used to delete every participant row and rebuild them bare (0236).';

-- ---------------------------------------------------------------------------
-- And a word 0228 used that the column does not have.
-- ---------------------------------------------------------------------------
-- 0228 gates sharing on `coalesce(ap.claim_status, 'accepted') <> 'declined'`. The column's
-- CHECK constraint permits **accepted, accepted_legacy, proposed, rejected** — there is no
-- 'declined'. So the clause could never exclude anybody: it reads like a safeguard and is a
-- no-op, which is worse than not having written it.
--
-- It has not leaked anything, because `respond_to_tag` DELETES the row when someone declines
-- rather than marking it. But the moment anything marks a row 'rejected' instead, sharing
-- would have continued regardless. The predicate now names the value the column actually
-- uses, in all three places that carry it.
create or replace function public.can_see_activity(p_activity uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.activities a
     where a.id = p_activity
       and (
         lower(coalesce(a.original_source, '')) <> 'strava'
         or a.owner_profile = auth.uid()
         or exists (
              select 1
                from public.activity_profiles ap
                join public.profiles ow on ow.id = a.owner_profile
               where ap.activity_id = a.id
                 and ap.profile_id = auth.uid()
                 and coalesce(ap.claim_status, 'accepted') <> 'rejected'
                 and ow.share_tagged_outings)
       )
  );
$function$;

create or replace view public.visible_activities as
  select a.*
    from public.activities a
   where lower(coalesce(a.original_source, '')) <> 'strava'
      or a.owner_profile = auth.uid()
      or exists (
           select 1
             from public.activity_profiles ap
             join public.profiles ow on ow.id = a.owner_profile
            where ap.activity_id = a.id
              and ap.profile_id = auth.uid()
              and coalesce(ap.claim_status, 'accepted') <> 'rejected'
              and ow.share_tagged_outings);

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
