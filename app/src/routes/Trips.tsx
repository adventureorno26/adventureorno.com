import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { fetchSuggestedTripDrafts, fetchTrips } from '../lib/trips';
import { resolveSuggestedTrip } from '../lib/data';
import type { Place, Trip } from '../lib/types';

// Trips are a first-class entity (trips table). A trip is a trip TO one or more
// places. Listed newest first, grouped by month + year. Auto-detected drafts are
// shown separately as suggestions to confirm or dismiss — never as trips.
function monthYear(iso: string | null): string {
  if (!iso) return 'Undated';
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function fmtRange(s: string | null, e: string | null): string {
  if (!s) return '';
  const d = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return e && e !== s ? `${d(s)} – ${d(e)}` : d(s);
}

export default function Trips() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [suggested, setSuggested] = useState<Place[]>([]);
  const [showAllSuggested, setShowAllSuggested] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const SUGGESTED_CAP = 5;

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([
      fetchTrips().catch(() => []),
      canEdit ? fetchSuggestedTripDrafts().catch(() => []) : Promise.resolve([]),
    ]);
    setTrips(t);
    setSuggested(s);
  }, [canEdit]);

  useEffect(() => {
    void load();
  }, [load]);

  async function dismiss(p: Place) {
    setBusy(p.id);
    try {
      await resolveSuggestedTrip(p.id, false);
      setSuggested((prev) => prev.filter((x) => x.id !== p.id));
    } finally {
      setBusy(null);
    }
  }

  // Preserve fetch order (newest first) while grouping by month/year.
  const groups: { label: string; trips: Trip[] }[] = [];
  for (const t of trips ?? []) {
    const label = monthYear(t.start_date);
    const g = groups.find((x) => x.label === label);
    if (g) g.trips.push(t);
    else groups.push({ label, trips: [t] });
  }

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <Link className="back-bar" to="/">
        <span>Map</span>
      </Link>
      <h1 className="bucket-title">Our Trips</h1>
      {trips !== null && (
        <p style={{ color: 'var(--muted)', marginTop: 2 }}>
          <b>{trips.length}</b> trip{trips.length === 1 ? '' : 's'}
        </p>
      )}

      {canEdit && suggested.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h2 style={{ marginBottom: 8 }}>Suggested — review to confirm ({suggested.length})</h2>
          <div className="trip-places">
            {(showAllSuggested ? suggested : suggested.slice(0, SUGGESTED_CAP)).map((p) => (
              <div
                key={p.id}
                className="trip-place"
                style={{ display: 'flex', alignItems: 'center' }}
              >
                <span style={{ flex: 1 }}>
                  {p.name || 'Possible trip'}
                  {fmtRange(p.first_visit, p.last_visit) && (
                    <span
                      className="place-row-cats"
                      style={{ marginLeft: 8, color: 'var(--muted)' }}
                    >
                      {fmtRange(p.first_visit, p.last_visit)}
                    </span>
                  )}
                </span>
                <button
                  className="primary"
                  disabled={busy === p.id}
                  onClick={() => navigate(`/trips/review/${p.id}`)}
                  style={{ marginLeft: 8 }}
                >
                  Review
                </button>
                <button
                  disabled={busy === p.id}
                  onClick={() => void dismiss(p)}
                  style={{ marginLeft: 6 }}
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
          {suggested.length > SUGGESTED_CAP && (
            <button onClick={() => setShowAllSuggested((v) => !v)} style={{ marginTop: 8 }}>
              {showAllSuggested ? 'Show fewer' : `Show all ${suggested.length} suggestions`}
            </button>
          )}
        </div>
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
                  {fmtRange(t.start_date, t.end_date) && (
                    <span
                      className="place-row-cats"
                      style={{ marginLeft: 8, color: 'var(--muted)' }}
                    >
                      {fmtRange(t.start_date, t.end_date)}
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
