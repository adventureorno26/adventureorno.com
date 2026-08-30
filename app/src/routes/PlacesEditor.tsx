import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  deletePlace,
  fetchAllVisits,
  fetchVisitPeopleAll,
  fetchMapPeople,
  fetchPlacePeople,
  fetchPlaces,
  fetchUndatedPhotoPlaces,
  placeNeeds,
  repairablePlaces,
  restorePlace,
  setPlaceSolo,
  setVisitParticipants,
  updatePlace,
} from '../lib/data';
import type { MapPerson, PlaceNeed } from '../lib/data';
import {
  assignPhotoToPlace,
  deletePhoto,
  fetchPhotosForPlace,
  mapPool,
  restorePhoto,
  setPhotosTakenAt,
  uploadPhoto,
} from '../lib/photos';
import { showSnack } from '../lib/snackbar';
import { googlePhotosEnabled, pickFromGooglePhotos } from '../lib/googlePhotos';
import { MANUAL_CATEGORIES, categoryLabel } from '../lib/categories';
import PhotoMatchReview from '../components/PhotoMatchReview';
import AuthedImg from '../components/AuthedImg';
import type { Photo, Place, Visit } from '../lib/types';
import { whoForWrite, whoSingle } from '../lib/participants';
import WhoPicker from '../components/WhoPicker';
import { announceWho } from '../lib/whoWasThere';

/**
 * ARRIVING FROM A REPAIR TILE, SHOWING ONLY WHAT IT COUNTED.
 *
 * "Name them" for 10 unnamed places used to open this table with all 168 rows and
 * no filter, sort or highlight, so the button appeared to do nothing (measured
 * live, 2026-08-30). `?needs=` narrows the table to exactly the rows the tile
 * counted — the place predicates come from `lib/data`, the same ones the count
 * uses, so the number on the tile and the rows here cannot disagree.
 *
 * `photo-dates` is the odd one out and deliberately so: it is not a fact about a
 * place, it is "this place holds photos with no capture time" — and the repair for
 * those IS here (open Photos on the row, tick them, Set date), which is why it
 * lands here rather than anywhere else.
 */
type NeedsFilter = PlaceNeed | 'photo-dates';
const NEEDS: Record<NeedsFilter, { heading: string; how: string }> = {
  unnamed: {
    heading: 'places still waiting for a name',
    how: 'Type over “New place” in the Name column — it saves as you leave the field.',
  },
  untagged: {
    heading: 'places with no tags',
    how: 'Add a tag in the Tags column so they show the right marker and review section.',
  },
  undated: {
    heading: 'places with no visit date',
    how: 'Pick the visit in the Visit column, or add one from the place’s own card.',
  },
  'photo-dates': {
    heading: 'places holding photos with no date',
    how: 'Open Photos on the row, tick the ones with no date, then Set date. Photos that are not on the map at all are in Sort photos instead.',
  },
};
function asNeeds(v: string | null): NeedsFilter | null {
  return v && v in NEEDS ? (v as NeedsFilter) : null;
}

/** Both the filter and the per-row control hold the same thing: profile ids.
 *
 *  The FILTER's empty set means "do not narrow this" — the answer that used to be the
 *  word "Anyone", which §0.2 retired outright because it only ever meant "everyone in
 *  this household" and there is no household. Empty is a better shape for it than a
 *  keyword anyway: an unpicked filter narrows nothing without having to be interpreted.
 *
 *  The ROW's empty set means "it was just you" (Erica, 2026-08-30). They are still two
 *  different questions — whose places to SHOW versus who was THERE — which is why they
 *  are two pieces of state and not one, and why /places/edit lists a place nobody has
 *  recorded a visit to under an empty filter and never under a tagging. */
type PersonKey = string[];
type Who = string[];
type RowStatus = 'saving' | 'saved' | 'error' | undefined;

function fmtVisit(v: Visit): string {
  const d = (s: string) =>
    new Date(s + 'T00:00:00').toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  return (v.trip_marked || v.end_date !== v.start_date) && v.end_date !== v.start_date
    ? `${d(v.start_date)} – ${d(v.end_date)}`
    : d(v.start_date);
}

/** One editable table for every place: rename, fix location, retag, rate, pick
 *  WHICH VISIT you're editing (who was there is per-visit), manage its photos, and
 *  delete — without hopping between map cards. */
