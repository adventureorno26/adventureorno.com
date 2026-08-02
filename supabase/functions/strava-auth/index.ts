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
  const state = url.searchParams.get('state'); // random single-use state (0115)

  if (err) return Response.redirect(`${SITE}/settings?strava=denied`, 302);
  if (!code) return Response.redirect(`${SITE}/settings?strava=missing_code`, 302);

  try {
    const admin = adminClient();

    // Validate + single-use-consume the state BEFORE exchanging the code. A missing,
    // expired, replayed, or forged state means we don't know who initiated this link,
    // so we refuse (prevents OAuth CSRF / account injection). The bound profile id
    // comes from the server-side store, never from the raw state value.
    if (!state) return Response.redirect(`${SITE}/settings?strava=missing_state`, 302);
    const { data: profileId, error: stateErr } = await admin.rpc('consume_oauth_state', {
      p_state: state,
      p_provider: 'strava',
    });
    if (stateErr || !profileId) {
      return Response.redirect(`${SITE}/settings?strava=invalid_state`, 302);
    }

    const token = (await exchangeCode(code)) as Awaited<ReturnType<typeof exchangeCode>> & {
      athlete?: { id: number };
    };
    const athleteId = token.athlete?.id;
    if (!athleteId) throw new Error('no athlete in token response');

    await admin.from('strava_accounts').upsert(
      {
        athlete_id: athleteId,
        profile_id: profileId,
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
