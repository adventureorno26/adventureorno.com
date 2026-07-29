import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import type { Place, Trip, TripStats, TripStop } from '../lib/types';
import {
  addPlaceToTrip,
  deleteTrip,
  fetchTripPlaces,
  fetchTripStats,
  fetchTripStops,
  fetchTrips,
  removeStop,
  renameTrip,
  setTripStatus,
  updateTripDates,
} from '../lib/trips';
import TripItinerary from '../components/TripItinerary';

function fmtRange(s: string | null, e: string | null): string {
  if (!s) return 'No dates set';
  const d = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  return e && e !== s ? `${d(s)} – ${d(e)}` : d(s);
}

export default function TripView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';

  const [trip, setTrip] = useState<Trip | null>(null);
  const [stats, setStats] = useState<TripStats | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [stops, setStops] = useState<TripStop[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const all = await fetchTrips();
    const t = all.find((x) => x.id === id) ?? null;
    if (!t) {
      setNotFound(true);
      return;
    }
    setTrip(t);
    setName(t.name);
    setStart(t.start_date ?? '');
    setEnd(t.end_date ?? '');
    const [st, pl, so] = await Promise.all([
      fetchTripStats(id).catch(() => null),
      fetchTripPlaces(t).catch(() => []),
      fetchTripStops(id).catch(() => []),
    ]);
    setStats(st);
    setPlaces(pl);
    setStops(so);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusById = new Map(stops.map((s) => [s.place_id, s.status] as const));
  const stopIdByPlace = new Map(stops.filter((s) => !s.visit_id).map((s) => [s.place_id, s.id]));

  async function add() {
    if (!trip || !adding.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await addPlaceToTrip(trip, adding);
      setAdding('');
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not add that place.');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdits() {
    if (!trip) return;
    setBusy(true);
    try {
      if (name.trim() && name.trim() !== trip.name) await renameTrip(trip.id, name.trim());
      if (start && end) await updateTripDates(trip.id, start, end);
      setEditing(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <div style={{ maxWidth: 640, margin: '20px auto', padding: '0 16px' }}>
        <Link className="back-bar" to="/trips">
          <span>Trips</span>
        </Link>
        <p style={{ color: 'var(--muted)' }}>That trip no longer exists.</p>
      </div>
    );
  }
  if (!trip) {
    return (
      <div style={{ maxWidth: 640, margin: '20px auto', padding: '0 16px' }}>
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '20px auto', padding: '0 16px' }}>
      <Link className="back-bar" to="/trips">
        <span>Trips</span>
      </Link>

      {editing ? (
        <div className="card">
          <label>Trip name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <div className="field-row" style={{ marginTop: 8 }}>
            <div>
              <label>From</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label>To</label>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="btn-row">
            <button className="primary" disabled={busy} onClick={() => void saveEdits()}>
              Save
            </button>
            <button onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <h1 className="bucket-title">{trip.name || 'Untitled trip'}</h1>
          <p style={{ color: 'var(--muted)', marginTop: 2 }}>
            {fmtRange(trip.start_date, trip.end_date)}
            {trip.status === 'upcoming' ? ' · Upcoming' : ''}
          </p>
        </>
      )}

      {stats && (
        <p style={{ color: 'var(--muted)', marginTop: 6 }}>
          <b>{stats.places}</b> place{stats.places === 1 ? '' : 's'} · <b>{stats.visits}</b> visit
          {stats.visits === 1 ? '' : 's'} · <b>{stats.miles}</b> mi
          {stats.days ? (
            <>
              {' '}
              · <b>{stats.days}</b> day{stats.days === 1 ? '' : 's'}
            </>
          ) : null}
        </p>
      )}

      <h2 style={{ marginTop: 22 }}>Places on this trip</h2>
      {places.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No places on this trip yet.</p>
      ) : (
        <div className="trip-places" style={{ marginTop: 8 }}>
          {places.map((p) => (
            <div
              key={p.id}
              className="trip-place"
              style={{ display: 'flex', alignItems: 'center' }}
            >
              <Link to={`/place/${p.id}`} style={{ flex: 1, color: 'inherit' }}>
                {p.name || 'Unnamed place'}
                <span className="place-row-cats" style={{ marginLeft: 8, color: 'var(--muted)' }}>
                  {statusById.get(p.id) === 'completed' ? 'Visited' : 'Planned'}
                </span>
              </Link>
              {canEdit && stopIdByPlace.has(p.id) && (
                <button
                  aria-label={`Remove ${p.name} from this trip`}
                  onClick={() => {
                    const sid = stopIdByPlace.get(p.id);
                    if (sid) void removeStop(sid).then(load);
                  }}
                  style={{ marginLeft: 8 }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="card" style={{ marginTop: 12 }}>
          <label>Add a place to this trip</label>
          <div className="btn-row" style={{ marginTop: 4 }}>
            <input
              value={adding}
              placeholder="Search a place or address"
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
              style={{ flex: 1 }}
            />
            <button
              className="primary"
              disabled={busy || !adding.trim()}
              onClick={() => void add()}
            >
              Add
            </button>
          </div>
          {msg && (
            <div className="banner" style={{ marginTop: 8 }}>
              {msg}
            </div>
          )}
        </div>
      )}

      <h2 style={{ marginTop: 22 }}>Itinerary</h2>
      <TripItinerary tripId={trip.id} canEdit={canEdit} />

      {canEdit && !editing && (
        <div className="btn-row" style={{ marginTop: 22 }}>
          <button onClick={() => setEditing(true)}>Edit trip</button>
          <button
            onClick={() =>
              void setTripStatus(trip.id, trip.status === 'upcoming' ? 'taken' : 'upcoming').then(
                load,
              )
            }
          >
            Mark {trip.status === 'upcoming' ? 'taken' : 'upcoming'}
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Delete the trip "${trip.name}"? Its places are not deleted.`)) {
                void deleteTrip(trip.id).then(() => navigate('/trips'));
              }
            }}
          >
            Delete trip
          </button>
        </div>
      )}
    </div>
  );
}
