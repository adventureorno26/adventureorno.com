import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  createPlace,
  fetchMapPeople,
  fetchPlaces,
  fetchVisits,
  matchPhoto,
  setVisitSolo,
} from '../lib/data';
import type { MapPerson } from '../lib/data';
import {
  assignPhotoToPlace,
  fetchUnassignedPhotos,
  mapPool,
  readGps,
  readTakenAt,
} from '../lib/photos';
import { reverseGeocode, type SearchResult } from '../lib/maptiler';
import { cancelGooglePick, googlePhotosEnabled, pickFromGooglePhotos } from '../lib/googlePhotos';
import { enqueueUpload } from '../lib/uploadQueue';
import MapSearch from '../components/MapSearch';
import AuthedImg from '../components/AuthedImg';
import type { Place } from '../lib/types';

type Phase = 'idle' | 'reading' | 'review' | 'uploading' | 'done';
type Who = 'both' | 'mine' | 'josh';

interface Item {
  id: string;
  groupId: string; // stable cluster key: place + month (a single visit/trip)
  file?: File;
  photoId?: string;
  url?: string;
  takenAt?: string;
  lat?: number;
  lng?: number;
  reason: string;
  placeId: string | null;
  placeName: string;
}

interface Group {
  id: string;
  placeId: string | null;
  placeName: string;
  items: Item[];
  ym: string; // YYYY-MM (or 'nodate')
}

const ym = (iso?: string): string => (iso ? iso.slice(0, 7) : 'nodate');

// Earliest photo date in a group, as YYYY-MM-DD (prefills the editable visit date).
function groupDay(its: Item[]): string {
  const ds = its
    .map((i) => i.takenAt)
    .filter((x): x is string => !!x)
    .sort();
  return ds.length ? ds[0].slice(0, 10) : '';
}

function dateRangeLabel(items: Item[]): string {
  const ds = items
    .map((it) => it.takenAt)
    .filter((x): x is string => !!x)
    .sort();
  if (ds.length === 0) return 'No date';
  const full = (s: string) =>
    new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const short = (s: string) =>
    new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return ds[0].slice(0, 10) === ds[ds.length - 1].slice(0, 10)
    ? full(ds[0])
    : `${short(ds[0])} – ${full(ds[ds.length - 1])}`;
}

/** Sort photos into places — grouped into VISITS (same place, different month =
 *  a separate trip). Pick a batch (Google Photos, files, or your phone inbox);
 *  the engine proposes a place from each photo's date + your movement history,
 *  splits them into per-month visits, and you confirm who was on each. */
