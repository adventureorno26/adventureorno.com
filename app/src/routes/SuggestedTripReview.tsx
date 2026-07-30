import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import type { Place } from '../lib/types';
import { resolveSuggestedTrip, updatePlace } from '../lib/data';
import {
  confirmSuggestedTrip,
  fetchDraftMembers,
  fetchPlaceById,
  removeDraftMember,
} from '../lib/trips';

// Review + edit an auto-detected trip suggestion before saving it to Our Trips. A
// suggestion is never a trip until you save it here; Dismiss discards it.
export default function SuggestedTripReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';

  const [draft, setDraft] = useState<Place | null>(null);
  const [members, setMembers] = useState<Place[]>([]);
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const p = await fetchPlaceById(id);
    if (!p || p.category !== 'trip' || !p.suggested) {
      setNotFound(true);
      return;
    }
    setDraft(p);
    setName(p.name ?? '');
    setStart(p.first_visit ?? '');
    setEnd(p.last_visit ?? '');
    setMembers(await fetchDraftMembers(id).catch(() => []));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeMember(m: Place) {
    if (!draft) return;
    setBusy(true);
    try {
      await removeDraftMember(m.id, draft.id);
      setMembers((prev) => prev.filter((x) => x.id !== m.id));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    if (!start || !end) {
      setMsg('Set a start and end date before saving.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await updatePlace(draft.id, {
        name: name.trim() || 'Trip',
        first_visit: start,
        last_visit: end,
      });
      const tripId = await confirmSuggestedTrip(draft.id);
      if (tripId) navigate(`/trip/${tripId}`);
      else setMsg('Could not save — check the dates and try again.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (!draft) return;
    setBusy(true);
    try {
      await resolveSuggestedTrip(draft.id, false);
      navigate('/trips');
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
        <p style={{ color: 'var(--muted)' }}>That suggestion is no longer available.</p>
      </div>
    );
  }
  if (!draft) {
    return (
      <div style={{ maxWidth: 640, margin: '20px auto', padding: '0 16px' }}>
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      </div>
    );
  }
  if (!canEdit) {
    return (
      <div style={{ maxWidth: 640, margin: '20px auto', padding: '0 16px' }}>
        <Link className="back-bar" to="/trips">
          <span>Trips</span>
        </Link>
        <p style={{ color: 'var(--muted)' }}>Only an editor can review suggestions.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '20px auto', padding: '0 16px' }}>
      <Link className="back-bar" to="/trips">
        <span>Trips</span>
      </Link>
      <h1 className="bucket-title">Review suggested trip</h1>
      <p style={{ color: 'var(--muted)', marginTop: 2 }}>
        Edit the details and places, then save it to Our Trips — or dismiss it.
      </p>

      <div className="card" style={{ marginTop: 12 }}>
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
      </div>

      <h2 style={{ marginTop: 22 }}>Places</h2>
      {members.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No places on this suggestion.</p>
      ) : (
        <div className="trip-places" style={{ marginTop: 8 }}>
          {members.map((m) => (
            <div
              key={m.id}
              className="trip-place"
              style={{ display: 'flex', alignItems: 'center' }}
            >
              <span style={{ flex: 1 }}>{m.name || 'Unnamed place'}</span>
              <button
                disabled={busy}
                onClick={() => void removeMember(m)}
                style={{ marginLeft: 8 }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {msg && (
        <div className="banner" style={{ marginTop: 12 }}>
          {msg}
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 22 }}>
        <button className="primary" disabled={busy} onClick={() => void save()}>
          Save to our trips
        </button>
        <button disabled={busy} onClick={() => void dismiss()}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
