import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { addPlaceToTrip, createTrip, deleteTrip, fetchTripPlaces, fetchTripStats, fetchTrips } from '../lib/trips';
import type { Place, Trip, TripStats } from '../lib/types';

function TripCard({
  trip,
  canEdit,
  onDeleted,
}: {
  trip: Trip;
  canEdit: boolean;
  onDeleted: () => void;
}) {
  const [stats, setStats] = useState<TripStats | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchTripStats(trip.id)
      .then(setStats)
      .catch(() => setStats(null));
  }, [trip.id]);

  function loadPlaces() {
    fetchTripPlaces(trip)
      .then(setPlaces)
      .catch(() => setPlaces([]));
  }
  useEffect(loadPlaces, [trip.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addPlace() {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await addPlaceToTrip(trip, q);
      setQ('');
      loadPlaces();
      fetchTripStats(trip.id).then(setStats).catch(() => undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add place');
    }
    setBusy(false);
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="person-row">
        <b>{trip.name}</b>
        {canEdit && (
          <button
            className="danger"
            onClick={() => {
              if (confirm(`Delete trip "${trip.name}"? (Places and photos are not affected.)`)) {
                void deleteTrip(trip.id).then(onDeleted);
              }
            }}
          >
            Delete
          </button>
        )}
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 13 }}>
        {trip.start_date} → {trip.end_date}
      </div>
      <div className="trip-stats">
        <span>
          <b>{stats?.places ?? '…'}</b> places
        </span>
        <span>
          <b>{stats?.photos ?? '…'}</b> photos
        </span>
        <span>
          <b>{stats ? Number(stats.miles).toFixed(1) : '…'}</b> miles
        </span>
      </div>

      {/* Places in this trip — each is a real pin on the map */}
      {places && places.length > 0 && (
        <div className="trip-places">
          {places.map((p) => (
            <Link key={p.id} className="trip-place" to={`/place/${p.id}`}>
              📍 {p.name}
              {p.admin1 ? <span className="muted"> · {p.admin1}</span> : null}
            </Link>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="field-row" style={{ marginTop: 10 }}>
          <input
            placeholder="Add a place (e.g. Fort Bragg, NC)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void addPlace()}
          />
          <button className="primary" style={{ flex: 'none' }} disabled={busy} onClick={() => void addPlace()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      )}
      {err && <div className="banner">{err}</div>}
    </div>
  );
}

export default function Trips() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';
  const [trips, setTrips] = useState<Trip[]>([]);
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  function refresh() {
    fetchTrips()
      .then(setTrips)
      .catch(() => setMsg('Could not load trips'));
  }
  useEffect(refresh, []);

  async function add() {
    if (!name.trim() || !start || !end) return;
    try {
      await createTrip(name.trim(), start, end);
      setName('');
      setStart('');
      setEnd('');
      refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not create trip');
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 20px' }}>
      <Link className="back-bar" to="/">
        <span>Map</span>
      </Link>
      <h1>Trips</h1>
      <p style={{ color: 'var(--muted)' }}>
        A trip is a named date range. Add places to it below (each drops a pin on the map), and
        anywhere you visit within the dates joins automatically.
      </p>

      {canEdit && (
        <div className="card" style={{ margin: '16px 0 24px' }}>
          <b>New trip</b>
          <label>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Portugal 2026"
          />
          <div className="field-row">
            <div>
              <label>Start</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label>End</label>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="btn-row">
            <button className="primary" onClick={() => void add()}>
              Create trip
            </button>
          </div>
        </div>
      )}

      {msg && <div className="banner">{msg}</div>}
      {trips.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No trips yet.</p>
      ) : (
        trips.map((t) => <TripCard key={t.id} trip={t} canEdit={canEdit} onDeleted={refresh} />)
      )}
    </div>
  );
}
