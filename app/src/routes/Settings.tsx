import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export default function Settings() {
  const { profile, signOut } = useAuth();

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 20px' }}>
      <p>
        <Link to="/">← Back to map</Link>
      </p>
      <h1>Settings</h1>
      <p style={{ color: 'var(--muted)' }}>
        Signed in as <b>{profile?.display_name ?? 'you'}</b> · role <b>{profile?.role}</b>
      </p>

      <h2 style={{ marginTop: 28 }}>Account</h2>
      <button onClick={() => void signOut()}>Sign out</button>

      <h2 style={{ marginTop: 28 }}>Coming soon</h2>
      <ul style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
        <li>Invites &amp; roles (Phase 5)</li>
        <li>Photo uploads (Phase 2)</li>
        <li>Location &amp; Strava import (Phase 3–4)</li>
        <li>Timeline import (Phase 6)</li>
      </ul>
    </div>
  );
}