export default function PhotoSorter() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';

  const [phase, setPhase] = useState<Phase>('idle');
  const [items, setItems] = useState<Item[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [people, setPeople] = useState<MapPerson[]>([]);
  const [groupWho, setGroupWho] = useState<Record<string, Who>>({});
  const [groupDate, setGroupDate] = useState<Record<string, string>>({}); // optional date override
  const [note, setNote] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [inboxCount, setInboxCount] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const meId = profile?.id ?? null;
  const joshId = people.find((p) => p.id !== meId)?.id ?? null;

  useEffect(() => {
    fetchPlaces()
      .then((r) => setPlaces([...r].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => undefined);
    fetchMapPeople()
      .then(setPeople)
      .catch(() => undefined);
    fetchUnassignedPhotos()
      .then((ps) => setInboxCount(ps.length))
      .catch(() => setInboxCount(0));
    return () => items.forEach((it) => it.url && URL.revokeObjectURL(it.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          groupId: `${top?.place_id ?? 'none'}::${ym(takenAt)}`,
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
    setItems(builtRaw.filter((x): x is Item => x != null));
    setNote(null);
    setPhase('review');
  }

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
          groupId: `${top?.place_id ?? 'none'}::${ym(ph.taken_at ?? undefined)}`,
          photoId: ph.id,
          takenAt: ph.taken_at ?? undefined,
          lat: ph.lat ?? undefined,
          lng: ph.lng ?? undefined,
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

  async function fromGoogle() {
    setImporting(true);
    setNote('Opening Google Photos…');
    try {
      const files = await pickFromGooglePhotos((s) => setNote(s), {
        returnTo: '/photos/sort',
        label: 'sorting',
      });
      setImporting(false);
      await ingest(files);
    } catch (e) {
      setImporting(false);
      setNote(e instanceof Error ? e.message : 'Google Photos import failed.');
      setPhase('idle');
    }
  }

  // One group per (place + month) = one visit. Newest month first; unassigned last.
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) {
      if (!map.has(it.groupId)) map.set(it.groupId, []);
      map.get(it.groupId)!.push(it);
    }
    const arr: Group[] = [...map.entries()].map(([id, its]) => ({
      id,
      placeId: its[0].placeId,
      placeName: its[0].placeName,
      items: its,
      ym: ym(its[0].takenAt),
    }));
    return arr.sort((a, b) => {
      const au = a.placeId == null;
      const bu = b.placeId == null;
      if (au !== bu) return au ? 1 : -1;
      return b.ym.localeCompare(a.ym);
    });
  }, [items]);

  // Reassign a whole group (all its items) to a place — keeps the group intact so
  // the same place in two different months stays as two separate visits.
  function reassign(groupId: string, placeId: string | null, placeName: string) {
    setItems((cur) =>
      cur.map((it) => (it.groupId === groupId ? { ...it, placeId, placeName, reason: '' } : it)),
    );
  }

  async function createFromSearch(groupId: string, r: SearchResult) {
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
      reassign(groupId, created.id, created.name);
      setNote(null);
    } catch {
      setNote('Could not create that place.');
    }
  }

  async function newPlaceForGroup(groupId: string, groupItems: Item[]) {
    const withGps = groupItems.find((it) => it.lat != null && it.lng != null);
    if (!withGps || withGps.lat == null || withGps.lng == null) {
      setNote('These photos have no location — search for the place instead.');
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
      reassign(groupId, created.id, created.name);
      setNote(null);
    } catch {
      setNote('Could not create the place.');
    }
  }

  async function addAll() {
    const ready = groups.filter((g) => g.placeId);
    const total = ready.reduce((n, g) => n + g.items.length, 0);
    if (total === 0) {
      setNote('Give at least one visit a place first.');
      return;
    }
    setPhase('uploading');
    let added = 0;
    let n = 0;
    for (const g of ready) {
      const pl = places.find((p) => p.id === g.placeId);
      // Optional date override → stamps the photos so the derived visit lands on
      // the date you chose (visits are rebuilt from photo dates).
      const override = groupDate[g.id];
      const takenAt = override ? `${override}T12:00:00Z` : undefined;
      const results = await mapPool(
        g.items,
        async (it) => {
          n++;
          setNote(`Adding ${n} of ${total}…`);
          if (it.photoId) {
            return assignPhotoToPlace(it.photoId, g.placeId!, takenAt)
              .then(() => ({ ok: true }))
              .catch(() => null);
          }
          // Through the global upload queue (progress + retry). No-GPS photos fall
          // back to the assigned place's coordinates.
          return enqueueUpload(it.file!, {
            placeId: g.placeId!,
            lat: it.lat ?? pl?.lat,
            lng: it.lng ?? pl?.lng,
            takenAt,
            override: true,
          }).catch(() => null);
        },
        4,
      );
      results.forEach((r) => {
        if (r && r.ok) added++;
      });
      // Attribute ONLY the visits this group's photos actually landed on — never
      // other visits that merely share the same month at this place (which would
      // overwrite a separate visit's attribution).
      const who = groupWho[g.id] ?? 'both';
      const profileId = who === 'both' ? null : who === 'mine' ? meId : joshId;
      const days = new Set<string>(
        g.items
          .map((it) => (override ? override : (it.takenAt ?? '').slice(0, 10)))
          .filter((d): d is string => !!d),
      );
      if (days.size) {
        try {
          const visits = await fetchVisits(g.placeId!);
          const touched = visits.filter((v) =>
            [...days].some((d) => d >= v.start_date && d <= v.end_date),
          );
          await Promise.all(touched.map((v) => setVisitSolo(v.id, profileId ?? null)));
        } catch {
          /* ignore */
        }
      }
    }
    const placesTouched = new Set(ready.map((g) => g.placeId)).size;
    setSummary(
      `Added ${added} photo${added === 1 ? '' : 's'} across ${placesTouched} visit${placesTouched === 1 ? '' : 's'}.`,
    );
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

  const assignedPhotos = groups.filter((g) => g.placeId).reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="photo-sorter">
      <Link className="back-bar" to="/settings">
        <span>Settings</span>
      </Link>
      <h1>Sort photos into places</h1>

      {phase === 'idle' && (
        <div className="card">
          <p style={{ marginTop: 0, color: 'var(--muted)' }}>
            Pick a batch of photos — the app reads each date, works out where you were, and splits
            them into <b>visits</b> (same place on a different month = a separate trip). Confirm the
            place and who was there for each.
          </p>
          {inboxCount != null && inboxCount > 0 && (
            <div className="ps-inbox">
              <b>
                {inboxCount} photo{inboxCount === 1 ? '' : 's'} waiting in your inbox
              </b>
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

      {note && (
        <div className="banner">
          {note}
          {importing && (
            <button
              className="ps-cancel"
              onClick={() => {
                cancelGooglePick();
                setImporting(false);
                setNote(null);
              }}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {phase === 'review' && (
        <>
          <div className="ps-summary">
            {groups.length} visit{groups.length === 1 ? '' : 's'} · {assignedPhotos} of{' '}
            {items.length} photos placed
          </div>
          {groups.map((g) => {
            const unassigned = g.placeId == null;
            const reason = g.items.find((it) => it.reason)?.reason;
            const who = groupWho[g.id] ?? 'both';
            return (
              <div key={g.id} className={`card ps-group ${unassigned ? 'ps-none' : ''}`}>
                <div className="ps-group-head">
                  <div>
                    <b>{unassigned ? 'Needs a place' : g.placeName}</b>
                    <span className="label">
                      {' '}
                      · {dateRangeLabel(g.items)} · {g.items.length} photo
                      {g.items.length === 1 ? '' : 's'}
                      {reason ? ` · ${reason}` : ''}
                    </span>
                  </div>
                </div>
                <div className="ps-thumbs">
                  {g.items.slice(0, 12).map((it) =>
                    it.photoId ? (
                      <AuthedImg
                        key={it.id}
                        photoId={it.photoId}
                        size="thumb"
                        alt=""
                        className="ps-thumb-img"
                      />
                    ) : (
                      // Inline size so thumbnails stay small even if the CSS is slow to load.
                      <img
                        key={it.id}
                        src={it.url}
                        alt=""
                        style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }}
                      />
                    ),
                  )}
                  {g.items.length > 12 && <span className="ps-more">+{g.items.length - 12}</span>}
                </div>

                {unassigned ? (
                  <div className="ps-choose">
                    <MapSearch
                      placeholder="Search an address or place to create it…"
                      onPick={(r) => void createFromSearch(g.id, r)}
                    />
                    <div className="ps-choose-row">
                      <select
                        value=""
                        onChange={(e) => {
                          const pl = places.find((p) => p.id === e.target.value);
                          if (pl) reassign(g.id, pl.id, pl.name);
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
                      {g.items.some((it) => it.lat != null) && (
                        <button type="button" onClick={() => void newPlaceForGroup(g.id, g.items)}>
                          Use photos’ location
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  // JUST the visit — this adds a new visit to the chosen place. The
                  // place's own info (name/tags/rating from other visits) is NOT
                  // shown or edited here; only this visit's date + who.
                  <div className="ps-visitform">
                    <label className="ps-field">
                      <span>Place</span>
                      <select
                        value={g.placeId ?? ''}
                        onChange={(e) => {
                          const pl = places.find((p) => p.id === e.target.value);
                          if (pl) reassign(g.id, pl.id, pl.name);
                        }}
                      >
                        {places.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.admin1 ? ` — ${p.admin1}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="ps-row2">
                      <label className="ps-field">
                        <span>Visit date</span>
                        <input
                          type="date"
                          className="ps-date"
                          value={groupDate[g.id] ?? groupDay(g.items)}
                          onChange={(e) => setGroupDate((d) => ({ ...d, [g.id]: e.target.value }))}
                        />
                      </label>
                      <label className="ps-field">
                        <span>Who was on this visit?</span>
                        <select
                          value={who}
                          onChange={(e) =>
                            setGroupWho((cur) => ({ ...cur, [g.id]: e.target.value as Who }))
                          }
                        >
                          <option value="both">Both</option>
                          <option value="mine">Just me</option>
                          <option value="josh">Just Josh</option>
                        </select>
                      </label>
                    </div>
                    <button className="ps-skip" onClick={() => reassign(g.id, null, '')}>
                      Remove this place
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <div className="ps-footer">
            <button
              className="primary"
              disabled={assignedPhotos === 0}
              onClick={() => void addAll()}
            >
              Add {assignedPhotos} photo{assignedPhotos === 1 ? '' : 's'}
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
                setGroupWho({});
                setGroupDate({});
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
