import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { redeemInviteCode } from '../lib/inviteCodes';
import { whyItFailed } from '../lib/whyItFailed';

/**
 * Signing up takes two things and they happen in this order: a Google sign-in, then an
 * invite code.
 *
 * Erica, 2026-08-30: *"invite code first."* This screen used to end in "request access"
 * — a stranger signed in, wrote a note, and waited for the owner to notice. That made
 * her the bottleneck on somebody else's Tuesday and asked her to approve a name she may
 * not recognise. A code moves the decision to the moment a member actually chose to
 * invite somebody, which is when they know who it is.
 *
 * WHY GOOGLE FIRST AND THE CODE SECOND. Redeeming creates a profile keyed to the
 * signed-in user, so there has to be a signed-in user for the code to make an account
 * FOR. `redeem_invite_code` is granted to `authenticated` and deliberately not to
 * `anon`: an anonymous redemption could only burn a valid code on behalf of nobody.
 * Signing in on its own grants nothing — with no profile you are still outside.
 *
 * WHY THERE IS NO "that code didn't work". The four ways a code can fail need four
 * different actions from the person holding it — retype it, ask for a new one, talk to
 * whoever gave it to you, ask for another. 0287 raises a different sentence for each and
 * `whyItFailed` shows Postgres messages verbatim, so what is rendered here is what the
 * database said, not a guess made in the browser.
 */
export default function Login() {
  const { session, profile, loading, refreshProfile } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  // Signed in with no profile → the only thing left between them and an account is a code.
  useEffect(() => {
    if (!loading && session && !profile) setNeedsCode(true);
  }, [loading, session, profile]);

  if (!loading && session && profile) return <Navigate to="/" replace />;

  async function signInWithGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
  }

  async function submitCode() {
    setBusy(true);
    setError(null);
    try {
      await redeemInviteCode(code);
      // The profile exists now; the provider is still holding the null it fetched
      // before. Re-ask rather than reload — a reload would lose the OAuth landing.
      await refreshProfile();
    } catch (e) {
      setError(whyItFailed('That code didn’t let you in', e, { online: navigator.onLine }));
    }
    setBusy(false);
  }

  return (
    <div className="center-screen">
      <div className="login-card">
        <h1>adventure or no</h1>
        <p>Private map — you need an invite code to join.</p>

        {needsCode ? (
          <>
            <p style={{ marginTop: 6 }}>
              You’re signed in as <b>{session?.user.email}</b>. Enter the invite code whoever
              invited you gave you:
            </p>
            <input
              autoFocus
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              aria-label="Invite code"
              placeholder="e.g. K4W2M-8XPJ3"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void submitCode();
              }}
              style={{ marginTop: 8, width: '100%', letterSpacing: '0.08em' }}
            />
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
              Capitals, spaces and dashes don’t matter.
            </p>
            {error && <div className="banner">{error}</div>}
            <button
              className="primary"
              style={{ marginTop: 12, width: '100%' }}
              disabled={busy || code.trim().length === 0}
              onClick={() => void submitCode()}
            >
              {busy ? 'Checking…' : 'Use invite code'}
            </button>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 14 }}>
              No code? Ask someone who’s already here — anyone on the map can make you one.
            </p>
            <button
              style={{ marginTop: 12 }}
              onClick={() => void supabase.auth.signOut().then(() => setNeedsCode(false))}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <button
              className="google-btn"
              style={{ marginTop: 16, width: '100%' }}
              onClick={() => void signInWithGoogle()}
            >
              <span className="google-g">G</span> Continue with Google
            </button>
            {error && <div className="banner">{error}</div>}
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 14 }}>
              New here? Sign in with Google first — we’ll ask for your invite code next.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
