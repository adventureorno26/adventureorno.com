-- 0213 — Josh gets asked, and "no" actually removes him.
--
-- 7a-6 records Erica's instruction as the specification: *"add him on all activities since
-- December 21, 2025 except the Yuengling marathon"*, and 7a-7 says the missing piece is
-- **acceptance** — "the part §A already required and nothing has ever implemented."
--
-- 0201 built the model and got most of the way: `tagging_rules`, `tagging_rule_exceptions`,
-- `tag_claims`, and `respond_to_tag()`. Measured on 2026-08-17, two things stop it working:
--
--   1. All 44 of Josh's claims are `accepted_legacy`, and `respond_to_tag` refuses anything
--      that is not `proposed` — `raise exception 'that claim is already %'`. So the one
--      function that exists to ask him **cannot be called for any claim that exists**. He
--      has never been asked and, as built, never could be.
--
--   2. On DECLINE it marks the claim and stops. For a `proposed` claim that is right — no
--      participation row was ever written. For a legacy one the row is ALREADY THERE, put
--      there by 0039's date rule, so declining would leave him credited with the outing he
--      just said he was not on. A "no" that changes nothing on screen is the same failure
--      as 0210's proposal nobody could accept, one layer up.
--
-- WHAT ACCEPTING AND DECLINING MEAN, and why the asymmetry is deliberate:
--
--   ACCEPT   the claim becomes `accepted` and the participation row records that HE decided
--            it — evidence goes from `owner_asserted_date_backfill` to `tagged_and_accepted`.
--            Erica's assertion was never worthless; it stops being the ONLY thing said.
--   DECLINE  the claim becomes `declined` and the participation row the RULE created is
--            removed. Only that row: a membership he created himself, or one carrying
--            evidence of his own recording, is his and is never touched by answering a tag.
--
-- Erica's assertion remains first-class evidence (7a-6). What changes is that it is no
-- longer the last word about somebody else.

