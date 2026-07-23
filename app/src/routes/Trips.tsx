import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchPlaces } from '../lib/data';
import type { Place } from '../lib/types';

// Trips are just places tagged "trip" (the unified model). This page is a simple
// list — each opens its normal place card with its city-grouped members.
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
  const [places, setPlaces] = useState<Place[] | null>(null);

  function load() {
    fetchPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]));
  }
  useEffect(load, []);

  const trips = (places ?? [])
    .filter((p) => (p.categories ?? []).includes('trip') && !p.suggested)
    .filter((p) => !p.first_visit || p.first_visit >= CUTOFF)
    .sort((a, b) => (b.first_visit ?? '').localeCompare(a.first_visit ?? ''));

  return (
    <div style={{ maxWidth: 640, margin: '20px auto', padding: '0 16px' }}>
      <Link className="back-bar" to="/">
        <span>Map</span>
      </Link>
      <h1 className="bucket-title">Our Trips</h1>
      {places !== null && (
        <p style={{ color: 'var(--muted)', marginTop: 2 }}>
          <b>{trips.length}</b> trip{trips.length === 1 ? '' : 's'}
        </p>
      )}

      {places === null ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : trips.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>
          No trips yet. Add one with <b>+ Add → Trip</b> on the map.
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
