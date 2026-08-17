-- 0204 — a Strava link gets long enough to actually log in.
--
-- Josh believed he had connected Strava. He had not: `oauth_states` holds one row of his,
-- created 2026-08-10 17:35, `used_at` NULL, expired at 17:45. Nothing landed.
--
-- WHAT WAS RULED OUT FIRST, by probing Strava rather than reasoning about it. Our
-- `redirect_uri` was the obvious suspect — an unregistered callback domain makes Strava
-- refuse before it ever redirects, which would leave exactly this row. It is not that:
--
--     our redirect_uri     → HTTP 302, location: https://www.strava.com/login
--     a bogus redirect_uri → HTTP 400
--
-- Strava accepts ours and simply wants a logged-in athlete. The domain is registered.
--
-- WHAT IS LEFT is the ten-minute window. `consume_oauth_state` runs BEFORE the token
-- exchange, so a callback that ran at all would have set `used_at`; it is still NULL. Either
-- Strava never redirected back, or it did and the state had already expired — and ten
-- minutes is not long enough for someone who has to find a password, clear 2FA, or install
-- the app before authorising. Both endings leave precisely this row.
--
-- Thirty minutes is still short-lived for a single-use CSRF token, and long enough for a
-- person. Nothing else about the flow changes.
create or replace function public.strava_oauth_start()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_state text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.oauth_states where expires_at < now() - interval '1 day';
  -- WAS 10 minutes. See the note above: a link is followed by a person, not a script.
  insert into public.oauth_states (state, provider, profile_id, expires_at)
  values (v_state, 'strava', auth.uid(), now() + interval '30 minutes');
  return v_state;
end
$function$;

comment on function public.strava_oauth_start() is
  'Mints a single-use OAuth state bound to the signed-in profile. Valid for 30 minutes: the '
  'previous 10 expired while Josh was still logging in to Strava, and the app said nothing, '
  'so he believed he had connected when nothing had.';
