import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTrips } from '../lib/trips';
import type { Trip } from '../lib/types';

// Trips are a first-class entity (trips table). A trip is a trip TO one or more
// places. Listed newest first, grouped by month + year.
function monthYear(iso: string | null): string {
  if (!iso) return 'Undated';
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function fmtRange(t: Trip): string {
  const s = t.start_date;
  const e = t.end_date;
  if (!s) return '';
  const d = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return e && e !== s ? `${d(s)} – ${d(e)}` : d(s);
}

export default function Trips() {
  const [trips, setTrips] = useState<Trip[] | null>(null);

  useEffect(() => {
    fetchTrips()
      .then(setTrips)
      .catch(() => setTrips([]));
  }, []);

  // Preserve fetch order (newest first) while grouping by month/year.
  const groups: { label: string; trips: Trip[] }[] = [];
  for (const t of trips ?? []) {
    const label = monthYear(t.start_date);
    const g = groups.find((x) => x.label === label);
    if (g) g.trips.push(t);
    else groups.push({ label, trips: [t] });
  }

  return (
    <div style={{ maxWidth: 640, margin: '20px auto', padding: '0 16px' }}>
      <Link className="back-bar" to="/">
        <span>Map</span>
      </Link>
      <h1 className="bucket-title">Our Trips</h1>
      {trips !== null && (
        <p style={{ color: 'var(--muted)', marginTop: 2 }}>
          <b>{trips.length}</b> trip{trips.length === 1 ? '' : 's'}
        </p>
      )}

      {trips === null ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : trips.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>
          No trips yet. Add one with <b>+ Add → Trip</b> on the map.
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.label} style={{ marginTop: 18 }}>
            <h2 style={{ marginBottom: 8 }}>{g.label}</h2>
            <div className="trip-places">
              {g.trips.map((t) => (
                <Link key={t.id} className="trip-place" to={`/trip/${t.id}`}>
                  {t.name || 'Untitled trip'}
                  {fmtRange(t) && (
                    <span
                      className="place-row-cats"
                      style={{ marginLeft: 8, color: 'var(--muted)' }}
                    >
                      {fmtRange(t)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
