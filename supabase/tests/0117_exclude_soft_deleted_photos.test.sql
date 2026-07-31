-- Test for 0117 (Prompt 4 rec 20): soft-deleted photos are excluded from visit
-- rebuilding and place stats. LOCAL disposable stack only.

begin;

do $$
declare
  v_place uuid := gen_random_uuid();
  v_ph1 uuid := gen_random_uuid();  -- March (kept)
  v_ph2 uuid := gen_random_uuid();  -- June (soft-deleted)
begin
  insert into public.places (id,name,lat,lng,saved) values (v_place,'SD Test',1,1,true);
  insert into public.photos (id,place_id,taken_at,r2_key,thumb_key,sha256)
   values (v_ph1,v_place,'2026-03-01T10:00:00Z','k1','t1','a1'),
          (v_ph2,v_place,'2026-06-01T10:00:00Z','k2','t2','a2');

  -- Two photos, two months apart → two visits.
  perform public.rebuild_place_visits(v_place);
  if (select count(*) from public.visits where place_id=v_place) <> 2 then
    raise exception 'FAIL: expected 2 visits, got %', (select count(*) from public.visits where place_id=v_place);
  end if;

  -- Soft-delete the June photo → its visit must be gone after rebuild.
  update public.photos set deleted_at = now() where id = v_ph2;
  perform public.rebuild_place_visits(v_place);
  if (select count(*) from public.visits where place_id=v_place) <> 1 then
    raise exception 'FAIL: soft-deleted photo still produced a visit';
  end if;
  if exists (select 1 from public.visits where place_id=v_place and start_date >= '2026-06-01') then
    raise exception 'FAIL: the deleted-photo visit still exists';
  end if;

  -- Stats: cover is never a soft-deleted photo.
  perform public.recompute_place_stats(v_place);
  if (select cover_photo_id from public.places where id=v_place) = v_ph2 then
    raise exception 'FAIL: a soft-deleted photo was chosen as cover';
  end if;

  raise notice 'PASS: soft-deleted photos excluded from rebuild + stats + cover (0117)';
end $$;

rollback;
