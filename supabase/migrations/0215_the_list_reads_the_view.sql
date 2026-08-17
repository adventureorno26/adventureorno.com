-- 0215 — the list a person READS goes through the view, like every other reader.
--
-- 0214's `my_tags_to_confirm` joined `public.activities` directly. Its ids came from
-- `visible_recording_of`, which filters — so it was not a leak. But "not a leak because of
-- what the other function does" is precisely the argument `the_readers_stay_enforced`
-- exists to refuse: it was true of the fifteen readers 0196 had to move, right up until one
-- of them wasn't. A reader that SHOWS activities to a person reads the view, and then
-- nobody has to reconstruct the argument.
--
-- `visible_recording_of` stays on `public.activities` and is allowlisted with its reason: it
-- must read the CLAIMED row's `shared_group_id` even when that row is hidden, in order to
-- find the sibling that is not. It returns ids drawn from `visible_activities` and no
-- attribute of anything else, so nothing about a hidden recording reaches the caller.

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
        join public.visible_activities a on a.id = public.visible_recording_of(c.subject_id)
        left join public.places pl on pl.id = a.place_id
        left join public.profiles who on who.id = c.asserted_by
        left join public.tagging_rules r on r.id = c.rule_id
       where c.profile_id = auth.uid()
         and c.subject_kind = 'activity'
         and c.status in ('proposed', 'accepted_legacy')
       limit greatest(1, p_limit)
    ) t;
$function$;
