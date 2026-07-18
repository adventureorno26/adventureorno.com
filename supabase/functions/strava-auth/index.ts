// strava-auth — OAuth authorization-code callback. The SPA sends the owner to
// Strava's authorize page; Strava redirects back here with ?code=. We exchange
// it, store tokens in strava_accounts (service_role), and bounce to /settings.
//
// verify_jwt = false (Strava redirects a browser here, no Supabase JWT). Only a
// valid Strava `code` yields tokens, and this is single-owner.
// Deploy: supabase functions deploy strava-auth --no-verify-jwt

import { adminClient, exchangeCode } from '../_shared/strava.ts';

const SITE = Deno.env.get('SITE_URL') ?? 'https://adventureorno.com';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');
  const state = url.searchParams.get('state'); // owner profile id, optional

  if (err) return Response.redirect(`${SITE}/settings?strava=denied`, 302);
  if (!code) return Response.redirect(`${SITE}/settings?strava=missing_code`, 302);

  try {
    const token = (await exchangeCode(code)) as Awaited<ReturnType<typeof exchangeCode>> & {
      athlete?: { id: number };
    };
    const athleteId = token.athlete?.id;
    if (!athleteId) throw new Error('no athlete in token response');

    const admin = adminClient();
    await admin.from('strava_accounts').upsert(
      {
        athlete_id: athleteId,
        profile_id: state && /^[0-9a-f-]{36}$/i.test(state) ? state : null,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: new Date(token.expires_at * 1000).toISOString(),
        scope: token.scope ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'athlete_id' },
    );

    return Response.redirect(`${SITE}/settings?strava=connected`, 302);
  } catch (e) {
    console.error('strava-auth error', String(e));
    return Response.redirect(`${SITE}/settings?strava=error`, 302);
  }
});
