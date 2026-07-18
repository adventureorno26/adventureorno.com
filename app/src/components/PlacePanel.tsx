import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createEntry,
  deleteEntry,
  deletePlace,
  fetchEntries,
  mergePlaces,
  updateEntry,
  updatePlace,
} from '../lib/data';
import type { Entry, NewEntry, Place } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import EntryEditor from './EntryEditor';
import EntryPhotos from './EntryPhotos';
import PhotoGallery from './PhotoGallery';

interface Props {
  place: Place;
  allPlaces: Place[];
  onClose: () => void;
  onPlaceChanged: (place: Place) => void;
  onPlaceDeleted: (id: string) => void;
  onMerged: (loserId: string, winner: Place) => void;
}

function Stars({ n }: { n: number }) {
  return (
    <span className="stars" aria-label={`${n} of 5`}>
      {'★'.repeat(n)}
      {'☆'.repeat(5 - n)}
    </span>
  );
}

export default function PlacePanel({
  place,
  allPlaces,
  onClose,
  onPlaceChanged,
  onPlaceDeleted,
  onMerged,
}: Props) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [addingEntry, setAddingEntry] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';

  // Editable header fields
  const [name, setName] = useState(place.name);
  const [country, setCountry] = useState(place.country ?? '');
  const [first, setFirst] = useState(place.first_visit ?? '');
  const [last, setLast] = useState(place.last_visit ?? '');

  useEffect(() => {
    setName(place.name);
    setCountry(place.country ?? '');
    setFirst(place.first_visit ?? '');
    setLast(place.last_visit ?? '');
  }, [place]);

  useEffect(() => {
    let active = true;
    setEntries(null);
    fetchEntries(place.id)
      .then((rows) => active && setEntries(rows))
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Failed to load entries'));
    return () => {
      active = false;
    };
  }, [place.id]);

  async function saveHeader() {
    try {
      const updated = await updatePlace(place.id, {
        name: name.trim() || place.name,
        country: country.trim() || null,
        first_visit: first || null,
        last_visit: last || null,
        // An edited place is no longer just an auto-generated default.
        auto: false,
      });
      onPlaceChanged(updated);
      setEditingHeader(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save place');
    }
  }

  async function mergeFrom(loserId: string) {
    const loser = allPlaces.find((p) => p.id === loserId);
    if (!loser) return;
    if (!confirm(`Merge "${loser.name}" into "${place.name}"? "${loser.name}" will be deleted.`))
      return;
    try {
      await mergePlaces(loserId, place.id);
      onMerged(loserId, place);
      setMerging(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not merge places');
    }
  }

  async function addEntry(draft: NewEntry) {
    const created = await createEntry(draft);
    setEntries((prev) => [created, ...(prev ?? [])]);
    setAddingEntry(false);
  }

  async function saveEntry(id: string, draft: NewEntry) {
    const updated = await updateEntry(id, draft);
    setEntries((prev) => (prev ?? []).map((e) => (e.id === id ? updated : e)));
    setEditingEntryId(null);
  }

  async function removeEntry(id: string) {
    if (!confirm('Delete this entry?')) return;
    await deleteEntry(id);
    setEntries((prev) => (prev ?? []).filter((e) => e.id !== id));
  }

  async function removePlace() {
    if (!confirm(`Delete "${place.name}" and all its entries?`)) return;
    try {
      await deletePlace(place.id);
      onPlaceDeleted(place.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete place');
    }
  }

  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>
          {place.name}
          {place.auto && (
            <span className="auto-badge" title="Auto-created by the nightly clustering job">
              auto
            </span>
          )}
        </h2>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="meta">
        {[place.admin1, place.country].filter(Boolean).join(', ') || 'Unknown region'} ·{' '}
        {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
        {place.visit_count > 0 && ` · ${place.visit_count} day${place.visit_count > 1 ? 's' : ''}`}
      </div>

      {error && <div className="banner">{error}</div>}

      {editingHeader ? (
        <div className="entry">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <label>Country</label>
          <input value={country} onChange={(e) => setCountry(e.target.value)} />
          <div className="field-row">
            <div>
              <label>First visit</label>
              <input type="date" value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <div>
              <label>Last visit</label>
              <input type="date" value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
          </div>
          <div className="btn-row">
            <button className="primary" onClick={() => void saveHeader()}>
              Save
            </button>
            <button onClick={() => setEditingHeader(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        canEdit && (
          <div className="btn-row">
            <button onClick={() => setEditingHeader(true)}>Edit place</button>
            <button onClick={() => setMerging((v) => !v)}>Merge…</button>
            <button className="danger" onClick={() => void removePlace()}>
              Delete place
            </button>
          </div>
        )
      )}

      {merging && (
        <div className="entry">
          <label>Merge another place into this one (it will be deleted)</label>
          <select
            defaultValue=""
            onChange={(e) => e.target.value && void mergeFrom(e.target.value)}
          >
            <option value="" disabled>
              Choose a place to absorb…
            </option>
            {allPlaces
              .filter((p) => p.id !== place.id)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.admin1 ? ` — ${p.admin1}` : ''}
                </option>
              ))}
          </select>
          <div className="btn-row">
            <button onClick={() => setMerging(false)}>Cancel</button>
          </div>
        </div>
      )}

      <p style={{ margin: '10px 0 0' }}>
        <Link to={`/place/${place.id}/routes`}>🥾 View routes in this area →</Link>
      </p>

      <h3 style={{ marginTop: 22 }}>Photos</h3>
      <PhotoGallery place={place} />

      <h3 style={{ marginTop: 22 }}>Entries</h3>

      {entries === null ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : entries.length === 0 && !addingEntry ? (
        <p style={{ color: 'var(--muted)' }}>No entries yet.</p>
      ) : (
        entries.map((e) =>
          editingEntryId === e.id ? (
            <EntryEditor
              key={e.id}
              placeId={place.id}
              existing={e}
              onSave={(draft) => saveEntry(e.id, draft)}
              onCancel={() => setEditingEntryId(null)}
            />
          ) : (
            <div className="entry" key={e.id}>
              <div className="entry-head">
                <span className="kind">{e.kind}</span>
                {e.rating ? <Stars n={e.rating} /> : null}
              </div>
              <strong>{e.title}</strong>
              {e.date && <div className="meta">{e.date}</div>}
              {e.body && <p className="body">{e.body}</p>}
              {e.url && (
                <p style={{ margin: '6px 0 0' }}>
                  <a href={e.url} target="_blank" rel="noreferrer">
                    {e.url}
                  </a>
                </p>
              )}
              <EntryPhotos entryId={e.id} placeId={place.id} canEdit={canEdit} />
              {canEdit && (
                <div className="row-actions">
                  <button onClick={() => setEditingEntryId(e.id)}>Edit</button>
                  <button className="danger" onClick={() => void removeEntry(e.id)}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          ),
        )
      )}

      {canEdit &&
        (addingEntry ? (
          <EntryEditor
            placeId={place.id}
            onSave={addEntry}
            onCancel={() => setAddingEntry(false)}
          />
        ) : (
          <button
            className="primary"
            style={{ marginTop: 12 }}
            onClick={() => setAddingEntry(true)}
          >
            + Add entry
          </button>
        ))}
    </aside>
  );
}
