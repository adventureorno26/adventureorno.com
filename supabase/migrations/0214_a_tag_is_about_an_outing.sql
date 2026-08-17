-- 0214 — a tag is about an OUTING, not about one recording of it.
--
-- FOUND BY BUILDING 0213 AND THEN RUNNING IT AS JOSH. `my_tags_to_confirm()` returned
-- **0 of his 44 claims.** Every one names Erica's Strava recording, which the Strava rule
-- correctly hides from him — so the screen that exists to ask him is empty, and answering
-- "were you on this?" is impossible for the only 44 claims that exist.
--
-- 7a-8 says the way out is that both of them reload as files. **It is not enough on its
-- own.** Her Garmin file becomes a SECOND ACTIVITY ROW, linked to the Strava one by
-- `shared_group_id` (0210). The claim still points at the Strava row. So after a full
-- reload he would still see nothing: the outing became visible, and the tag did not follow.
--
-- This is §"Derived vs source" again, one level up. `activity_profiles` is per-activity
-- because a membership is evidence about a recording — but a TAG is a statement about a day
-- that happened. Erica did not say "you were on my Garmin file"; she said "you were with
-- me". Binding that to whichever row happened to be imported first makes the claim as
-- fragile as the recording, and 46 of the 219 outings he is tagged on are unreachable today
-- for exactly that reason.
--
-- SO: a claim is resolved through its OUTING. If the claimed recording is hidden but
-- another recording of the same outing is visible, he is asked about that one and accepting
-- credits him there — where it will actually show up for him and count once.
--
-- Nothing here weakens the Strava rule. He is never shown a Strava-sourced row, and no
-- attribute of one reaches him: the sibling shown is a row he may already see on its own.

-- ---------------------------------------------------------------------------
-- The recording of an outing that THIS caller may see.
-- ---------------------------------------------------------------------------
-- Prefers the claimed row itself when it is visible, so nothing changes for the ordinary
-- case. `visible_activities` does the filtering, so the rule is enforced in one place.
create or replace function public.visible_recording_of(p_activity uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select v.id
    from public.visible_activities v
   where v.id = p_activity
   union all
  select v.id
    from public.visible_activities v
    join public.activities claimed on claimed.id = p_activity
   where coalesce(v.shared_group_id, v.id) = coalesce(claimed.shared_group_id, claimed.id)
     and v.id <> p_activity
   order by 1
   limit 1;
$function$;

-- ---------------------------------------------------------------------------
-- What am I being asked about — resolved through the outing.
-- ---------------------------------------------------------------------------
create or replace function public.my_tags_to_confirm(p_limit int default 200)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(t order by t.start_date desc), '[]'::jsonb)
    from (
      select c.id             as claim_id,
             c.status,
             a.id             as activity_id,
             (a.id <> c.subject_id) as via_another_recording,
             a.name,
             a.type,
             a.distance,
             a.start_date,
             pl.name          as place,
             who.display_name as tagged_by,
             r.note           as rule_note
        from public.tag_claims c
        join public.activities a on a.id = public.visible_recording_of(c.subject_id)
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
-- Answering credits him on the recording he can actually see.
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_tag(p_claim uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c      record;
  v_seen uuid;
begin
  select * into c from public.tag_claims where id = p_claim;
  if c is null then raise exception 'no such claim'; end if;
  if c.profile_id <> auth.uid() then
    raise exception 'only the tagged person can answer a tag' using errcode = '42501';
  end if;
  if c.status not in ('proposed', 'accepted_legacy') then
    raise exception 'that claim is already %', c.status;
  end if;

  update public.tag_claims
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_at = now()
   where id = p_claim;

  if c.subject_kind <> 'activity' then
    -- Visits are not source-restricted, so they need none of the below.
    if p_accept then
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
    else
      delete from public.visit_profiles vp
       where vp.visit_id = c.subject_id and vp.profile_id = c.profile_id
         and ((c.rule_id is not null and vp.rule_id = c.rule_id)
           or (c.rule_id is null
               and coalesce(vp.evidence,'') in ('owner_asserted', 'tagged_and_accepted')));
    end if;
    return;
  end if;

  -- The recording he can see, which is usually the claimed one.
  v_seen := public.visible_recording_of(c.subject_id);

  if p_accept then
    -- Always record it against the claim's own subject: that is what was asserted, and it
    -- stays true whether or not he can see that row today.
    insert into public.activity_profiles
      (activity_id, profile_id, claim_status, evidence, created_by, asserted_by, decided_by, decided_at, rule_id)
    values (c.subject_id, c.profile_id, 'accepted', 'tagged_and_accepted', 'user',
            c.asserted_by, c.profile_id, now(), c.rule_id)
    on conflict do nothing;
    update public.activity_profiles
       set claim_status = 'accepted', evidence = 'tagged_and_accepted',
           decided_by = c.profile_id, decided_at = now()
     where activity_id = c.subject_id and profile_id = c.profile_id
       and claim_status is distinct from 'accepted';

    -- AND against the recording he can see, or accepting shows him nothing. Same outing,
    -- same claim, same rule — one membership per recording is how this schema stores it.
    if v_seen is not null and v_seen <> c.subject_id then
      insert into public.activity_profiles
        (activity_id, profile_id, claim_status, evidence, created_by, asserted_by, decided_by, decided_at, rule_id)
      values (v_seen, c.profile_id, 'accepted', 'tagged_and_accepted', 'user',
              c.asserted_by, c.profile_id, now(), c.rule_id)
      on conflict do nothing;
    end if;
  else
    -- Declining removes him from EVERY recording of that outing this claim put him on —
    -- "I was not there" is about the day, not about which file it came out of. Still scoped
    -- by the rule, so a membership from his own recording is untouched.
    delete from public.activity_profiles ap
     using public.activities a, public.activities claimed
     where ap.activity_id = a.id
       and claimed.id = c.subject_id
       and coalesce(a.shared_group_id, a.id) = coalesce(claimed.shared_group_id, claimed.id)
       and ap.profile_id = c.profile_id
       and ((c.rule_id is not null and ap.rule_id = c.rule_id)
         or (c.rule_id is null
             and coalesce(ap.evidence,'') in ('owner_asserted', 'tagged_and_accepted')));
  end if;
end $function$;

revoke all on function public.visible_recording_of(uuid) from public, anon;
grant execute on function public.visible_recording_of(uuid) to authenticated;

comment on function public.visible_recording_of is
  'The recording of an outing that the CALLER may see — the claimed row when visible, '
  'otherwise a sibling sharing its shared_group_id. Reads visible_activities, so the Strava '
  'rule is enforced in one place. Exists because a tag is about an outing and 44 of Josh''s '
  'named a recording he is not allowed to see (0214).';
