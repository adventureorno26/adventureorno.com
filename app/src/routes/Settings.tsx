import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { fetchHomeZone, triggerGeocode, updateHomeZone, type HomeZone } from '../lib/data';
import { backfillPage, isStravaConnected, stravaAuthorizeUrl } from '../lib/strava';
import PeopleCard from '../components/PeopleCard';
import { runClusteringNow } from '../lib/timeline';
import {
  approveJoinRequest,
  denyJoinRequest,
  fetchPendingJoinRequests,
  type JoinRequest,
} from '../lib/join';

const METERS_PER_MILE = 1609.344;

function JoinRequestsCard() {
  const [reqs, setReqs] = useState<JoinRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    fetchPendingJoinRequests()
      .then(setReqs)
      .catch(() => setReqs([]));
  }
  useEffect(load, []);

  async function act(r: JoinRequest, action: 'viewer' | 'editor' | 'deny') {
    setBusy(r.id);
    setMsg(null);
    try {
      if (action === 'deny') await denyJoinRequest(r.id);
      else await approveJoinRequest(r.id, action);
      setMsg(
        action === 'deny'
          ? `Denied ${r.email ?? 'request'}.`
          : `Approved ${r.email ?? 'request'} as ${action === 'editor' ? 'contributor' : 'viewer'}.`,
      );
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not update request');
    }
    setBusy(null);
  }

  if (reqs === null) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;
  return (
    <div className="card">
      {reqs.length === 0 ? (
        <p style={{ color: 'var(--muted)', margin: 0 }}>No pending requests.</p>
      ) : (
        reqs.map((r) => (
          <div key={r.id} className="join-req">
            <div>
              <b>{r.display_name ?? r.email ?? 'Someone'}</b>
              {r.email && r.display_name ? (
                <span className="muted"> · {r.email}</span>
              ) : null}
              {r.note ? <div className="muted" style={{ fontSize: 13 }}>“{r.note}”</div> : null}
            </div>
            <div className="join-req-actions">
              <button
                className="primary"
                disabled={busy === r.id}
                onClick={() => void act(r, 'editor')}
              >
                Approve · Contributor
              </button>
              <button disabled={busy === r.id} onClick={() => void act(r, 'viewer')}>
                Viewer
              </button>
              <button className="danger" disabled={busy === r.id} onClick={() => void act(r, 'deny')}>
                Deny
              </button>
            </div>
          </div>
        ))
      )}
      {msg && <div className="banner" style={{ marginTop: 10 }}>{msg}</div>}
    </div>
  );
}

