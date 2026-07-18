import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';

/**
 * Invite-only login. Signups are disabled in Supabase Auth, so
 * `signInWithOtp` only delivers a link to addresses that already exist (created
 * by the `invite` Edge Function). Unknown addresses silently succeed here but
 * never receive an email — we don't reveal which is which.
 */
export default function Login() {
  const { session, profile, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [noAccess, setNoAccess] = useState(false);

  // Signed in via magic link but no profile → invited email mismatch / revoked.
  useEffect(() => {
    if (!loading && session && !profile) setNoAccess(true);
  }, [loading, session, profile]);

  if (!loading && session && profile) return <Navigate to="/" replace />;

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin + '/login',
        shouldCreateUser: false, // invite-only: never create accounts here
      },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="center-screen">
      <div className="login-card">
        <h1>adventure or no</h1>
        <p>Private map — invite only.</p>

        {noAccess ? (
          <>
            <div className="banner">
              You’re signed in, but this account has no access yet. Ask the owner for an invite to
              this email, then use the link they send.
            </div>
            <button onClick={() => void supabase.auth.signOut().then(() => setNoAccess(false))}>
              Sign out
            </button>
          </>
        ) : sent ? (
          <p>
            If that address was invited, a sign-in link is on its way. Open it on this device to
            continue.
          </p>
        ) : (
          <form onSubmit={requestLink}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            {error && <div className="banner">{error}</div>}
            <button className="primary" style={{ marginTop: 14, width: '100%' }} disabled={busy}>
              {busy ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
