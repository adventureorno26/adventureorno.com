import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  addPlaceToTrip,
  createTrip,
  deleteTrip,
  fetchTripPlaces,
  fetchTripStats,
  fetchTrips,
  mergeTrips,
  renameTrip,
  setTripStatus,
  updateTripDates,
} from '../lib/trips';
import { fetchBucketPlaces } from '../lib/data';
import type { Place, Trip, TripStats, TripStatus } from '../lib/types';
import { BucketIcon, PinIcon } from '../components/Icons';

function TripCard({
  trip,
  canEdit,
  onDeleted,
  onChanged,
  selectable,
  selected,
  onToggleSelect,
}: {
  trip: Trip;
  canEdit: boolean;
  onDeleted: () => void;
  onChanged: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [stats, setStats] = useState<TripStats | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingDates, setEditingDates] = useState(false);
  const [eStart, setEStart] = useState(trip.start_date ?? '');
  const [eEnd, setEEnd] = useState(trip.end_date ?? trip.start_date ?? '');
  const [editingName, setEditingName] = useState(false);
  const [nm, setNm] = useState(trip.name);

  async function saveDates() {
    if (!eStart) return;
    const end = eEnd && eEnd >= eStart ? eEnd : eStart;
    setErr(null);
    try {
      await updateTripDates(trip.id, eStart, end);
      setEditingDates(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update dates');
    }
  }

  async function saveName() {
    setEditingName(false);
    if (nm.trim() && nm.trim() !== trip.name) {
      try {
        await renameTrip(trip.id, nm.trim());
        onChanged();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not rename');
      }
    } else {
      setNm(trip.name);
    }
  }

  async function move(status: TripStatus) {
    try {
      await setTripStatus(trip.id, status);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not move trip');
    }
  }

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          {selectable && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={onToggleSelect}
              style={{ width: 'auto' }}
              title="Select to merge"
            />
          )}
          {editingName && canEdit ? (
            <input
              value={nm}
              autoFocus
              onChange={(e) => setNm(e.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveName();
                if (e.key === 'Escape') {
                  setNm(trip.name);
                  setEditingName(false);
                }
              }}
            />
          ) : (
            <b
              className={canEdit ? 'title-editable' : undefined}
              onClick={() => canEdit && setEditingName(true)}
              title={canEdit ? 'Tap to rename' : undefined}
            >
              {trip.name}
            </b>
          )}
        </div>
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
      {editingDates ? (
        <div className="field-row" style={{ marginTop: 6 }}>
          <div>
            <label>Start</label>
            <input type="date" value={eStart} onChange={(e) => setEStart(e.target.value)} />
          </div>
          <div>
            <label>End</label>
            <input type="date" value={eEnd} onChange={(e) => setEEnd(e.target.value)} />
          </div>
          <button className="primary" style={{ flex: 'none' }} onClick={() => void saveDates()}>
            Save
          </button>
          <button style={{ flex: 'none' }} onClick={() => setEditingDates(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div
          style={{ color: 'var(--muted)', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <span>
            {trip.start_date} → {trip.end_date}
          </span>
          {canEdit && (
            <button
              className="link-btn"
              style={{ marginTop: 0 }}
              onClick={() => {
                setEStart(trip.start_date ?? '');
                setEEnd(trip.end_date ?? trip.start_date ?? '');
                setEditingDates(true);
              }}
            >
              Edit dates
            </button>
          )}
          {canEdit && (
            <button
              className="link-btn"
              style={{ marginTop: 0 }}
              onClick={() => void move(trip.status === 'taken' ? 'upcoming' : 'taken')}
            >
              {trip.status === 'taken' ? 'Move to Upcoming' : 'Move to Trips Taken'}
            </button>
          )}
        </div>
      )}
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
              <span className="result-pin">
                <PinIcon size={13} />
              </span>{' '}
              {p.name}
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
  const [bucket, setBucket] = useState<Place[]>([]);
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [newStatus, setNewStatus] = useState<TripStatus>('taken');
  const [msg, setMsg] = useState<string | null>(null);
  const [mergeSel, setMergeSel] = useState<Set<string>>(new Set());

  function refresh() {
    fetchTrips()
      .then(setTrips)
      .catch(() => setMsg('Could not load trips'));
    fetchBucketPlaces()
      .then(setBucket)
      .catch(() => setBucket([]));
  }
  useEffect(refresh, []);

  async function add() {
    if (!name.trim() || !start) return;
    try {
      await createTrip(name.trim(), start, end || start, newStatus);
      setName('');
      setStart('');
      setEnd('');
      refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not create trip');
    }
  }

  function toggleMerge(id: string) {
    setMergeSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function doMerge() {
    if (mergeSel.size < 2) return;
    if (!confirm(`Merge ${mergeSel.size} trips into one spanning all their dates?`)) return;
    try {
      await mergeTrips([...mergeSel]);
      setMergeSel(new Set());
      refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not merge trips');
    }
  }

  const taken = trips.filter((t) => t.status === 'taken');
  const upcoming = trips.filter((t) => t.status === 'upcoming');

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 20px' }}>
      <Link className="back-bar" to="/">
        <span>Map</span>
      </Link>
      <h1>My Trips</h1>
      <p style={{ color: 'var(--muted)' }}>
        A trip is a named date range. Add places to it (each drops a pin on the map), and anywhere
        you visit within the dates joins automatically. Log days as you go, then merge them into one
        trip.
      </p>

      {canEdit && (
        <div className="card" style={{ margin: '16px 0 24px' }}>
          <b>New trip</b>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Portugal 2026" />
          <div className="field-row">
            <div>
              <label>Start</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label>End</label>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div>
              <label>Section</label>
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as TripStatus)}>
                <option value="taken">Trips Taken</option>
                <option value="upcoming">Upcoming</option>
              </select>
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

      {/* ---------- Trips Taken ---------- */}
      <div className="trips-section-head">
        <h2>Trips Taken</h2>
        {canEdit && mergeSel.size >= 2 && (
          <button className="primary" onClick={() => void doMerge()}>
            Merge {mergeSel.size} into one
          </button>
        )}
      </div>
      {canEdit && taken.length > 1 && (
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: -4 }}>
          Tick two or more day-by-day trips to merge them into a single trip.
        </p>
      )}
      {taken.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No trips logged yet.</p>
      ) : (
        taken.map((t) => (
          <TripCard
            key={t.id}
            trip={t}
            canEdit={canEdit}
            onDeleted={refresh}
            onChanged={refresh}
            selectable={canEdit}
            selected={mergeSel.has(t.id)}
            onToggleSelect={() => toggleMerge(t.id)}
          />
        ))
      )}

      {/* ---------- Upcoming Trips ---------- */}
      <div className="trips-section-head" style={{ marginTop: 28 }}>
        <h2>Upcoming Trips</h2>
      </div>
      {upcoming.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>Nothing planned yet.</p>
      ) : (
        upcoming.map((t) => (
          <TripCard key={t.id} trip={t} canEdit={canEdit} onDeleted={refresh} onChanged={refresh} />
        ))
      )}

      {/* ---------- Bucket List ---------- */}
      <div className="trips-section-head" style={{ marginTop: 28 }}>
        <h2 className="bucket-title">
          <span className="bucket-title-ico">
            <BucketIcon size={20} />
          </span>
          Bucket List
        </h2>
        <Link className="link-btn" to="/bucket">
          Open Bucket List
        </Link>
      </div>
      {bucket.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>
          No bucket-list places yet. <Link to="/bucket">Add somewhere you want to go →</Link>
        </p>
      ) : (
        <div className="trip-places">
          {bucket.map((p) => (
            <Link key={p.id} className="trip-place" to={`/place/${p.id}`}>
              <span className="result-pin bucket">
                <PinIcon size={13} />
              </span>{' '}
              {p.name}
              {p.admin1 ? <span className="muted"> · {p.admin1}</span> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
