import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { createPlace, fetchMapPeople, fetchPlaces, matchPhoto } from '../lib/data';
import type { MapPerson } from '../lib/data';
import {
  assignPhotoToPlace,
  fetchUnassignedPhotos,
  mapPool,
  readGps,
  readTakenAt,
  uploadPhoto,
} from '../lib/photos';
import { reverseGeocode, type SearchResult } from '../lib/maptiler';
import { googlePhotosEnabled, pickFromGooglePhotos } from '../lib/googlePhotos';
import PlaceQuickEdit from '../components/PlaceQuickEdit';
import MapSearch from '../components/MapSearch';
import AuthedImg from '../components/AuthedImg';
import type { Place } from '../lib/types';

type Phase = 'idle' | 'reading' | 'review' | 'uploading' | 'done';

interface Item {
  id: string;
  file?: File; // picked-file / Google Photos items (need uploading)
  photoId?: string; // already-uploaded inbox items (need assigning)
  url?: string; // object URL for file items
  takenAt?: string;
  lat?: number;
  lng?: number;
  reason: string; // why we think it's here ('' when unmatched)
  placeId: string | null; // chosen target place (null = needs a place)
  placeName: string;
}

/** Sort a batch of photos into places fast. Pick once (Google Photos or files);
 *  the timeline engine proposes a place for each from its timestamp + your
 *  movement history (no date-hunting), groups them by outing, and you confirm a
 *  whole group with one tap — or reassign / make a new place. */
