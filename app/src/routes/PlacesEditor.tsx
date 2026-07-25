import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  deletePlace,
  fetchMapPeople,
  fetchPlacePeople,
  fetchPlaces,
  setPlaceSolo,
  updatePlace,
} from '../lib/data';
import type { MapPerson } from '../lib/data';
import { mapPool, uploadPhoto } from '../lib/photos';
import { googlePhotosEnabled, pickFromGooglePhotos } from '../lib/googlePhotos';
import { MANUAL_CATEGORIES, categoryLabel } from '../lib/categories';
import PhotoMatchReview from '../components/PhotoMatchReview';
import type { Place } from '../lib/types';

type PersonKey = 'all' | 'mine' | 'josh' | 'both';
type RowStatus = 'saving' | 'saved' | 'error' | undefined;

/** One editable spreadsheet-style page for every place: rename, fix location,
 *  retag, rate, set visit dates and who was there, add photos (Google Photos →
 *  matched to this place) and delete — all without hopping between map cards. */
export default function PlacesEditor() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';

  const [places, setPlaces] = useState<Place[]>([]);
  const [people, setPeople] = useState<MapPerson[]>([]);
  const [placePeople, setPlacePeople] = useState<Map<string, Set<string>>>(new Map());
  const [q, setQ] = useState('');
  const [person, setPerson] = useState<PersonKey>('all');
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [note, setNote] = useState<string | null>(null);

  // Photo matcher overlay (per row): the picked files reviewed against a place.
  const [photoTarget, setPhotoTarget] = useState<Place | null>(null);
  const [pickedFiles, setPickedFiles] = useState<File[] | null>(null);

  // Last-known server values, so a blur only writes when the field actually changed.
  const serverById = useRef<Map<string, Place>>(new Map());

  function load() {
    fetchPlaces()
      .then((rows) => {
        const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
        setPlaces(sorted);
        serverById.current = new Map(sorted.map((p) => [p.id, p]));
      })
      .catch(() => setNote('Could not load places'));
    fetchMapPeople().then(setPeople).catch(() => undefined);
    fetchPlacePeople().then(setPlacePeople).catch(() => undefined);
  }
  useEffect(load, []);

  // owner = Erica (me), the editor = Josh.
  const meId = profile?.id ?? null;
  const joshId = useMemo(() => people.find((p) => p.id !== meId)?.id ?? null, [people, meId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return places.filter((p) => {
      if (s) {
        const hay = `${p.name} ${p.city ?? ''} ${p.admin1 ?? ''} ${p.country ?? ''}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      if (person === 'all') return true;
      const set = placePeople.get(p.id) ?? new Set<string>();
      const hasMe = meId ? set.has(meId) : false;
      const hasJosh = joshId ? set.has(joshId) : false;
      if (person === 'mine') return hasMe;
      if (person === 'josh') return hasJosh;
      if (person === 'both') return hasMe && hasJosh;
      return true;
    });
  }, [places, q, person, placePeople, meId, joshId]);

  function setRowStatus(id: string, s: RowStatus) {
    setStatus((cur) => ({ ...cur, [id]: s }));
  }

  // Optimistic local edit (keeps the input controlled while typing).
  function edit(id: string, patch: Partial<Place>) {
    setPlaces((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function save(id: string, patch: Partial<Place>) {
    setRowStatus(id, 'saving');
    try {
      const updated = await updatePlace(id, patch);
      serverById.current.set(id, updated);
      setPlaces((cur) => cur.map((p) => (p.id === id ? updated : p)));
      setRowStatus(id, 'saved');
      window.setTimeout(() => setRowStatus(id, undefined), 1400);
    } catch {
      setRowStatus(id, 'error');
    }
  }

  // Save a text field on blur, but only if it actually changed from the server value.
  function commitText(id: string, key: 'name' | 'city' | 'admin1' | 'country', value: string) {
    const server = serverById.current.get(id);
    const prev = (server?.[key] ?? '') as string;
    const next = value.trim();
    if (next === (prev ?? '')) return;
    void save(id, { [key]: next || null } as Partial<Place>);
  }

  function addTag(id: string, slug: string) {
    if (!slug) return;
    const p = places.find((x) => x.id === id);
    const next = [...new Set([...(p?.categories ?? []), slug])];
    edit(id, { categories: next });
    void save(id, { categories: next });
  }
  function removeTag(id: string, slug: string) {
    const p = places.find((x) => x.id === id);
    const next = (p?.categories ?? []).filter((c) => c !== slug);
    edit(id, { categories: next });
    void save(id, { categories: next });
  }

  async function setPerson3(place: Place, key: 'both' | 'mine' | 'josh') {
    const profileId = key === 'both' ? null : key === 'mine' ? meId : joshId;
    setRowStatus(place.id, 'saving');
    try {
      await setPlaceSolo(place.id, profileId ?? null);
      // Reflect it locally in the people map so the filter/label update at once.
      setPlacePeople((cur) => {
        const next = new Map(cur);
        const set = new Set<string>();
        if (key === 'both') {
          if (meId) set.add(meId);
          if (joshId) set.add(joshId);
        } else if (profileId) set.add(profileId);
        next.set(place.id, set);
        return next;
      });
      setRowStatus(place.id, 'saved');
      window.setTimeout(() => setRowStatus(place.id, undefined), 1400);
    } catch {
      setRowStatus(place.id, 'error');
    }
  }
  function personOf(id: string): 'both' | 'mine' | 'josh' {
    const set = placePeople.get(id) ?? new Set<string>();
    const hasMe = meId ? set.has(meId) : false;
    const hasJosh = joshId ? set.has(joshId) : false;
    if (hasMe && hasJosh) return 'both';
    if (hasJosh && !hasMe) return 'josh';
    return 'mine';
  }

  async function pickPhotosFor(place: Place) {
    if (!googlePhotosEnabled()) {
      setNote('Google Photos isn’t configured.');
      return;
    }
    setNote(`Opening Google Photos for ${place.name || 'this place'}…`);
    try {
      const files = await pickFromGooglePhotos((s) => setNote(s));
      setNote(null);
      if (files.length) {
        setPhotoTarget(place);
        setPickedFiles(files);
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Google Photos import failed.');
    }
  }

  async function uploadTo(place: Place, files: File[]) {
    setPhotoTarget(null);
    setPickedFiles(null);
    if (files.length === 0) return;
    setNote(`Adding ${files.length} photo${files.length === 1 ? '' : 's'} to ${place.name}…`);
    let added = 0;
    const results = await mapPool(
      files,
      (f) =>
        uploadPhoto(f, { placeId: place.id, lat: place.lat, lng: place.lng, override: true }).catch(
          () => null,
        ),
      4,
    );
    results.forEach((r) => {
      if (r && r.ok) added++;
    });
    setNote(
      added > 0
        ? `Added ${added} photo${added === 1 ? '' : 's'} to ${place.name}.`
        : `No photos added to ${place.name}.`,
    );
  }

  async function onDelete(place: Place) {
    if (!window.confirm(`Delete “${place.name || 'this place'}” and all its photos? This can’t be undone.`))
      return;
    try {
      await deletePlace(place.id);
      setPlaces((cur) => cur.filter((p) => p.id !== place.id));
      serverById.current.delete(place.id);
    } catch {
      setNote(`Could not delete ${place.name}.`);
    }
  }

  if (!canEdit) {
    return (
      <div style={{ maxWidth: 760, margin: '20px auto', padding: '0 16px' }}>
        <Link className="back-bar" to="/settings">
          <span>Settings</span>
        </Link>
        <p>Only editors can bulk-edit places.</p>
      </div>
    );
  }

  return (
    <div className="places-editor">
      <Link className="back-bar" to="/settings">
        <span>Settings</span>
      </Link>
      <h1>Edit all places</h1>
      <p className="label" style={{ margin: '0 0 12px' }}>
        Change any field in the table — it saves as you go. Add photos straight from Google Photos;
        they’re matched to that place by date and location.
      </p>

      <div className="pe-controls">
        <input
          placeholder="Search places…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pe-search"
        />
        <div className="pe-personfilter">
          {(['all', 'mine', 'josh', 'both'] as const).map((k) => (
            <button
              key={k}
              className={person === k ? 'on' : ''}
              onClick={() => setPerson(k)}
              type="button"
            >
              {k === 'all' ? 'All' : k === 'mine' ? 'Just me' : k === 'josh' ? 'Just Josh' : 'Both'}
            </button>
          ))}
        </div>
        <span className="label">{filtered.length} places</span>
      </div>

      {note && <div className="banner">{note}</div>}

      <div className="pe-scroll">
        <table className="pe-table">
          <thead>
            <tr>
              <th className="pe-name-col">Name</th>
              <th>City</th>
              <th>State / region</th>
              <th>Country</th>
              <th>Tags</th>
              <th>Rating</th>
              <th>First visit</th>
              <th>Last visit</th>
              <th>Who</th>
              <th>Photos</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const avail = MANUAL_CATEGORIES.filter((c) => !(p.categories ?? []).includes(c.slug));
              const st = status[p.id];
              return (
                <tr key={p.id}>
                  <td className="pe-name-col">
                    <div className="pe-namecell">
                      <input
                        value={p.name}
                        placeholder="Name"
                        onChange={(e) => edit(p.id, { name: e.target.value })}
                        onBlur={(e) => commitText(p.id, 'name', e.target.value)}
                      />
                      <Link to={`/place/${p.id}`} className="pe-open" title="Open the full card">
                        open
                      </Link>
                      {st && <span className={`pe-status ${st}`}>{st === 'saving' ? '…' : st === 'saved' ? 'saved' : 'retry'}</span>}
                    </div>
                  </td>
                  <td>
                    <input
                      value={p.city ?? ''}
                      onChange={(e) => edit(p.id, { city: e.target.value })}
                      onBlur={(e) => commitText(p.id, 'city', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      value={p.admin1 ?? ''}
                      onChange={(e) => edit(p.id, { admin1: e.target.value })}
                      onBlur={(e) => commitText(p.id, 'admin1', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      value={p.country ?? ''}
                      onChange={(e) => edit(p.id, { country: e.target.value })}
                      onBlur={(e) => commitText(p.id, 'country', e.target.value)}
                    />
                  </td>
                  <td className="pe-tags">
                    <div className="pe-chips">
                      {(p.categories ?? []).map((slug) => (
                        <button
                          key={slug}
                          type="button"
                          className="pe-chip"
                          onClick={() => removeTag(p.id, slug)}
                          title="Remove tag"
                        >
                          {categoryLabel(slug)} ×
                        </button>
                      ))}
                    </div>
                    {avail.length > 0 && (
                      <select value="" onChange={(e) => addTag(p.id, e.target.value)}>
                        <option value="">+ tag</option>
                        {avail.map((c) => (
                          <option key={c.slug} value={c.slug}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <select
                      value={p.rating ?? 0}
                      onChange={(e) => {
                        const r = Number(e.target.value);
                        edit(p.id, { rating: r || null });
                        void save(p.id, { rating: r || null });
                      }}
                    >
                      <option value={0}>—</option>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {'★'.repeat(n)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="date"
                      value={p.first_visit ?? ''}
                      onChange={(e) => {
                        edit(p.id, { first_visit: e.target.value || null });
                        void save(p.id, { first_visit: e.target.value || null });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={p.last_visit ?? ''}
                      onChange={(e) => {
                        edit(p.id, { last_visit: e.target.value || null });
                        void save(p.id, { last_visit: e.target.value || null });
                      }}
                    />
                  </td>
                  <td>
                    <select
                      value={personOf(p.id)}
                      onChange={(e) => void setPerson3(p, e.target.value as 'both' | 'mine' | 'josh')}
                    >
                      <option value="both">Both</option>
                      <option value="mine">Just me</option>
                      <option value="josh">Just Josh</option>
                    </select>
                  </td>
                  <td>
                    <button type="button" className="pe-add" onClick={() => void pickPhotosFor(p)}>
                      + Photos
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="pe-del"
                      onClick={() => void onDelete(p)}
                      title="Delete place"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {photoTarget && pickedFiles && (
        <PhotoMatchReview
          place={photoTarget}
          files={pickedFiles}
          onConfirm={(sel) => void uploadTo(photoTarget, sel)}
          onCancel={() => {
            setPhotoTarget(null);
            setPickedFiles(null);
          }}
        />
      )}
    </div>
  );
}
