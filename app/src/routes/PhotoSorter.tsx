import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  createPlaceAtomic,
  fetchMapPeople,
  fetchPlaces,
  fetchVisits,
  setVisitDates,
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
import type { Place, Visit } from '../lib/types';
import { whoChoices, whoProfileId } from '../lib/participants';
import { assignStayGroups } from '../lib/photoGroups';
import { visitDates } from '../lib/visitDates';
import { showSnack } from '../lib/snackbar';
import { announceWho, mergeOutcomes } from '../lib/whoWasThere';

type Phase = 'idle' | 'reading' | 'review' | 'uploading' | 'done';
/** 'both' | 'mine' | a profile id — built from the real members (lib/participants). */
type Who = string;

/** A place chosen for a group that has NOT been written yet. Held here until the
 *  photos are actually saved — see the note on createFromSearch. */
interface PendingPlace {
  name: string;
  lat: number;
  lng: number;
  country?: string | null;
  admin1?: string | null;
  address?: string | null;
}

interface Item {
  id: string;
  groupId: string; // stable cluster key: place + STAY (see lib/photoGroups)
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
  /** The stay's first day, for ordering. Was YYYY-MM, which is also how the
   *  grouping used to work — see lib/photoGroups. */
  startsOn: string;
}

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

/** Sort photos into places — grouped into VISITS (same place, days that run together =
 *  a separate trip). Pick a batch (Google Photos, files, or your phone inbox);
 *  the engine proposes a place from each photo's date + your movement history,
 *  splits them into one visit per stay, and you confirm who was on each. */