export default function PhotoSorter() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';

  const [phase, setPhase] = useState<Phase>('idle');
  const [items, setItems] = useState<Item[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [people, setPeople] = useState<MapPerson[]>([]);
  const [editing, setEditing] = useState<string | null>(null); // placeId whose editor is open
  const [note, setNote] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [inboxCount, setInboxCount] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetchPlaces()
      .then((r) => setPlaces([...r].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => undefined);
    fetchMapPeople().then(setPeople).catch(() => undefined);
    // Inbox = your own already-uploaded photos not yet sorted onto a place (RLS
    // limits this to your uploads) — the landing spot for phone auto-uploads.
    fetchUnassignedPhotos()
      .then((ps) => setInboxCount(ps.length))
      .catch(() => setInboxCount(0));
    return () => items.forEach((it) => it.url && URL.revokeObjectURL(it.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the inbox (uploaded-but-unsorted photos) → matched items to sort.
  async function ingestInbox() {
    setPhase('reading');
    setNote('Loading your unsorted photos…');
    const photos = await fetchUnassignedPhotos().catch(() => []);
    if (photos.length === 0) {
      setNote('Nothing to sort — your inbox is empty.');
      setPhase('idle');
      return;
    }
    let done = 0;
    const built = await mapPool(
      photos,
      async (ph): Promise<Item> => {
        const cands = await matchPhoto(ph.taken_at ?? null, ph.lat, ph.lng).catch(() => []);
        const top = cands[0];
        done++;
        setNote(`Matching ${done} of ${photos.length}…`);
        return {
          id: ph.id,
          photoId: ph.id,
          takenAt: ph.taken_at ?? undefined,
          lat: ph.lat,
          lng: ph.lng,
          reason: top?.reason ?? '',
          placeId: top?.place_id ?? null,
          placeName: top?.name ?? '',
        };
      },
      6,
    );
    setItems(built.filter((x): x is Item => x != null));
    setNote(null);
    setPhase('review');
  }

  // A place was edited inline — reflect its new name/fields in state + group labels.
  function onPlaceUpdated(p: Place) {
    setPlaces((cur) => {
      const has = cur.some((x) => x.id === p.id);
      return has ? cur.map((x) => (x.id === p.id ? p : x)) : [...cur, p];
    });
    setItems((cur) => cur.map((it) => (it.placeId === p.id ? { ...it, placeName: p.name } : it)));
  }

  async function ingest(files: File[]) {
    if (files.length === 0) return;
    setPhase('reading');
    setNote(`Reading ${files.length} photo${files.length === 1 ? '' : 's'}…`);
    let done = 0;
    const builtRaw = await mapPool(
      files,
      async (file): Promise<Item> => {
        const [g, takenAt] = await Promise.all([
          readGps(file).catch(() => null),
          readTakenAt(file).catch(() => undefined),
        ]);
        const cands = await matchPhoto(takenAt ?? null, g?.lat, g?.lng).catch(() => []);
        const top = cands[0];
        done++;
        setNote(`Matching ${done} of ${files.length}…`);
        return {
          id: `${Date.now()}-${Math.round(done)}-${file.name}`,
          file,
          url: URL.createObjectURL(file),
          takenAt,
          lat: g?.lat,
          lng: g?.lng,
          reason: top?.reason ?? '',
          placeId: top?.place_id ?? null,
          placeName: top?.name ?? '',
        };
      },
      5,
    );
    const built = builtRaw.filter((x): x is Item => x != null);
    setItems(built);
    setNote(null);
    setPhase('review');
  }

  async function fromGoogle() {
    setNote('Opening Google Photos…');
    try {
      const files = await pickFromGooglePhotos((s) => setNote(s));
      await ingest(files);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Google Photos import failed.');
      setPhase('idle');
    }
  }

  // Grouped by chosen place (stable order: matched groups first, unassigned last).
  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) {
      const key = it.placeId ?? '__none__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === '__none__') return 1;
      if (b[0] === '__none__') return -1;
      return b[1].length - a[1].length;
    });
  }, [items]);

  function reassign(fromKey: string, placeId: string | null, placeName: string) {
    setItems((cur) =>
      cur.map((it) =>
        (it.placeId ?? '__none__') === fromKey ? { ...it, placeId, placeName, reason: '' } : it,
      ),
    );
  }

  // Create a place from a searched address/place result and assign the group to it.
  async function createFromSearch(key: string, r: SearchResult) {
    setNote('Creating that place…');
    try {
      const created = await createPlace({
        name: r.name,
        country: r.country,
        admin1: r.admin1,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        saved: true,
      });
      setPlaces((cur) => [...cur, created].sort((a, b) => a.name.localeCompare(b.name)));
      reassign(key, created.id, created.name);
      setEditing(created.id);
      setNote(null);
    } catch {
      setNote('Could not create that place.');
    }
  }

  async function newPlaceForGroup(key: string, groupItems: Item[]) {
    const withGps = groupItems.find((it) => it.lat != null && it.lng != null);
    if (!withGps || withGps.lat == null || withGps.lng == null) {
      setNote('These photos have no location — pick an existing place instead.');
      return;
    }
    setNote('Naming the new place from its location…');
    const rev = await reverseGeocode(withGps.lng, withGps.lat).catch(() => null);
    try {
      const created = await createPlace({
        name: rev?.name ?? 'New place',
        country: rev?.country ?? null,
        admin1: rev?.admin1 ?? null,
        lat: withGps.lat,
        lng: withGps.lng,
        saved: true,
      });
      setPlaces((cur) => [...cur, created].sort((a, b) => a.name.localeCompare(b.name)));
      reassign(key, created.id, created.name);
      setNote(null);
    } catch {
      setNote('Could not create the place.');
    }
  }

  async function addAll() {
    const ready = items.filter((it) => it.placeId);
    if (ready.length === 0) {
      setNote('Assign a place to at least one group first.');
      return;
    }
    setPhase('uploading');
    let added = 0;
    let n = 0;
    const results = await mapPool(
      ready,
      async (it) => {
        n++;
        setNote(`Adding ${n} of ${ready.length}…`);
        // Inbox items are already uploaded → just assign; picked files → upload.
        if (it.photoId) {
          return assignPhotoToPlace(it.photoId, it.placeId!)
            .then(() => ({ ok: true }))
            .catch(() => null);
        }
        return uploadPhoto(it.file!, {
          placeId: it.placeId!,
          lat: it.lat,
          lng: it.lng,
          override: true,
        }).catch(() => null);
      },
      4,
    );
    results.forEach((r) => {
      if (r && r.ok) added++;
    });
    const placesTouched = new Set(ready.map((it) => it.placeId)).size;
    setSummary(`Added ${added} photo${added === 1 ? '' : 's'} across ${placesTouched} place${placesTouched === 1 ? '' : 's'}.`);
    setNote(null);
    setPhase('done');
  }

  if (!canEdit) {
    return (
      <div className="photo-sorter">
        <Link className="back-bar" to="/settings">
          <span>Settings</span>
        </Link>
        <p>Only editors can sort photos into places.</p>
      </div>
    );
  }

  const assignedCount = items.filter((it) => it.placeId).length;

  return (
    <div className="photo-sorter">
      <Link className="back-bar" to="/settings">
        <span>Settings</span>
      </Link>
      <h1>Sort photos into places</h1>

      {phase === 'idle' && (
        <div className="card">
          <p style={{ marginTop: 0, color: 'var(--muted)' }}>
            Pick a batch of photos — the app reads each one’s date and works out where you were at
            that moment (from your location history and activities), then groups them by place so you
            can confirm each in one tap. No looking up dates.
          </p>
          {inboxCount != null && inboxCount > 0 && (
            <div className="ps-inbox">
              <b>
                {inboxCount} photo{inboxCount === 1 ? '' : 's'} waiting in your inbox
              </b>
              <span className="label">
                {' '}
                (auto-uploaded from your phone, or added without a place)
              </span>
              <div style={{ marginTop: 8 }}>
                <button className="primary" onClick={() => void ingestInbox()}>
                  Sort my inbox
                </button>
              </div>
            </div>
          )}
          <div className="btn-row" style={{ marginTop: inboxCount ? 10 : 0 }}>
            {googlePhotosEnabled() && (
              <button className="primary" onClick={() => void fromGoogle()}>
                Import from Google Photos
              </button>
            )}
            <button onClick={() => fileRef.current?.click()}>Choose photos</button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                const f = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = '';
                void ingest(f);
              }}
            />
          </div>
        </div>
      )}

      {note && <div className="banner">{note}</div>}

      {phase === 'review' && (
        <>
          <div className="ps-summary">
            {items.length} photos · {assignedCount} matched · {items.length - assignedCount} need a
            place
          </div>
          {groups.map(([key, gi]) => {
            const unassigned = key === '__none__';
            const reason = gi.find((it) => it.reason)?.reason;
            return (
              <div key={key} className={`card ps-group ${unassigned ? 'ps-none' : ''}`}>
                <div className="ps-group-head">
                  <div>
                    <b>{unassigned ? 'Needs a place' : gi[0].placeName}</b>
                    <span className="label">
                      {' '}
                      · {gi.length} photo{gi.length === 1 ? '' : 's'}
                      {reason ? ` · ${reason}` : ''}
                    </span>
                  </div>
                </div>
                <div className="ps-thumbs">
                  {gi.slice(0, 12).map((it) =>
                    it.photoId ? (
                      <AuthedImg key={it.id} photoId={it.photoId} size="thumb" alt="" />
                    ) : (
                      <img key={it.id} src={it.url} alt="" />
                    ),
                  )}
                  {gi.length > 12 && <span className="ps-more">+{gi.length - 12}</span>}
                </div>
                {unassigned ? (
                  // No place yet: create one by searching, pick an existing one, or
                  // (if the photos have GPS) drop it at the photos' own location.
                  <div className="ps-choose">
                    <MapSearch
                      placeholder="Search an address or place to create it…"
                      onPick={(r) => void createFromSearch(key, r)}
                    />
                    <div className="ps-choose-row">
                      <select
                        value=""
                        onChange={(e) => {
                          const pl = places.find((p) => p.id === e.target.value);
                          if (pl) reassign(key, pl.id, pl.name);
                        }}
                      >
                        <option value="">…or pick an existing place</option>
                        {places.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.admin1 ? ` — ${p.admin1}` : ''}
                          </option>
                        ))}
                      </select>
                      {gi.some((it) => it.lat != null) && (
                        <button type="button" onClick={() => void newPlaceForGroup(key, gi)}>
                          Use photos’ location
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  // Assigned: edit the card, change the place, or drop it back out.
                  <div className="ps-edit">
                    <div className="ps-group-actions">
                      <button
                        type="button"
                        className="ps-edit-toggle"
                        onClick={() => setEditing(editing === key ? null : key)}
                      >
                        {editing === key ? 'Hide details' : 'Edit details'}
                      </button>
                      <select
                        value={gi[0].placeId ?? ''}
                        onChange={(e) => {
                          const pl = places.find((p) => p.id === e.target.value);
                          if (pl) reassign(key, pl.id, pl.name);
                        }}
                      >
                        {places.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.admin1 ? ` — ${p.admin1}` : ''}
                          </option>
                        ))}
                      </select>
                      <button className="ps-skip" onClick={() => reassign(key, null, '')}>
                        Not here
                      </button>
                    </div>
                    {editing === key &&
                      (() => {
                        const pl = places.find((p) => p.id === key);
                        return pl ? (
                          <PlaceQuickEdit
                            place={pl}
                            people={people}
                            meId={profile?.id ?? null}
                            onUpdated={onPlaceUpdated}
                          />
                        ) : null;
                      })()}
                  </div>
                )}
              </div>
            );
          })}
          <div className="ps-footer">
            <button className="primary" disabled={assignedCount === 0} onClick={() => void addAll()}>
              Add {assignedCount} matched photo{assignedCount === 1 ? '' : 's'}
            </button>
          </div>
        </>
      )}

      {phase === 'uploading' && <p className="label">Adding photos…</p>}

      {phase === 'done' && (
        <div className="card">
          <p style={{ marginTop: 0 }}>{summary}</p>
          <div className="btn-row">
            <button
              onClick={() => {
                items.forEach((it) => it.url && URL.revokeObjectURL(it.url));
                setItems([]);
                setSummary(null);
                setPhase('idle');
              }}
            >
              Sort more photos
            </button>
            <Link to="/">
              <button className="primary">Back to map</button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
