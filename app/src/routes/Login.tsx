import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { fetchMyJoinRequest, submitJoinRequest, type JoinRequest } from '../lib/join';

/**
 * Sign in with Google. If the signed-in account has no profile yet, the user can
 * request to join; the owner approves them (viewer or contributor) from Settings.
 */
export default function Login() {
  const { session, profile, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [myReq, setMyReq] = useState<JoinRequest | null>(null);

  // Signed in but no profile → let them ask to join.
  useEffect(() => {
    if (!loading && session && !profile) {
      setNoAccess(true);
      void fetchMyJoinRequest().then(setMyReq);
    }
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

  async function requestToJoin() {
    setBusy(true);
    setError(null);
    try {
      await submitJoinRequest(note);
      setMyReq(await fetchMyJoinRequest());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send request');
    }
    setBusy(false);
  }

  return (
    <div className="center-screen">
      <div className="login-card">
        <h1>adventure or no</h1>
        <p>Private map — invite only.</p>

        {noAccess ? (
          <>
            {myReq && myReq.status === 'pending' ? (
              <div className="banner">
                Your request to join is in — the owner will approve it soon. Check back later.
              </div>
            ) : myReq && myReq.status === 'denied' ? (
              <div className="banner">This account wasn’t approved for access.</div>
            ) : (
              <>
                <p style={{ marginTop: 6 }}>
                  You’re signed in as <b>{session?.user.email}</b>, but don’t have access yet. Ask
                  the owner to let you in:
                </p>
                <textarea
                  placeholder="Add a note (optional) — e.g. “It’s me, Josh!”"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ minHeight: 60, marginTop: 8 }}
                />
                {error && <div className="banner">{error}</div>}
                <button
                  className="primary"
                  style={{ marginTop: 12, width: '100%' }}
                  disabled={busy}
                  onClick={() => void requestToJoin()}
                >
                  {busy ? 'Sending…' : 'Request to join'}
                </button>
              </>
            )}
            <button
              style={{ marginTop: 12 }}
              onClick={() => void supabase.auth.signOut().then(() => setNoAccess(false))}
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
              New here? Sign in with Google and you’ll be able to request access.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