export default function PlacesEditor() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';

  const [places, setPlaces] = useState<Place[]>([]);
  const [people, setPeople] = useState<MapPerson[]>([]);
  const [placePeople, setPlacePeople] = useState<Map<string, Set<string>>>(new Map());
  const [visitsByPlace, setVisitsByPlace] = useState<Map<string, Visit[]>>(new Map());
  /** visit id → the profiles on it (0187). Replaces reading `solo_profile`, which can
   *  only ever say one person or everybody. */
  const [visitPeople, setVisitPeople] = useState<Map<string, string[]>>(new Map());
  const [selVisit, setSelVisit] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [person, setPerson] = useState<PersonKey>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const needs = asNeeds(searchParams.get('needs'));
  /** place id → how many of its photos have no capture time. Only loaded when the
   *  filter that needs it is on — this table is heavy enough already. */
  const [undatedPhotos, setUndatedPhotos] = useState<Map<string, number>>(new Map());
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [note, setNote] = useState<string | null>(null);

  // Google Photos matcher overlay (per row).
  const [photoTarget, setPhotoTarget] = useState<Place | null>(null);
  const [pickedFiles, setPickedFiles] = useState<File[] | null>(null);
  // Existing-photos panel (view + delete before adding more).
  const [photoPanel, setPhotoPanel] = useState<Place | null>(null);
  const [panelPhotos, setPanelPhotos] = useState<Photo[] | null>(null);
  const [selPhotos, setSelPhotos] = useState<Set<string>>(new Set());
  const [batchDate, setBatchDate] = useState('');

  const serverById = useRef<Map<string, Place>>(new Map());

  function load() {
    fetchPlaces()
      .then((rows) => {
        const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
        setPlaces(sorted);
        serverById.current = new Map(sorted.map((p) => [p.id, p]));
      })
      .catch(() => setNote('Could not load places'));
    fetchMapPeople()
      .then(setPeople)
      .catch(() => undefined);
    fetchPlacePeople()
      .then(setPlacePeople)
      .catch(() => undefined);
    fetchVisitPeopleAll()
      .then(setVisitPeople)
      .catch(() => undefined);
    fetchAllVisits()
      .then((vs) => {
        const m = new Map<string, Visit[]>();
        for (const v of vs) {
          if (!m.has(v.place_id)) m.set(v.place_id, []);
          m.get(v.place_id)!.push(v);
        }
        setVisitsByPlace(m);
      })
      .catch(() => undefined);
  }
  useEffect(load, []);
  useEffect(() => {
    if (needs !== 'photo-dates') return;
    let live = true;
    fetchUndatedPhotoPlaces()
      .then((m) => live && setUndatedPhotos(m))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [needs]);

  const meId = profile?.id ?? null;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    // The repair filter runs FIRST and over the same set the tile counted.
    const base =
      needs === null
        ? places
        : needs === 'photo-dates'
          ? places.filter((p) => (undatedPhotos.get(p.id) ?? 0) > 0)
          : repairablePlaces(places).filter((p) => placeNeeds(p, needs));
    return base.filter((p) => {
      if (s) {
        const hay = `${p.name} ${p.city ?? ''} ${p.admin1 ?? ''} ${p.country ?? ''}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      // NOBODY PICKED NARROWS NOTHING. The four pills this replaced each carried their
      // own reading of the same set — "Anyone" meant do not narrow, "Just me" meant the
      // set contains me, and "Together" meant it contains EVERY member — and only the
      // last of those could describe two people out of three. Picking names is one rule:
      // show the places everybody picked contributed to.
      if (person.length === 0) return true;
      const set = placePeople.get(p.id) ?? new Set<string>();
      return person.every((id) => set.has(id));
    });
  }, [places, q, person, placePeople, needs, undatedPhotos]);

  function setRowStatus(id: string, s: RowStatus) {
    setStatus((cur) => ({ ...cur, [id]: s }));
  }
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

  // --- Per-visit "who" ------------------------------------------------------
  function visitsOf(id: string): Visit[] {
    return visitsByPlace.get(id) ?? [];
  }
  function selectedVisit(p: Place): Visit | null {
    const vs = visitsOf(p.id);
    if (vs.length === 0) return null;
    return vs.find((v) => v.id === selVisit[p.id]) ?? vs[0];
  }
  function whoOfVisit(v: Visit): Who {
    // THE PARTICIPANT ROWS, whole. This used to reduce them to "exactly one participant
    // means that person, anything else means everyone" because the control had three
    // words to say it in — so a visit with three of us read as the same answer as a visit
    // with two, and saving from that reading wrote the difference away.
    return visitPeople.get(v.id) ?? [];
  }
  /** A place with NO VISITS has no day to attribute, so the row falls back to who has
   *  contributed anything here at all. It writes through `set_place_solo`, which holds
   *  ONE name — see `setWho` below. */
  function whoOfPlace(id: string): Who {
    return [...(placePeople.get(id) ?? new Set<string>())];
  }
  // Union of everyone across a place's visits, straight from the participant rows.
  function peopleUnion(visits: Visit[]): Set<string> {
    const set = new Set<string>();
    for (const vv of visits) {
      for (const id of visitPeople.get(vv.id) ?? []) set.add(id);
    }
    return set;
  }

  async function setWho(p: Place, ids: Who) {
    const v = selectedVisit(p);
    setRowStatus(p.id, 'saving');
    try {
      if (v) {
        // A VISIT HOLDS THE WHOLE LIST — `set_visit_participants`, the function
        // `set_visit_solo` has been a one-element wrapper around since 0243. Nothing is
        // collapsed on the way to the database here.
        const on = whoForWrite(ids, meId);
        const outcome = await setVisitParticipants(v.id, on);
        announceWho(outcome, people);
        // ASKED IS NOT THERE. Reflecting the pick locally while the answer is still
        // pending would put somebody on a visit they have not agreed to (0240/0243), so
        // only the people actually on it now go into the local map.
        const applied = on.filter((id) => !outcome.asked.includes(id));
        setVisitPeople((cur) => {
          const next = new Map(cur);
          next.set(v.id, applied);
          return next;
        });
        // The place's aggregate people are the UNION across ALL its visits — editing one
        // visit must never replace people contributed by another.
        const updated = visitsByPlace.get(p.id) ?? [];
        setVisitsByPlace((cur) => {
          const next = new Map(cur);
          next.set(p.id, updated);
          return next;
        });
        setPlacePeople((cur) => {
          const next = new Map(cur);
          next.set(p.id, peopleUnion(updated));
          return next;
        });
        if (outcome.asked.length) {
          setRowStatus(p.id, 'saved');
          return;
        }
      } else {
        // NO VISIT TO ATTRIBUTE, so this is the place-level write — and it holds ONE
        // name: `set_place_solo(p_place, p_profile)` takes a single profile id. That is
        // why this row's picker is `capacity="one"`, and why `whoSingle` throws rather
        // than keep the first of two if that ever stops being true. It also asks ONCE
        // about the place rather than once per visit (0242).
        const profileId = whoSingle(ids, meId);
        const outcome = await setPlaceSolo(p.id, profileId);
        announceWho(outcome, people);
        if (outcome.asked.length) {
          setRowStatus(p.id, 'saved');
          return;
        }
        setPlacePeople((cur) => {
          const next = new Map(cur);
          next.set(p.id, new Set(profileId ? [profileId] : []));
          return next;
        });
      }
      setRowStatus(p.id, 'saved');
      window.setTimeout(() => setRowStatus(p.id, undefined), 1400);
    } catch {
      setRowStatus(p.id, 'error');
    }
  }

  // --- Photos ---------------------------------------------------------------
  function openPhotos(p: Place) {
    setPhotoPanel(p);
    setPanelPhotos(null);
    setSelPhotos(new Set());
    setBatchDate('');
    fetchPhotosForPlace(p.id)
      .then(setPanelPhotos)
      .catch(() => setPanelPhotos([]));
  }
  function togglePhoto(id: string) {
    setSelPhotos((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  async function batchSetDate() {
    const ids = [...selPhotos];
    if (ids.length === 0 || !batchDate) return;
    try {
      await setPhotosTakenAt(ids, `${batchDate}T12:00:00Z`);
      if (photoPanel) openPhotos(photoPanel);
    } catch {
      setNote('Could not set the dates.');
    }
  }
  async function batchMove(placeId: string) {
    const ids = [...selPhotos];
    if (ids.length === 0) return;
    // Track each row's outcome; keep the failures SELECTED so they're retryable and
    // report the exact count rather than claiming everything moved.
    const results = await mapPool(
      ids,
      async (id) => {
        try {
          await assignPhotoToPlace(id, placeId);
          return { id, ok: true };
        } catch {
          return { id, ok: false };
        }
      },
      4,
    );
    const failed = new Set(results.filter((r) => !r!.ok).map((r) => r!.id));
    const moved = ids.length - failed.size;
    setPanelPhotos((cur) =>
      cur ? cur.filter((p) => failed.has(p.id) || !selPhotos.has(p.id)) : cur,
    );
    setSelPhotos(failed);
    showSnack({
      message: failed.size
        ? `Moved ${moved}; ${failed.size} failed — still selected, try again.`
        : `Moved ${moved} photo${moved === 1 ? '' : 's'}.`,
    });
  }
  async function batchDelete() {
    const ids = [...selPhotos];
    if (ids.length === 0) return;
    const results = await mapPool(
      ids,
      async (id) => {
        try {
          await deletePhoto(id);
          return { id, ok: true };
        } catch {
          return { id, ok: false };
        }
      },
      4,
    );
    const failed = new Set(results.filter((r) => !r!.ok).map((r) => r!.id));
    const deleted = ids.filter((id) => !failed.has(id));
    setPanelPhotos((cur) =>
      cur ? cur.filter((p) => failed.has(p.id) || !ids.includes(p.id)) : cur,
    );
    setSelPhotos(failed); // keep failures selected for retry
    if (deleted.length) {
      // Undo restores ONLY the photos that were actually deleted.
      showSnack({
        message: failed.size
          ? `${deleted.length} to trash; ${failed.size} failed (still selected).`
          : `${deleted.length} photo${deleted.length === 1 ? '' : 's'} to trash`,
        actionLabel: 'Undo',
        onAction: () => {
          void mapPool(deleted, (id) => restorePhoto(id).catch(() => null), 4).then(
            () => photoPanel && openPhotos(photoPanel),
          );
        },
      });
    } else if (failed.size) {
      showSnack({
        message: `Couldn't delete ${failed.size} photo${failed.size === 1 ? '' : 's'} — still selected, try again.`,
      });
    }
  }
  async function removePhoto(id: string) {
    try {
      await deletePhoto(id);
      setPanelPhotos((cur) => (cur ? cur.filter((ph) => ph.id !== id) : cur));
      showSnack({
        message: 'Photo moved to trash',
        actionLabel: 'Undo',
        onAction: () => {
          void restorePhoto(id)
            .then(() => photoPanel && openPhotos(photoPanel))
            .catch(() => undefined);
        },
      });
    } catch {
      setNote('Could not delete that photo.');
    }
  }
  async function pickPhotosFor(p: Place) {
    if (!googlePhotosEnabled()) {
      setNote('Google Photos isn’t configured.');
      return;
    }
    setNote(`Opening Google Photos for ${p.name || 'this place'}…`);
    try {
      const files = await pickFromGooglePhotos((s) => setNote(s));
      setNote(null);
      if (files.length) {
        setPhotoTarget(p);
        setPickedFiles(files);
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Google Photos import failed.');
    }
  }
  async function uploadTo(p: Place, files: File[]) {
    setPhotoTarget(null);
    setPickedFiles(null);
    if (files.length === 0) return;
    setNote(`Adding ${files.length} photo${files.length === 1 ? '' : 's'} to ${p.name}…`);
    let added = 0;
    const results = await mapPool(
      files,
      (f) =>
        uploadPhoto(f, { placeId: p.id, lat: p.lat, lng: p.lng, override: true }).catch(() => null),
      4,
    );
    results.forEach((r) => {
      if (r && r.ok) added++;
    });
    setNote(added > 0 ? `Added ${added} to ${p.name}.` : `No photos added to ${p.name}.`);
    if (photoPanel?.id === p.id) openPhotos(p); // refresh the panel
  }

  async function onDelete(p: Place) {
    try {
      await deletePlace(p.id);
      setPlaces((cur) => cur.filter((x) => x.id !== p.id));
      serverById.current.delete(p.id);
      showSnack({
        message: `Moved “${p.name || 'place'}” to trash`,
        actionLabel: 'Undo',
        onAction: () => {
          void restorePlace(p.id)
            .then(load)
            .catch(() => undefined);
        },
      });
    } catch {
      setNote(`Could not delete ${p.name}.`);
    }
  }

  if (!canEdit) {
    return (
      <div className="page" style={{ maxWidth: 760 }}>
        <Link className="back-bar" to="/settings/data/manage">
          <span>Settings</span>
        </Link>
        <p>Only editors can bulk-edit places.</p>
      </div>
    );
  }

  return (
    <div className="places-editor">
      {/* BACK TO WHERE YOU CAME FROM. Arriving from a repair tile and being offered
          "Settings" is the wrong door — the queue you were working through is the
          one you want to return to. */}
      <Link className="back-bar" to={needs ? '/settings/data/attention' : '/settings/data/manage'}>
        <span>{needs ? 'Needs attention' : 'Settings'}</span>
      </Link>
      <h1>Edit all places</h1>
      {needs ? (
        <div className="pe-needs" role="status">
          <b>
            {filtered.length} {NEEDS[needs].heading}
          </b>
          <span className="label">{NEEDS[needs].how}</span>
          <button type="button" onClick={() => setSearchParams({}, { replace: true })}>
            {/* NOT "Show all" — "All" is a retired scope word (§0.2, 2026-08-30) and
                this row sits inches from the who-was-there filter that used to say it. */}
            Show every place ({places.length})
          </button>
        </div>
      ) : (
        <p className="label" style={{ margin: '0 0 12px' }}>
          Change any field — it saves as you go. Pick which visit you’re editing to set who was
          there that day. Photos opens what’s already saved, where you can delete or add more.
        </p>
      )}

      <div className="pe-controls">
        <input
          placeholder="Search places…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pe-search"
        />
        {/* THE FILTER IS THE SAME PICKER AS THE ROWS, asking the other question. It used
            to be four pills — a row whose everyone-pill was re-added at the end with the
            word typed in by hand, so it read one vocabulary while every card read another
            and neither could describe two people out of three. Picking names has one
            rule and needs no vocabulary at all; picking nobody narrows nothing, which is
            the answer the retired word "Anyone" used to carry. */}
        <div className="pe-personfilter">
          <WhoPicker
            people={people}
            meId={meId}
            value={person}
            onChange={setPerson}
            heading="Whose places?"
            note="Show only the places everyone you tick has been to. Tick nobody to show them all."
            emptyLabel="Who"
            saveLabel="Show these"
          />
          {person.length > 0 && (
            <button type="button" onClick={() => setPerson([])}>
              Clear
            </button>
          )}
        </div>
        <span className="label">{filtered.length} places</span>
      </div>

      {note && <div className="banner">{note}</div>}

      <div className="pe-scroll">
        <table className="pe-table">
          <thead>
            <tr>
              <th className="pe-col-name">Name</th>
              <th className="pe-col-city">City</th>
              <th className="pe-col-state">State / region</th>
              <th className="pe-col-country">Country</th>
              <th className="pe-col-tags">Tags</th>
              <th className="pe-col-rating">Rating</th>
              <th className="pe-col-visit">Visit</th>
              <th className="pe-col-who">Who was there</th>
              <th className="pe-col-photos">Photos</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const avail = MANUAL_CATEGORIES.filter((c) => !(p.categories ?? []).includes(c.slug));
              const st = status[p.id];
              const vs = visitsOf(p.id);
              const sv = selectedVisit(p);
              const who = sv ? whoOfVisit(sv) : whoOfPlace(p.id);
              return (
                <tr key={p.id}>
                  <td className="pe-col-name">
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
                      {st && (
                        <span className={`pe-status ${st}`}>
                          {st === 'saving' ? '…' : st === 'saved' ? 'saved' : 'retry'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="pe-col-city">
                    <input
                      value={p.city ?? ''}
                      onChange={(e) => edit(p.id, { city: e.target.value })}
                      onBlur={(e) => commitText(p.id, 'city', e.target.value)}
                    />
                  </td>
                  <td className="pe-col-state">
                    <input
                      value={p.admin1 ?? ''}
                      onChange={(e) => edit(p.id, { admin1: e.target.value })}
                      onBlur={(e) => commitText(p.id, 'admin1', e.target.value)}
                    />
                  </td>
                  <td className="pe-col-country">
                    <input
                      value={p.country ?? ''}
                      onChange={(e) => edit(p.id, { country: e.target.value })}
                      onBlur={(e) => commitText(p.id, 'country', e.target.value)}
                    />
                  </td>
                  <td className="pe-col-tags">
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
                      <select
                        aria-label="Add a tag"
                        value=""
                        onChange={(e) => addTag(p.id, e.target.value)}
                      >
                        <option value="">+ tag</option>
                        {avail.map((c) => (
                          <option key={c.slug} value={c.slug}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="pe-col-rating">
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
                  <td className="pe-col-visit">
                    {vs.length === 0 ? (
                      <span className="label">No visits</span>
                    ) : (
                      <select
                        value={sv?.id ?? ''}
                        onChange={(e) => setSelVisit((cur) => ({ ...cur, [p.id]: e.target.value }))}
                      >
                        {vs.map((v) => (
                          <option key={v.id} value={v.id}>
                            {fmtVisit(v)}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="pe-col-who">
                    {/* CAPACITY FOLLOWS THE RECORD BEING WRITTEN, per row: the selected
                        VISIT takes the whole list, and a place with no visits at all is
                        written through `set_place_solo`, which holds one name. */}
                    <WhoPicker
                      people={people}
                      meId={meId}
                      value={who}
                      capacity={sv ? 'many' : 'one'}
                      onChange={(ids) => void setWho(p, ids)}
                      note={
                        sv
                          ? undefined
                          : 'This place has no visits, so it is recorded against one name. Nobody ticked means it was just you.'
                      }
                    />
                  </td>
                  <td className="pe-col-photos">
                    <button type="button" className="pe-add" onClick={() => openPhotos(p)}>
                      Photos
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

      {photoPanel && (
        <div
          className="photo-match-overlay"
          role="dialog"
          aria-label={`Photos for ${photoPanel.name}`}
          onClick={() => setPhotoPanel(null)}
        >
          <div className="photo-match-card" onClick={(e) => e.stopPropagation()}>
            <div className="photo-match-head">
              <b>Photos — {photoPanel.name || 'this place'}</b>
              <span className="label">
                {panelPhotos ? `${panelPhotos.length} saved` : 'Loading…'}
              </span>
            </div>
            {panelPhotos && panelPhotos.length > 0 ? (
              <>
                {selPhotos.size > 0 && (
                  <div className="pe-batchbar">
                    <b>{selPhotos.size} selected</b>
                    <input
                      type="date"
                      value={batchDate}
                      onChange={(e) => setBatchDate(e.target.value)}
                    />
                    <button disabled={!batchDate} onClick={() => void batchSetDate()}>
                      Set date
                    </button>
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) void batchMove(e.target.value);
                      }}
                    >
                      <option value="">Move to…</option>
                      {places
                        .filter((p) => p.id !== photoPanel?.id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                    <button className="pe-del" onClick={() => void batchDelete()}>
                      Delete
                    </button>
                    <button onClick={() => setSelPhotos(new Set())}>Clear</button>
                  </div>
                )}
                <div className="pe-photo-grid">
                  {panelPhotos.map((ph) => (
                    <div
                      key={ph.id}
                      className={`pe-photo-cell ${selPhotos.has(ph.id) ? 'sel' : ''}`}
                      onClick={() => togglePhoto(ph.id)}
                    >
                      <AuthedImg photoId={ph.id} size="thumb" alt="" />
                      {selPhotos.has(ph.id) && <span className="pe-photo-check">✓</span>}
                      <button
                        type="button"
                        className="pe-photo-del"
                        title="Delete photo"
                        onClick={(e) => {
                          e.stopPropagation();
                          void removePhoto(ph.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : panelPhotos ? (
              <p className="label" style={{ margin: '6px 0 12px' }}>
                No photos here yet.
              </p>
            ) : (
              <p className="label">Loading photos…</p>
            )}
            <div className="btn-row" style={{ marginTop: 8 }}>
              {googlePhotosEnabled() && (
                <button className="primary" onClick={() => void pickPhotosFor(photoPanel)}>
                  Add from Google Photos
                </button>
              )}
              <button onClick={() => setPhotoPanel(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

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