function HomeZoneCard() {
  const [zone, setZone] = useState<HomeZone | null>(null);
  const [miles, setMiles] = useState('15');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchHomeZone()
      .then((z) => {
        setZone(z);
        setLat(String(z.lat));
        setLng(String(z.lng));
        setMiles((z.radius_m / METERS_PER_MILE).toFixed(1));
      })
      .catch(() => setMsg('Could not load home zone'));
  }, []);

  async function save() {
    setMsg(null);
    try {
      const next: HomeZone = {
        lat: Number(lat),
        lng: Number(lng),
        radius_m: Math.round(Number(miles) * METERS_PER_MILE),
      };
      await updateHomeZone(next);
      setZone(next);
      setMsg('Saved. New ingests use this immediately.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save');
    }
  }

  if (!zone) return <div className="card">Loading home zone…</div>;
  return (
    <div className="card">
      <b>Home exclusion zone</b>
      <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 8px' }}>
        A fixed spot — it does <b>not</b> follow you around. Photos and pings within this radius are
        never stored (Strava Hike/Walk/Run are the only exception). Set it once from where you live.
      </div>
      <div className="btn-row" style={{ marginTop: 0, marginBottom: 4 }}>
        <button
          onClick={() => {
            setMsg('Getting your location…');
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                setLat(pos.coords.latitude.toFixed(6));
                setLng(pos.coords.longitude.toFixed(6));
                setMsg('Filled in your current location — tap Save home zone to confirm.');
              },
              () => setMsg('Could not get your location. Allow location access and try again.'),
              { enableHighAccuracy: true },
            );
          }}
        >
          📍 Use my current location
        </button>
      </div>
      <div className="field-row">
        <div>
          <label>Center latitude</label>
          <input value={lat} onChange={(e) => setLat(e.target.value)} />
        </div>
        <div>
          <label>Center longitude</label>
          <input value={lng} onChange={(e) => setLng(e.target.value)} />
        </div>
        <div>
          <label>Radius (miles)</label>
          <input value={miles} onChange={(e) => setMiles(e.target.value)} />
        </div>
      </div>
      <div className="btn-row">
        <button className="primary" onClick={() => void save()}>
          Save home zone
        </button>
      </div>
      {msg && (
        <div className="banner" style={{ marginTop: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}

function GeocodeCard() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function name() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await triggerGeocode();
      setMsg(`Named ${r.named} of ${r.considered} pending place(s).`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    }
    setBusy(false);
  }
  async function cluster() {
    setBusy(true);
    setMsg(null);
    try {
      const c = await runClusteringNow();
      setMsg(
        `Clustered ${c.points} points → ${c.clusters_created} new, ${c.clusters_attached} attached.`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    }
    setBusy(false);
  }
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <b>Auto-created places</b>
      <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 8px' }}>
        The nightly job clusters photos + location pings into places and names them. Run it now
        after a backfill or import.
      </div>
      <div className="btn-row" style={{ marginTop: 0 }}>
        <button disabled={busy} onClick={() => void cluster()}>
          {busy ? 'Working…' : 'Cluster now'}
        </button>
        <button disabled={busy} onClick={() => void name()}>
          Name new places
        </button>
        <Link to="/settings/import">
          <button>Import Google Timeline…</button>
        </Link>
      </div>
      {msg && (
        <div className="banner" style={{ marginTop: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function StravaCard({ ownerId }: { ownerId: string }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const clientId = import.meta.env.VITE_STRAVA_CLIENT_ID;

  useEffect(() => {
    isStravaConnected().then(setConnected);
    const params = new URLSearchParams(window.location.search);
    if (params.get('strava') === 'connected') setConnected(true);
  }, []);

  async function runBackfill(days: number) {
    setRunning(true);
    setProgress('Starting…');
    const before = Math.floor(Date.now() / 1000);
    const after = before - days * 86400;
    let page = 1;
    let stored = 0;
    let processed = 0;
    try {
      for (;;) {
        const r = await backfillPage(after, before, page);
        stored += r.stored;
        processed += r.processed;
        setProgress(`Page ${page}: ${processed} activities scanned, ${stored} stored…`);
        if (!r.hasMore) break;
        page++;
        await sleep(1500); // gentle pacing under the 100/15min limit
      }
      setProgress(`Done — ${stored} activities stored from the last ${days} days.`);
    } catch (e) {
      setProgress(e instanceof Error ? e.message : 'Backfill failed');
    }
    setRunning(false);
  }

  if (!clientId) {
    return (
      <div className="card">
        <b>Strava</b>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
          Set <code>VITE_STRAVA_CLIENT_ID</code> (and the server secrets) after creating the Strava
          API app — see MANUAL-SETUP §6.
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <b>Strava</b>
      {connected === null ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>Checking…</div>
      ) : connected ? (
        <>
          <div style={{ color: '#4dd07a', fontSize: 13, margin: '4px 0 10px' }}>
            ✓ Connected. New activities import automatically via webhook.
          </div>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button disabled={running} onClick={() => void runBackfill(365)}>
              {running ? 'Importing…' : 'Backfill last 12 months'}
            </button>
            <button disabled={running} onClick={() => void runBackfill(30)}>
              Last 30 days
            </button>
          </div>
          {progress && (
            <div className="banner" style={{ marginTop: 8 }}>
              {progress}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 10px' }}>
            Connect Strava to auto-import hikes, walks, runs, and rides.
          </div>
          <a href={stravaAuthorizeUrl(clientId, ownerId)}>
            <button className="primary">Connect Strava</button>
          </a>
        </>
      )}
    </div>
  );
}

export default function Settings() {
  const { profile, signOut } = useAuth();

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 20px' }}>
      <Link className="back-bar" to="/">
        <span>Map</span>
      </Link>
      <h1>Settings</h1>
      <p style={{ color: 'var(--muted)' }}>
        Signed in as <b>{profile?.display_name ?? 'you'}</b> · role <b>{profile?.role}</b>
      </p>

      <h2 style={{ marginTop: 28 }}>Account</h2>
      <button onClick={() => void signOut()}>Sign out</button>

      {profile?.role === 'owner' && (
        <>
          <h2 style={{ marginTop: 28 }}>Join requests</h2>
          <JoinRequestsCard />

          <h2 style={{ marginTop: 28 }}>People</h2>
          <PeopleCard meId={profile.id} />

          <h2 style={{ marginTop: 28 }}>Places &amp; location</h2>
          <HomeZoneCard />
          <GeocodeCard />

          <h2 style={{ marginTop: 28 }}>Strava</h2>
          <StravaCard ownerId={profile.id} />
        </>
      )}
    </div>
  );
}