create or replace function public.respond_to_tag(p_claim uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c record;
begin
  select * into c from public.tag_claims where id = p_claim;
  if c is null then raise exception 'no such claim'; end if;
  if c.profile_id <> auth.uid() then
    raise exception 'only the tagged person can answer a tag' using errcode = '42501';
  end if;

  -- `accepted_legacy` is answerable. It means "somebody asserted this and nobody ever asked
  -- you", which is precisely the state this function exists to end. Only a claim he has
  -- already decided himself is closed.
  if c.status not in ('proposed', 'accepted_legacy') then
    raise exception 'that claim is already %', c.status;
  end if;

  update public.tag_claims
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_at = now()
   where id = p_claim;

  if p_accept then
    if c.subject_kind = 'activity' then
      insert into public.activity_profiles
        (activity_id, profile_id, claim_status, evidence, created_by, asserted_by, decided_by, decided_at, rule_id)
      values (c.subject_id, c.profile_id, 'accepted', 'tagged_and_accepted', 'user',
              c.asserted_by, c.profile_id, now(), c.rule_id)
      on conflict do nothing;
      -- The legacy row already exists, so the insert above no-ops. Say who decided it, or
      -- accepting a legacy claim would leave it looking exactly like one nobody answered.
      update public.activity_profiles
         set claim_status = 'accepted', evidence = 'tagged_and_accepted',
             decided_by = c.profile_id, decided_at = now()
       where activity_id = c.subject_id and profile_id = c.profile_id
         and claim_status is distinct from 'accepted';
    else
      insert into public.visit_profiles
        (visit_id, profile_id, claim_status, evidence, created_by, asserted_by, decided_by, decided_at, rule_id)
      values (c.subject_id, c.profile_id, 'accepted', 'tagged_and_accepted', 'user',
              c.asserted_by, c.profile_id, now(), c.rule_id)
      on conflict do nothing;
      update public.visit_profiles
         set claim_status = 'accepted', evidence = 'tagged_and_accepted',
             decided_by = c.profile_id, decided_at = now()
       where visit_id = c.subject_id and profile_id = c.profile_id
         and claim_status is distinct from 'accepted';
    end if;
  else
    -- DECLINE REMOVES THE ROW THE RULE PUT THERE — and nothing else.
    --
    -- Scoped by what created it, never by the pair alone: if he recorded that outing
    -- himself, or added himself to it, that membership is his and answering a tag about it
    -- must not delete it. Without this scope, "I wasn't on Erica's copy" would quietly
    -- remove him from his own.
    -- Measured before it was written, because the predicate is the whole safety argument.
    -- Josh's 219 memberships split cleanly in two:
    --
    --   44   claim_status accepted_legacy · evidence owner_asserted_date_backfill
    --        created_by migration · rule_id SET          ← the rule put these here
    --  175   claim_status accepted · evidence unknown
    --        created_by unknown · rule_id NULL           ← his own, older than any of this
    --
    -- So a claim carrying a rule removes only the row carrying THAT rule. The 175 cannot be
    -- reached by any tag answer, which is the point: declining "you were on Erica's copy"
    -- must never quietly remove him from his own recording of the same outing.
    if c.subject_kind = 'activity' then
      delete from public.activity_profiles ap
       where ap.activity_id = c.subject_id
         and ap.profile_id = c.profile_id
         and (
           (c.rule_id is not null and ap.rule_id = c.rule_id)
           -- An ad-hoc tag with no rule behind it: only a row that IS a tag may go.
           or (c.rule_id is null
               and coalesce(ap.evidence,'') in ('owner_asserted', 'tagged_and_accepted'))
         );
    else
      delete from public.visit_profiles vp
       where vp.visit_id = c.subject_id
         and vp.profile_id = c.profile_id
         and (
           (c.rule_id is not null and vp.rule_id = c.rule_id)
           or (c.rule_id is null
               and coalesce(vp.evidence,'') in ('owner_asserted', 'tagged_and_accepted'))
         );
    end if;
  end if;
end $function$;

-- ---------------------------------------------------------------------------
-- What am I being asked about?
-- ---------------------------------------------------------------------------
-- Reads `visible_activities`, not `activities`: this SHOWS a person a list of outings, and
-- a tag on somebody else's Strava-sourced activity is exactly the row the Strava rule says
-- he may not see. A claim he cannot be shown is not listed — 7a-8's "both of you reload" is
-- what makes those outings visible again, not a hole in the guard.
create or replace function public.my_tags_to_confirm(p_limit int default 200)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(t order by t.start_date desc), '[]'::jsonb)
    from (
      select c.id            as claim_id,
             c.status,
             a.id            as activity_id,
             a.name,
             a.type,
             a.distance,
             a.start_date,
             pl.name         as place,
             who.display_name as tagged_by,
             r.note          as rule_note
        from public.tag_claims c
        join public.visible_activities a on a.id = c.subject_id
        left join public.places pl on pl.id = a.place_id
        left join public.profiles who on who.id = c.asserted_by
        left join public.tagging_rules r on r.id = c.rule_id
       where c.profile_id = auth.uid()
         and c.subject_kind = 'activity'
         and c.status in ('proposed', 'accepted_legacy')
       limit greatest(1, p_limit)
    ) t;
$function$;

-- ---------------------------------------------------------------------------
-- "Erica tagged you on 44 outings. Accept all."
-- ---------------------------------------------------------------------------
-- The same argument as 0211: a machine still only proposes, and he still decides — this
-- changes how many times he has to say it. Answering 44 cards one at a time in a
-- two-person household is how the question stops being answered at all.
create or replace function public.respond_to_all_tags(p_accept boolean, p_limit int default 500)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_n int := 0;
begin
  for v_id in
    select c.id from public.tag_claims c
     where c.profile_id = auth.uid()
       and c.status in ('proposed', 'accepted_legacy')
     order by c.created_at
     limit greatest(1, p_limit)
  loop
    perform public.respond_to_tag(v_id, p_accept);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'answered', v_n, 'accepted', p_accept);
end $function$;

revoke all on function public.my_tags_to_confirm(int) from public, anon;
revoke all on function public.respond_to_all_tags(boolean, int) from public, anon;
grant execute on function public.my_tags_to_confirm(int) to authenticated;
grant execute on function public.respond_to_all_tags(boolean, int) to authenticated;

comment on function public.respond_to_tag is
  'The tagged person answers. Accepting records that HE decided it; declining removes the '
  'participation row the RULE created and nothing else — a membership from his own '
  'recording is his (0213). Legacy claims are answerable: "somebody asserted this and '
  'nobody asked you" is the state this function exists to end.';
