import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { detectTrips, fetchPlaces, resolveSuggestedTrip } from '../lib/data';
import type { Place } from '../lib/types';

// Trips are just places tagged "trip" (the unified model). This page lists them;
// each opens its normal place card with its city-grouped members. Auto-detected
// drafts (suggested=true) show at the top for one-tap Confirm / Not a trip.
const CUTOFF = '2025-12-21';

function fmtRange(p: Place): string {
  const s = p.first_visit;
  const e = p.last_visit;
  if (!s) return '';
  const d = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  return e && e !== s ? `${d(s)} – ${d(e)}` : d(s);
}

export default function Trips() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    fetchPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]));
  }
  useEffect(load, []);

  const all = (places ?? []).filter((p) => (p.categories ?? []).includes('trip'));
  const suggested = all
    .filter((p) => p.suggested)
    .sort((a, b) => (b.first_visit ?? '').localeCompare(a.first_visit ?? ''));
  const trips = all
    .filter((p) => !p.suggested)
    .filter((p) => !p.first_visit || p.first_visit >= CUTOFF)
    .sort((a, b) => (b.first_visit ?? '').localeCompare(a.first_visit ?? ''));

  async function runDetect() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await detectTrips();
      setMsg(
        r.suggested > 0
          ? `Found ${r.suggested} possible trip${r.suggested > 1 ? 's' : ''}.`
          : 'No new trips found.',
      );
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Detection failed.');
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id: string, keep: boolean) {
    try {
      await resolveSuggestedTrip(id, keep);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not update.');
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '20px auto', padding: '0 16px' }}>
      <Link className="back-bar" to="/">
        <span>Map</span>
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 className="bucket-title">All Our Trips</h1>
        {isOwner && (
          <button disabled={busy} onClick={() => void runDetect()}>
            {busy ? 'Scanning…' : 'Detect trips'}
          </button>
        )}
      </div>
      {msg && <div className="banner">{msg}</div>}

      {suggested.length > 0 && (
        <div style={{ margin: '10px 0 18px' }}>
          <h3 style={{ marginBottom: 8 }}>Suggested — confirm these</h3>
          {suggested.map((t) => (
            <div key={t.id} className="entry" style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>{t.name || 'Trip'}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{fmtRange(t)}</div>
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button className="save-btn-green" onClick={() => void resolve(t.id, true)}>
                  It's a trip
                </button>
                <Link to={`/place/${t.id}`}>
                  <button>Review</button>
                </Link>
                <button className="danger" onClick={() => void resolve(t.id, false)}>
                  Not a trip
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {places === null ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : trips.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>
          No trips yet. Add one with <b>+ Add → Trip</b> on the map, or tap <b>Detect trips</b> to
          find them from your photos and activities.
        </p>
      ) : (
        <div className="trip-places" style={{ marginTop: 14 }}>
          {trips.map((t) => (
            <Link key={t.id} className="trip-place" to={`/place/${t.id}`}>
              {t.name || 'Untitled trip'}
              {fmtRange(t) && (
                <span className="place-row-cats" style={{ marginLeft: 8, color: 'var(--muted)' }}>
                  {fmtRange(t)}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