export default function PhotoSorter() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';

  const [phase, setPhase] = useState<Phase>('idle');
  const [items, setItems] = useState<Item[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [people, setPeople] = useState<MapPerson[]>([]);
  const [groupWho, setGroupWho] = useState<Record<string, Who>>({});
  const [groupDate, setGroupDate] = useState<Record<string, string>>({}); // optional date override
  /** Places chosen but not yet written — keyed by group. Discarded if you never save. */
  const [pending, setPending] = useState<Record<string, PendingPlace>>({});
  /** Visits already saved at a place, so a group can JOIN one instead of making a
   *  second visit beside it. Loaded lazily, once per place. */
  const [placeVisits, setPlaceVisits] = useState<Record<string, Visit[]>>({});
  const [note, setNote] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [inboxCount, setInboxCount] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const meId = profile?.id ?? null;
  const whoOptions = whoChoices(people, meId);

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
      async (file): Promise<Omit<Item, 'groupId'>> => {
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
    setItems(assignStayGroups(builtRaw.filter((x) => x != null) as Omit<Item, 'groupId'>[]));
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
      async (ph): Promise<Omit<Item, 'groupId'>> => {
        const cands = await matchPhoto(ph.taken_at ?? null, ph.lat, ph.lng).catch(() => []);
        const top = cands[0];
        done++;
        setNote(`Matching ${done} of ${photos.length}…`);
        return {
          id: ph.id,
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
    setItems(assignStayGroups(built.filter((x) => x != null) as Omit<Item, 'groupId'>[]));
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

  // One group per STAY at a place = one visit. Newest first; unassigned last.
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
      startsOn:
        its.reduce<string>((earliest, x) => {
          const d = x.takenAt ? x.takenAt.slice(0, 10) : '';
          return d && (!earliest || d < earliest) ? d : earliest;
        }, '') || 'nodate',
    }));
    return arr.sort((a, b) => {
      const au = a.placeId == null;
      const bu = b.placeId == null;
      if (au !== bu) return au ? 1 : -1;
      return b.startsOn.localeCompare(a.startsOn);
    });
  }, [items]);

  // Reassign a whole group (all its items) to a place — keeps the group intact so
  // two separate stays at the same place stay as two separate visits.
  function reassign(groupId: string, placeId: string | null, placeName: string) {
    setItems((cur) =>
      // Regrouped after the move: sending this group to a place where a run of days
      // already sits should JOIN that stay, not sit beside it as a second visit.
      assignStayGroups(
        cur.map((it) => (it.groupId === groupId ? { ...it, placeId, placeName, reason: '' } : it)),
      ),
    );
  }

  /**
   * Choose a NEW place for this group — without writing it.
   *
   * This used to call createPlaceAtomic immediately, so searching for "Roma" put Roma
   * on the map before a single photograph was uploaded. Walk away mid-sort and the
   * place stayed there for ever with nothing on it — which is exactly what happened on
   * 2026-08-14, twice. Nothing is written now until Save.
   */
  function createFromSearch(groupId: string, r: SearchResult) {
    try {
      setPending((cur) => ({
        ...cur,
        [groupId]: {
          name: r.name,
          lat: r.lat,
          lng: r.lng,
          country: r.country,
          admin1: r.admin1,
          address: r.address,
        },
      }));
      reassign(groupId, null, r.name);
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
    // Staged, not written — same reason as createFromSearch. "Lungotevere Vaticano"
    // was created this way and left behind when the sort was abandoned.
    setPending((cur) => ({
      ...cur,
      [groupId]: {
        name: rev?.name ?? 'New place',
        lat: withGps.lat!,
        lng: withGps.lng!,
        country: rev?.country ?? null,
        admin1: rev?.admin1 ?? null,
      },
    }));
    reassign(groupId, null, rev?.name ?? 'New place');
    setNote(null);
  }

  /** Write a group's staged place, if it has one. Called from the save step and
   *  NOWHERE else — that is the whole point. */
  async function realisePlace(g: Group): Promise<string | null> {
    if (g.placeId) return g.placeId;
    const stage = pending[g.id];
    if (!stage) return null;
    const created = await createPlaceAtomic({
      name: stage.name,
      country: stage.country ?? null,
      admin1: stage.admin1 ?? null,
      address: stage.address ?? null,
      lat: stage.lat,
      lng: stage.lng,
      saved: true,
      needs_geocode: stage.name === 'New place',
    });
    setPlaces((cur) => [...cur, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created.id;
  }

  // Load the visits already saved at each place a group points at — once per place.
  useEffect(() => {
    const wanted = [...new Set(groups.map((g) => g.placeId).filter((id): id is string => !!id))];
    const missing = wanted.filter((id) => !(id in placeVisits));
    if (missing.length === 0) return;
    let active = true;
    void Promise.all(
      missing.map(async (id) => [id, await fetchVisits(id).catch(() => [])] as const),
    ).then((pairs) => {
      if (active) setPlaceVisits((cur) => ({ ...cur, ...Object.fromEntries(pairs) }));
    });
    return () => {
      active = false;
    };
  }, [groups, placeVisits]);

  /** The days this group covers — the override if you set one, otherwise the photos. */
  function groupRange(g: Group): { start: string; end: string } | null {
    const override = groupDate[g.id];
    if (override) return { start: override, end: override };
    const days = g.items
      .map((it) => (it.takenAt ? it.takenAt.slice(0, 10) : ''))
      .filter(Boolean)
      .sort();
    if (days.length === 0) return null;
    return { start: days[0], end: days[days.length - 1] };
  }

  const dayGap = (a: string, b: string) =>
    Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

  /**
   * The visit these photos belong to, if one already exists.
   *
   * Approved 2026-08-14: photos landing on a place that already has a visit on touching
   * dates JOIN it rather than making a second one. The stay-grouping fix keeps a run of
   * days together WITHIN a batch; this is the same rule applied across what is already
   * saved, which is the other half of how Rome ended up as two.
   */
  function joinTarget(g: Group): Visit | null {
    if (!g.placeId) return null; // a brand-new place has nothing to join
    const range = groupRange(g);
    if (!range) return null;
    const existing = placeVisits[g.placeId] ?? [];
    for (const v of existing) {
      const vStart = v.start_date;
      const vEnd = v.end_date || v.start_date;
      if (!vStart) continue;
      // touching or overlapping, in either direction
      if (dayGap(vEnd, range.start) <= 1 && dayGap(range.end, vStart) <= 1) return v;
    }
    return null;
  }

  async function addAll() {
    // A group is ready if it has a place, or a place STAGED for it. This is the save
    // step, and the only place a staged one becomes real.
    const ready = groups.filter((g) => g.placeId || pending[g.id]);
    const total = ready.reduce((n, g) => n + g.items.length, 0);
    if (total === 0) {
      setNote('Give at least one visit a place first.');
      return;
    }
    setPhase('uploading');
    let added = 0;
    let n = 0;
    for (const g of ready) {
      let placeId: string | null;
      try {
        placeId = await realisePlace(g);
      } catch (e) {
        showSnack({
          message:
            e instanceof Error
              ? `Could not create ${g.placeName}: ${e.message}`
              : `Could not create ${g.placeName}.`,
        });
        continue;
      }
      if (!placeId) continue;
      const pl = places.find((p) => p.id === placeId);

      // JOIN AN EXISTING STAY. If this place already has a visit on touching dates,
      // widen it to cover these days rather than letting a second visit be derived
      // beside it. Widening is what makes the join real: a day already covered by a
      // manual visit does not get a derived twin (0157), so the photos land inside the
      // visit that was already there. This is the other half of the Rome fix — the
      // grouping keeps a run of days together within a batch, this keeps it together
      // with what is already saved.
      const join = joinTarget(g);
      const range = groupRange(g);
      if (join && range) {
        const newStart = range.start < join.start_date ? range.start : join.start_date;
        const joinEnd = join.end_date || join.start_date;
        const newEnd = range.end > joinEnd ? range.end : joinEnd;
        if (newStart !== join.start_date || newEnd !== joinEnd) {
          try {
            await setVisitDates(join.id, newStart, newEnd);
          } catch (e) {
            showSnack({
              message:
                e instanceof Error
                  ? `Could not extend the existing visit: ${e.message}`
                  : 'Could not extend the existing visit.',
            });
          }
        }
      }
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
            return assignPhotoToPlace(it.photoId, placeId, takenAt)
              .then(() => ({ ok: true }))
              .catch(() => null);
          }
          // Through the global upload queue (progress + retry). No-GPS photos fall
          // back to the assigned place's coordinates.
          return enqueueUpload(it.file!, {
            placeId,
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
      // other visits that merely fall near this one at this place (which would
      // overwrite a separate visit's attribution).
      const who = groupWho[g.id] ?? 'both';
      const profileId = whoProfileId(who, meId);
      const days = new Set<string>(
        g.items
          .map((it) => (override ? override : (it.takenAt ?? '').slice(0, 10)))
          .filter((d): d is string => !!d),
      );
      if (days.size) {
        try {
          const visits = await fetchVisits(placeId);
          const touched = visits.filter((v) =>
            [...days].some((d) => d >= v.start_date && d <= v.end_date),
          );
          // ONE sentence for the whole batch. A snack per visit would fire a dozen
          // times to say the same thing once (0243).
          announceWho(
            mergeOutcomes(
              await Promise.all(touched.map((v) => setVisitSolo(v.id, profileId ?? null))),
            ),
            people,
          );
        } catch {
          /* ignore */
        }
      }
    }
    const placesTouched = new Set(ready.map((g) => g.placeId ?? g.id)).size;
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

  // Counts groups with a STAGED place too — the Save button must offer to save what
  // you have chosen, even though none of it is written yet.
  const assignedPhotos = groups
    .filter((g) => g.placeId || pending[g.id])
    .reduce((n, g) => n + g.items.length, 0);

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
            them into <b>visits</b> (a run of days at one place = one trip). Confirm the place and
            who was there for each.
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
                {/* Approved 2026-08-14: say it BEFORE saving, so joining an existing
                    stay is visible rather than something that just happened. */}
                {(() => {
                  const join = joinTarget(g);
                  const range = groupRange(g);
                  if (!join || !range) return null;
                  const joinEnd = join.end_date || join.start_date;
                  const start = range.start < join.start_date ? range.start : join.start_date;
                  const end = range.end > joinEnd ? range.end : joinEnd;
                  return (
                    <p className="ps-join label">
                      {g.placeName} already has a visit {visitDates(join.start_date, joinEnd)}.
                      These join it
                      {start !== join.start_date || end !== joinEnd
                        ? `, making it ${visitDates(start, end)}`
                        : ''}
                      .
                    </p>
                  );
                })()}
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
                          {whoOptions.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.label}
                            </option>
                          ))}
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
            <Link to="/" className="as-button primary">
              Back to map
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
