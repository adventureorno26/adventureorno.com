import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { lastAutomatedUpload, photosEnabled } from '../lib/photos';

function timeAgo(iso: string): { text: string; hours: number } {
  const then = new Date(iso).getTime();
  const hours = (Date.now() - then) / 3_600_000;
  if (hours < 1) return { text: 'less than an hour ago', hours };
  if (hours < 48) return { text: `${Math.round(hours)} h ago`, hours };
  return { text: `${Math.round(hours / 24)} days ago`, hours };
}

function PhotoHealthCard() {
  const [ts, setTs] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    lastAutomatedUpload().then(setTs);
  }, []);

  if (!photosEnabled()) return null;
  const info = ts ? timeAgo(ts) : null;
  const stale = info ? info.hours > 48 : true;

  return (
    <div className={`card ${stale ? 'card-warn' : ''}`} style={{ marginTop: 16 }}>
      <b>Photo automation</b>
      <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
        {ts === undefined
          ? 'Checking…'
          : ts === null
            ? 'No automated upload has run yet.'
            : `Last automated upload: ${info?.text}`}
      </div>
      {stale && ts !== undefined && (
        <div style={{ color: '#ffd28a', fontSize: 13, marginTop: 6 }}>
          ⚠️ The daily photo Shortcut hasn’t checked in within 48 h — it may have silently stopped.
          Open the Shortcuts app on Erica’s phone and run it once.
        </div>
      )}
    </div>
  );
}

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

      {profile?.role === 'owner' && (
        <>
          <h2 style={{ marginTop: 28 }}>Photos</h2>
          <PhotoHealthCard />
        </>
      )}

      <h2 style={{ marginTop: 28 }}>Coming soon</h2>
      <ul style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
        <li>Location &amp; Strava import (Phase 3–4)</li>
        <li>Invites &amp; roles, trips (Phase 5)</li>
        <li>Timeline import (Phase 6)</li>
      </ul>
    </div>
  );
}
