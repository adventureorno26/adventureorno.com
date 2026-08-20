-- 0240 — saying who was at a PLACE, or on a VISIT, stops overwriting them too.
--
-- The rest of §3e Step 6. 0236 fixed `set_activity_solo`; the same picker on a visit and on
-- a place goes through `set_visit_participants`, which did the identical thing:
--
--     delete from public.visit_profiles where visit_id = p_visit;
--     insert into public.visit_profiles (visit_id, profile_id) select ...
--
-- `visit_profiles` carries claim_status, evidence, created_by, asserted_by, decided_by,
-- decided_at and rule_id — the whole record of who said what and who agreed — and every one
-- of them was thrown away each time somebody touched the control. 655 rows in production, all
-- of them `accepted` / `unknown`, which is what that history looks like after it has been
-- overwritten enough times.
--
-- ONE DIFFERENCE FROM 0236, AND IT MATTERS. For an activity, 0236 writes a `proposed` row
-- immediately, because since 0228 that row is also what SHARES the recording — she wanted him
-- to see it straight away and keep the right to say "I wasn't there".
--
-- A visit has no sharing gate, and **nothing filters visit_profiles by claim_status**. Checked
-- against production: of the 24 functions that read that table, exactly one (`respond_to_tag`)
-- looks at the column. `place_visit_counts`, `settings_stats`, `wander_stats`,
-- `place_ids_for_view` and `shared_outings` all treat a row as a fact. So writing a `proposed`
-- row here would put a place on somebody's counts before they agreed they had been there —
-- which is the 0039 harm, the one that put 46 of her activities on his stats.
--
-- So for a visit the CLAIM is the pending state and there is no row until it is accepted.
-- `respond_to_tag` already inserts it on acceptance; this just stops jumping the gun.
--
-- AND A PLACE ASKS ONCE. `set_place_solo` loops every visit at the place. Lake of the Red
-- Rocks has 43. Answering "were you with me at this place" forty-three times is not a better
-- version of not being asked at all, so a place is now a claim in its own right:
-- **`tag_claims.subject_kind` gains 'place'**, one question covers the place, and accepting it
-- writes the rows for every visit there. It is one statement — "we go here together" — and it
-- is now stored as one.
--
-- WHAT CANNOT BE TAKEN AWAY. 0236 protected a row evidencing somebody's own recording. The
-- visit equivalent is their own evidence for that day: a photo THEY uploaded, or an activity
-- THEY recorded, sitting in `visit_evidence`. Somebody else saying "I was there alone" does
-- not delete the proof that another person was too — that is the difference between "you
-- weren't with me" and "your photograph is not of this place".

-- ---------------------------------------------------------------------------
-- A place can be claimed.
-- ---------------------------------------------------------------------------
alter table public.tag_claims drop constraint if exists tag_claims_kind_ck;
alter table public.tag_claims add constraint tag_claims_kind_ck
  check (subject_kind = any (array['activity', 'visit', 'place']));

-- A note on the two vocabularies, because it caused a real bug and will again:
-- `tag_claims.status` permits **declined**; `activity_profiles.claim_status` permits
-- **rejected**. Same idea, different word, adjacent tables — which is how 0228 came to gate
-- sharing on a value that could never appear (fixed in 0236). Unifying them is a data
-- migration and not this one; naming it here is the least that is owed to whoever reads the
-- next `<> 'declined'` and assumes it works.

