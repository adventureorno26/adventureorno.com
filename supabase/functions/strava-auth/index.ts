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

    // REGISTER THE CONNECTION, not just the tokens.
    //
    // `source_connections` (0202) is what every piece of evidence points at to say WHOSE
    // account supplied it. It was populated once, by 0202's backfill, from the accounts that
    // existed that day — and nothing has ever written to it since. So when Josh connected
    // his Strava on 2026-08-17 his 90 activities all landed with connection_id NULL, and the
    // question "whose account did this come from?" had no answer in the data even though the
    // tokens were sitting right there. A registry only a migration can write to is a
    // registry that is wrong the moment anybody new arrives.
    // NOT an upsert. `source_connections_identity` is an EXPRESSION index —
    // (provider, coalesce(external_id,''), owner_profile) — and Postgres cannot infer an
    // expression index from a column list, so `onConflict` here would fail 42P10 every
    // single time. That is not hypothetical: the identical mistake in recordStravaSource()
    // silently dropped the provenance of 25 activities until 2026-08-17. Match, then write.
    const { data: existingConn, error: connFindErr } = await admin
      .from('source_connections')
      .select('id')
      .eq('provider', 'strava')
      .eq('external_id', String(athleteId))
      .eq('owner_profile', profileId)
      .maybeSingle();

    const { error: connErr } = connFindErr
      ? { error: connFindErr }
      : existingConn
        ? await admin
            .from('source_connections')
            .update({ disconnected_at: null, label: 'Strava' })
            .eq('id', existingConn.id)
        : await admin.from('source_connections').insert({
            provider: 'strava',
            external_id: String(athleteId),
            owner_profile: profileId,
            label: 'Strava',
            connected_at: new Date().toISOString(),
          });
    // Not fatal — the tokens are stored and the person IS connected, so failing the whole
    // callback would be worse than a missing registry row. Logged loudly instead, because a
    // silent miss here is exactly what produced 90 activities with no connection.
    if (connErr) console.error('source_connections write failed', connErr.message);

    return Response.redirect(`${SITE}/settings?strava=connected`, 302);
  } catch (e) {
    console.error('strava-auth error', String(e));
    return Response.redirect(`${SITE}/settings?strava=error`, 302);
  }
});