-- ---------------------------------------------------------------------------
-- One visit.
-- ---------------------------------------------------------------------------
create or replace function public.set_visit_participants(p_visit uuid, p_profiles uuid[])
returns setof public.visit_profiles
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me     uuid := auth.uid();
  v_person uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.visits where id = p_visit) then
    raise exception 'no such visit';
  end if;
  if coalesce(array_length(p_profiles, 1), 0) = 0 then
    raise exception 'a visit needs at least one participant';
  end if;
  if exists (select 1 from unnest(p_profiles) x
              where not exists (select 1 from public.profiles p where p.id = x)) then
    raise exception 'unknown profile in the participant list';
  end if;

  foreach v_person in array p_profiles loop
    if v_person = v_me then
      -- My own presence is mine to state.
      insert into public.visit_profiles
        (visit_id, profile_id, claim_status, evidence, created_by, decided_by, decided_at)
      values (p_visit, v_person, 'accepted', 'own_statement', 'user', v_me, now())
      on conflict (visit_id, profile_id) do update
        set claim_status = 'accepted', decided_by = v_me, decided_at = now();
    else
      -- Somebody else is a QUESTION, and no row until they answer it: nothing filters this
      -- table by claim_status, so a pending row would already be on their statistics.
      insert into public.tag_claims
        (subject_kind, subject_id, profile_id, asserted_by, status)
      select 'visit', p_visit, v_person, v_me, 'proposed'
       where not exists (select 1 from public.tag_claims c
                          where c.subject_kind = 'visit'
                            and c.subject_id = p_visit
                            and c.profile_id = v_person
                            and c.status in ('proposed', 'accepted', 'accepted_legacy'));
    end if;
  end loop;

  -- Remove only somebody's CLAIM about a person, never their own evidence for the day.
  delete from public.visit_profiles vp
   where vp.visit_id = p_visit
     and not (vp.profile_id = any(p_profiles))
     and not exists (
           select 1 from public.visit_evidence ve
            where ve.visit_id = p_visit
              and ((ve.evidence_type = 'photo'
                    and exists (select 1 from public.photos ph
                                 where ph.id = ve.evidence_id and ph.uploaded_by = vp.profile_id))
                or (ve.evidence_type = 'activity'
                    and exists (select 1 from public.activities a
                                 where a.id = ve.evidence_id and a.owner_profile = vp.profile_id))));

  update public.tag_claims c
     set status = 'retracted', decided_at = now()
   where c.subject_kind = 'visit'
     and c.subject_id = p_visit
     and not (c.profile_id = any(p_profiles))
     and c.status in ('proposed', 'accepted_legacy');

  update public.visits set solo_override = true where id = p_visit;

  return query select * from public.visit_profiles where visit_id = p_visit;
end $function$;

comment on function public.set_visit_participants is
  'Who was on a visit. Your OWN presence you may state; anyone else is a claim they answer, '
  'and there is no participant row until they do — nothing filters this table by claim_status, '
  'so a pending row would already be on their statistics. Never deletes a person whose own '
  'photo or own activity is the evidence for that day (0240).';

-- ---------------------------------------------------------------------------
-- A whole place, asked once.
-- ---------------------------------------------------------------------------
create or replace function public.set_place_solo(p_place uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me     uuid := auth.uid();
  v_wanted uuid[];
  v_person uuid;
  v_visit  uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_wanted := case
    when p_profile is not null then array[p_profile]
    else array(select id from public.profiles
                where role in ('owner','editor')
                  and coalesce(display_name,'') !~* '(test|bot)')
  end;

  foreach v_person in array v_wanted loop
    if v_person = v_me then
      -- Mine to state, on every visit here.
      for v_visit in select id from public.visits where place_id = p_place loop
        insert into public.visit_profiles
          (visit_id, profile_id, claim_status, evidence, created_by, decided_by, decided_at)
        values (v_visit, v_me, 'accepted', 'own_statement', 'user', v_me, now())
        on conflict (visit_id, profile_id) do update
          set claim_status = 'accepted', decided_by = v_me, decided_at = now();
      end loop;
    else
      -- ONE question for the whole place. Forty-three questions is not a better version of
      -- never being asked.
      insert into public.tag_claims
        (subject_kind, subject_id, profile_id, asserted_by, status)
      select 'place', p_place, v_person, v_me, 'proposed'
       where not exists (select 1 from public.tag_claims c
                          where c.subject_kind = 'place'
                            and c.subject_id = p_place
                            and c.profile_id = v_person
                            and c.status in ('proposed', 'accepted', 'accepted_legacy'));
    end if;
  end loop;

  -- Taking somebody off a place: their rows go, their own evidence stays, the claim retracts.
  delete from public.visit_profiles vp
   using public.visits v
   where v.id = vp.visit_id
     and v.place_id = p_place
     and not (vp.profile_id = any(v_wanted))
     and not exists (
           select 1 from public.visit_evidence ve
            where ve.visit_id = vp.visit_id
              and ((ve.evidence_type = 'photo'
                    and exists (select 1 from public.photos ph
                                 where ph.id = ve.evidence_id and ph.uploaded_by = vp.profile_id))
                or (ve.evidence_type = 'activity'
                    and exists (select 1 from public.activities a
                                 where a.id = ve.evidence_id and a.owner_profile = vp.profile_id))));

  update public.tag_claims c
     set status = 'retracted', decided_at = now()
   where c.status in ('proposed', 'accepted_legacy')
     and not (c.profile_id = any(v_wanted))
     and ((c.subject_kind = 'place' and c.subject_id = p_place)
       or (c.subject_kind = 'visit'
           and c.subject_id in (select id from public.visits where place_id = p_place)));

  update public.visits set manual = true, solo_override = true where place_id = p_place;
end $function$;

comment on function public.set_place_solo is
  'Who goes to a place. Your own presence you may state on every visit there; anyone else is '
  'ONE claim about the place rather than one per visit, because "we go here together" is one '
  'statement (0240).';

-- ---------------------------------------------------------------------------
-- Answering a place claim writes every visit at that place.
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

  -- ---- A PLACE: one answer, every visit there (0240) ----------------------
  if c.subject_kind = 'place' then
    if p_accept then
      insert into public.visit_profiles
        (visit_id, profile_id, claim_status, evidence, created_by, asserted_by,
         decided_by, decided_at, rule_id)
      select v.id, c.profile_id, 'accepted', 'tagged_and_accepted', 'user', c.asserted_by,
             c.profile_id, now(), c.rule_id
        from public.visits v where v.place_id = c.subject_id
      on conflict (visit_id, profile_id) do update
        set claim_status = 'accepted', evidence = 'tagged_and_accepted',
            decided_by = c.profile_id, decided_at = now();
    else
      -- Saying no takes back only what somebody else asserted. Anything evidenced by their
      -- own photo or their own activity is not part of the claim and stays.
      delete from public.visit_profiles vp
       using public.visits v
       where v.id = vp.visit_id
         and v.place_id = c.subject_id
         and vp.profile_id = c.profile_id
         and coalesce(vp.evidence,'') in ('owner_asserted', 'tagged_and_accepted', 'unknown');
    end if;
    return;
  end if;

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

    if v_seen is not null and v_seen <> c.subject_id then
      insert into public.activity_profiles
        (activity_id, profile_id, claim_status, evidence, created_by, asserted_by, decided_by, decided_at, rule_id)
      values (v_seen, c.profile_id, 'accepted', 'tagged_and_accepted', 'user',
              c.asserted_by, c.profile_id, now(), c.rule_id)
      on conflict do nothing;
    end if;
  else
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

-- ---------------------------------------------------------------------------
-- And a question nobody is asked is not a question.
-- ---------------------------------------------------------------------------
-- `my_tags_to_confirm` returned ACTIVITY claims only. Visit claims have been storable since
-- 0201 and `respond_to_tag` has known how to answer them just as long — but nothing ever put
-- one in front of the person, so a visit tag sat 'proposed' forever. 0240 starts creating
-- them in earnest, and place claims besides, so all three kinds are surfaced now.
create or replace function public.my_tags_to_confirm(p_limit integer default 200)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(t order by t.start_date desc nulls last), '[]'::jsonb)
    from (
      select 'activity'::text  as kind,
             c.id              as claim_id,
             c.subject_id      as subject_id,
             c.status,
             a.id              as activity_id,
             (a.id <> c.subject_id) as via_another_recording,
             a.name,
             a.type,
             a.distance,
             a.start_date,
             pl.name           as place,
             who.display_name  as tagged_by,
             r.note            as rule_note,
             1::bigint         as visits
        from public.tag_claims c
        join public.visible_activities a on a.id = public.visible_recording_of(c.subject_id)
        left join public.places pl on pl.id = a.place_id
        left join public.profiles who on who.id = c.asserted_by
        left join public.tagging_rules r on r.id = c.rule_id
       where c.profile_id = auth.uid()
         and c.subject_kind = 'activity'
         and c.status in ('proposed', 'accepted_legacy')

      union all

      select 'visit', c.id, c.subject_id, c.status,
             null::uuid, false,
             null::text, null::text, null::double precision,
             v.start_date::timestamptz,
             pl.name, who.display_name, r.note, 1::bigint
        from public.tag_claims c
        join public.visits v on v.id = c.subject_id
        left join public.places pl on pl.id = v.place_id
        left join public.profiles who on who.id = c.asserted_by
        left join public.tagging_rules r on r.id = c.rule_id
       where c.profile_id = auth.uid()
         and c.subject_kind = 'visit'
         and c.status in ('proposed', 'accepted_legacy')

      union all

      select 'place', c.id, c.subject_id, c.status,
             null::uuid, false,
             null::text, null::text, null::double precision,
             (select max(v.start_date)::timestamptz from public.visits v
               where v.place_id = c.subject_id),
             pl.name, who.display_name, r.note,
             (select count(*) from public.visits v where v.place_id = c.subject_id)
        from public.tag_claims c
        join public.places pl on pl.id = c.subject_id
        left join public.profiles who on who.id = c.asserted_by
        left join public.tagging_rules r on r.id = c.rule_id
       where c.profile_id = auth.uid()
         and c.subject_kind = 'place'
         and c.status in ('proposed', 'accepted_legacy')

      limit greatest(1, p_limit)
    ) t;
$function$;

comment on function public.my_tags_to_confirm is
  'Every tag waiting for YOUR answer — outings, visits and whole places. It returned activity '
  'claims only until 0240, so a visit claim sat proposed forever with nobody ever asked.';
