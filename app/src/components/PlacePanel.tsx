import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addExperience,
  clearCity,
  createEntry,
  createPlaceAtomic,
  deletePlace,
  deleteVisit,
  isTripNotEmpty,
  restoreVisit,
  fetchCityBoundary,
  fetchEntries,
  fetchMapPeople,
  fetchCardView,
  fetchPlace,
  fetchPlaceRatings,
  fetchVisits,
  fetchVisitsForPlaces,
  newExperienceKey,
  setCityBoundary,
  setMyRating,
  setPlaceName,
  canRenamePlace,
  setVisitIsTrip,
  type TripContent,
  setVisitDates,
  setVisitSolo,
  updatePlace,
  type MapPerson,
  type CardView,
} from '../lib/data';
import {
  activityDay,
  type Activity,
  type Entry,
  type NewEntry,
  type Place,
  type Visit,
} from '../lib/types';
import { CATEGORIES, categoryIcon, categoryLabel, effectiveCategories } from '../lib/categories';
import { useAuth } from '../auth/AuthProvider';
import { fetchActivitiesForPlaceTree, fetchMileageForPlaces, setActivitySolo } from '../lib/strava';
import { photosEnabled } from '../lib/photos';
import { showSnack } from '../lib/snackbar';
import { retrieveResult, type SearchResult } from '../lib/maptiler';
import AuthedImg from './AuthedImg';
import EntryEditor from './EntryEditor';
import MapSearch from './MapSearch';
import PhotoGallery from './PhotoGallery';
import WeatherLine from './WeatherLine';
import RouteMiniMap from './RouteMiniMap';
import { pluralLabel } from '../lib/plural';
import { byYear, visitDates } from '../lib/visitDates';
import StarRating from './StarRating';

interface Props {
  place: Place;
  allPlaces: Place[];
  onClose: () => void;
  onPlaceChanged: (place: Place) => void;
  onPlaceDeleted: (id: string) => void;
  onMerged: (loserId: string, winner: Place) => void;
  onAddRoute?: (trailId: string, name: string) => void;
  // Per-view visit counts (place_visit_counts for the map's Just me / Just Josh /
  // Both view), already loaded by the map and passed down rather than re-fetched.
  // A trail's Sections count what YOU did, so "6 of 7 done" means something
  // different in each view.
}

/** Prepend https:// when the user typed a bare domain, so the link works. */
function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Apple Maps directions link for a newPlace's OWN address/coords, or null if it has
 *  neither (then it just shows as a plain entry with no Directions button). */
function noteDirHref(e: Entry): string | null {
  const hasCoords = e.lat != null && e.lng != null;
  const dest = e.address?.trim() || (hasCoords ? `${e.lat},${e.lng}` : '');
  if (!dest) return null;
  const sll = hasCoords ? `&sll=${e.lat},${e.lng}` : '';
  return `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}${sll}&dirflg=d`;
}

/** Meters → "12.3 mi". */
function miStr(meters: number): string {
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

/** Parse the city from a geocoded address — the token just before the state, e.g.
 *  "5083 Santa Monica Ave, San Diego, California 92107" → "San Diego". Null if it
 *  can't be found. */
function parseCity(address: string | null, admin1: string | null): string | null {
  const parts = (address ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const st = (admin1 ?? '').toLowerCase();
  const stIdx = parts.findIndex((s) => st && s.toLowerCase().startsWith(st));
  return stIdx > 0 ? parts[stIdx - 1] : null;
}

// Past-tense verb for a "miles hiked/run/walked/biked" summary.
const ACTIVITY_VERB: Record<string, string> = {
  Run: 'run',
  Hike: 'hiked',
  Walk: 'walked',
  Ride: 'biked',
};
/** "12.3 mi hiked · 5.0 mi run" from meters-by-type. */
function trailMilesSummary(miles: Record<string, number>): string {
  return Object.entries(miles)
    .filter(([, m]) => m > 0)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([type, m]) => `${(m / 1609.344).toFixed(1)} mi ${ACTIVITY_VERB[type] ?? type.toLowerCase()}`,
    )
    .join(' · ');
}

/** A visit as one line: single day, or a compact date range. */

export default function PlacePanel({
  place,
  allPlaces,
  onClose,
  onPlaceChanged,
  onPlaceDeleted,
  onAddRoute,
}: Props) {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';
  // Only the person who named a place in their own space can rename it; a name given
  // in the shared Both space belongs to either of us.
  const canRename = canEdit && canRenamePlace(place, profile?.id);
  // Keep a place in the space it was already named in; a brand-new name goes to the
  // shared space, which is where the two of you curate together.
  const nameScope = place.name_locked ? place.name_scope : null;

  // The redirect that sent a container place to its `trips` row is gone with the
  // table. A trip is a visit you marked, so it lives on THIS card, in the Visits
  // list, with the places visited during it nested inside it.

  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [visitStats, setVisitStats] = useState<Record<string, { photos: number; videos: number }>>(
    {},
  );
  const [trailActs, setTrailActs] = useState<Activity[] | null>(null);
  const [trailMiles, setTrailMiles] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Entry[] | null>(null);
  const [addingVisit, setAddingVisit] = useState(false);
  const [vStart, setVStart] = useState('');
  const [vEnd, setVEnd] = useState('');
  const [vMulti, setVMulti] = useState(false);
  const [vWho, setVWho] = useState(''); // '' = both; else a profile id
  const visitKeyRef = useRef<string | null>(null); // idempotency key per visit submit
  // Editing a visit's dates — "stretch a visit into a trip by adding more days".
  const [editingVisit, setEditingVisit] = useState<string | null>(null);
  const [evStart, setEvStart] = useState('');
  const [evEnd, setEvEnd] = useState('');
  const [merging, setMerging] = useState(false);
  const [addingMembers, setAddingMembers] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [editingName, setEditingName] = useState(false);
  // A trip's contents — the places visited inside its dates. Derived server-side
  // from the dates, so it follows marking/unmarking with nothing stored.
  const [tripContents, setTripContents] = useState<Record<string, TripContent[]>>({});
  const [name, setName] = useState(place.name);
  const [error, setError] = useState<string | null>(null);

  const [review, setReview] = useState(place.review ?? '');
  const [favOpen, setFavOpen] = useState(false);
  const [favInput, setFavInput] = useState('');
  const [people, setPeople] = useState<MapPerson[]>([]);
  const [editingAddress, setEditingAddress] = useState(false);
  const [coverPos, setCoverPos] = useState(place.cover_pos_y ?? 50);
  const [adjustCover, setAdjustCover] = useState(false);
  const [cityBusy, setCityBusy] = useState(false);
  const [cityMsg, setCityMsg] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchMapPeople()
      .then(setPeople)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setReview(place.review ?? '');
    setName(place.name);
    setCoverPos(place.cover_pos_y ?? 50);
  }, [place]);

  // A TRAIL'S VISITS INCLUDE ITS SECTIONS'. Erica: "the Appalachian trail card is
  // already fucked because there should be WAY more visits" — the card showed the 32
  // logged on the trail row and hid the 30 logged on its six sections. Walking a
  // section IS walking the trail, so the card lists all 62, each carrying the segment
  // name. This is also why the Sections list is gone: the segment rides on the visit.
  const sectionIds = place.is_trail
    ? allPlaces.filter((p) => (p.part_of ?? []).includes(place.id)).map((p) => p.id)
    : [];
  const sectionIdKey = sectionIds.join(',');
  const loadVisits = useCallback(
    () =>
      sectionIds.length > 0
        ? fetchVisitsForPlaces([place.id, ...sectionIds])
        : fetchVisits(place.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [place.id, sectionIdKey],
  );

  /** Spread one card payload into the pieces the card draws. Both the first load and
   *  every reload go through here, so they cannot get out of step. */
  function applyCard(card: CardView) {
    setVisitStats(
      Object.fromEntries(card.visits.map((v) => [v.id, { photos: v.photos, videos: v.videos }])),
    );
    setTripContents(
      Object.fromEntries(
        card.visits
          .filter((v) => v.contents.length > 0)
          .map((v) => [
            v.id,
            v.contents.map((c) => ({
              place_id: c.place_id,
              place_name: c.place_name,
              visit_id: c.visit_id,
              start_date: c.start_date,
              end_date: c.end_date ?? c.start_date,
            })),
          ]),
      ),
    );
  }

  async function reloadVisits() {
    // ONE request for the counts and the contents (§0.6). This used to be
    // `place_visit_stats` plus one `trip_contents` call per trip — N+1 requests whose
    // answers could disagree with each other and with the list they labelled.
    //
    // The photo counts also change, for the better: place_visit_stats matched photos
    // by DATE against the place and never looked at `photos.visit_id`, so a photo
    // pinned to one visit was counted for every visit whose range covered its day.
    // Measured on production: 175 of 177 photos are pinned, 10 visits' counts change,
    // and none drops to zero.
    try {
      const [rows, card] = await Promise.all([loadVisits(), fetchCardView({ placeId: place.id })]);
      setVisits(rows);
      applyCard(card);
    } catch (e) {
      // Swallowing this showed an empty, confident card instead of saying it failed.
      setError(
        e instanceof Error ? `Could not load this card: ${e.message}` : 'Could not load this card.',
      );
    }
  }

  // Mark a visit as a trip, or unmark it. The ONLY way is_trip is ever set — it is
  // never derived (it used to be `end_date > start_date`, which silently made every
  // multi-day stay a trip).
  async function toggleVisitIsTrip(visitId: string, next: boolean) {
    try {
      await setVisitIsTrip(visitId, next);
      await reloadVisits();
      const updated = await fetchPlace(place.id).catch(() => null);
      if (updated) onPlaceChanged(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update this visit.');
    }
  }

  async function reloadActs() {
    setTrailActs(await fetchActivitiesForPlaceTree(place.id).catch(() => []));
  }

  // Set who was on a visit row. Activity rows update the activity (visits then
  // re-infer); visit-only rows set a manual override. Reloads both after.
  async function setRowSolo(
    target: { type: 'activity' | 'visit'; id: string },
    profileId: string | null,
  ) {
    try {
      if (target.type === 'activity') await setActivitySolo(target.id, profileId);
      else await setVisitSolo(target.id, profileId);
      await Promise.all([reloadActs(), reloadVisits()]);
    } catch {
      /* leave as-is on failure */
    }
  }

  async function reloadNotes() {
    setNotes(await fetchEntries(place.id).catch(() => []));
  }
  // Add a newPlace/review straight from the main card; its category tags the place
  // and it shows under that category's review section here + on its day.
  // Unified model: a newPlace is a CHILD PLACE (its own marker, card, count) rather
  // than a separate entry. Plain "notes" stay as entries (they aren't places).
  async function addNote(draft: NewEntry) {
    if (draft.kind === 'note') {
      await createEntry({ ...draft, place_id: place.id });
    } else {
      // ONE atomic write (migration 0122). This used to be three separate
      // requests — createPlace, then updatePlace for rating/review, then
      // addVisit — so a failure after the first left a half-built newPlace with no
      // review and no visit, and a retry created a second place.
      const newPlace = await createPlaceAtomic(
        {
          name: draft.title,
          country: place.country,
          admin1: place.admin1,
          lat: draft.lat ?? place.lat,
          lng: draft.lng ?? place.lng,
          address: draft.address ?? null,
          city: parseCity(draft.address ?? null, place.admin1),
          categories: [draft.kind],
          saved: true,
          part_of: [place.id], // grouped under this place
          review: draft.body ?? null,
        },
        {
          date: draft.date || undefined,
          rating: draft.rating ?? null,
        },
      );
      onPlaceChanged(newPlace); // add the new place to the map
    }
    await reloadNotes();
    await refreshPlace();
  }
  // His/her star ratings for this place.
  useEffect(() => {
    let active = true;
    fetchPlaceRatings(place.id)
      .then((r) => active && setRatings(r))
      .catch(() => active && setRatings({}));
    return () => {
      active = false;
    };
  }, [place.id]);

  async function rateMine(n: number | null) {
    const myId = profile?.id;
    if (!myId) return;
    setRatings((prev) => {
      const next = { ...prev };
      if (n == null) delete next[myId];
      else next[myId] = n;
      return next;
    });
    try {
      await setMyRating(place.id, n);
    } catch {
      /* revert-free: reload on failure */
      fetchPlaceRatings(place.id)
        .then(setRatings)
        .catch(() => undefined);
    }
  }

  useEffect(() => {
    let active = true;
    setVisits(null);
    setNotes(null);
    // The trip contents used to be loaded ONLY by reloadVisits, never here, so opening
    // a card showed a trip with nothing inside it until you happened to edit something.
    // One card payload now feeds the first render as well.
    void (async () => {
      try {
        const [rows, card] = await Promise.all([
          loadVisits(),
          fetchCardView({ placeId: place.id }),
        ]);
        if (!active) return;
        setVisits(rows);
        applyCard(card);
      } catch (e) {
        if (!active) return;
        setVisits([]);
        setError(
          e instanceof Error
            ? `Could not load this card: ${e.message}`
            : 'Could not load this card.',
        );
      }
    })();
    fetchEntries(place.id)
      .then((rows) => active && setNotes(rows))
      .catch(() => active && setNotes([]));
    return () => {
      active = false;
    };
  }, [place.id]);

  // Trail places group their runs/hikes by trailhead; load the place's activities
  // and the total mileage-by-type across the trail + its trailhead members.
  useEffect(() => {
    let active = true;
    setTrailActs(null);
    // Every place lists its own activities as visit rows (not just trails) — and a
    // container also lists its segments', so the W&OD shows all 55 runs rather than
    // the 6 that happen to sit on the trail row itself.
    fetchActivitiesForPlaceTree(place.id)
      .then((rows) => active && setTrailActs(rows))
      .catch(() => active && setTrailActs([]));
    if (place.is_trail) {
      const memberIds = allPlaces
        .filter((p) => (p.part_of ?? []).includes(place.id))
        .map((p) => p.id);
      fetchMileageForPlaces([place.id, ...memberIds])
        .then((m) => active && setTrailMiles(m))
        .catch(() => undefined);
    } else {
      setTrailMiles({});
    }
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.id, place.is_trail, allPlaces]);

  // A trip groups its member places by CITY (with a separate Activities group);
  // everything else groups them by category alongside its entry-notes.
  const memberPlaces = allPlaces
    .filter((p) => (p.part_of ?? []).includes(place.id))
    .sort((a, b) => (a.first_visit ?? '').localeCompare(b.first_visit ?? ''));

  // The sections' visits used to be fetched separately, to give each row in the
  // Sections list its own dates. That list is gone and loadVisits() now pulls the
  // trail AND its sections in one request, so this second fetch went with it.

  // SPOTS AND REVIEWS — ONE dropdown per category, holding BOTH member places
  // ("part of" this one) and entry-notes of that category. So "dining" shows a
  // single "Restaurant Reviews" section listing every reviewed restaurant,
  // whether it's a linked place or an inline newPlace. In CATEGORIES order. This is
  // the Appalachian-Trail grouping, now used for EVERY card (trips included) so a
  // hotel reads as "Hotel Reviews", not under the trip's city name.
  //
  // A CONTAINER is the exception: the places it holds are its SECTIONS and are
  // listed once, in the Sections list below. They used to appear there AND here,
  // split across "Hiking", "Trail" and "Places" by whatever tag happened to be
  // first — so one Appalachian Trail segment showed up twice under two different
  // headings. This applied to trails only; a city listed its places twice for
  // exactly the same reason, so it now applies to every container.
  const reviewGroups: { key: string; label: string; places: Place[]; entries: Entry[] }[] = [];
  {
    // Only a TRAIL pulls its members out into Sections. Everywhere else they
    // group by category — Wonderland Ocean Pub reads under Restaurant, not
    // under a generic 'places here' list. (Erica, repeatedly.)
    const groupedMembers = place.is_trail ? [] : memberPlaces;
    const placeByKind = new Map<string, Place[]>();
    for (const m of groupedMembers) {
      const k = (m.categories && m.categories[0]) || 'place';
      if (!placeByKind.has(k)) placeByKind.set(k, []);
      placeByKind.get(k)!.push(m);
    }
    const entryByKind = new Map<string, Entry[]>();
    for (const e of notes ?? []) {
      const k = e.kind || 'note';
      if (!entryByKind.has(k)) entryByKind.set(k, []);
      entryByKind.get(k)!.push(e);
    }
    const order = [...CATEGORIES.map((c) => c.slug), 'place', 'note'];
    for (const k of order) {
      const places = placeByKind.get(k) ?? [];
      const entries = entryByKind.get(k) ?? [];
      if (places.length || entries.length) {
        reviewGroups.push({
          key: k,
          label: k === 'note' ? 'Notes' : k === 'place' ? 'Places' : categoryLabel(k),
          places,
          entries,
        });
      }
    }
  }
  // THE LOCKED CARD puts each category in its OWN section — "Restaurants" is a
  // section, not a fold inside Notes and Reviews, which is where they had ended up.
  // Notes and reviews holds notes and reviews, and nothing else.
  // 'place' is the bucket for a member with NO category, and a section headed
  // "Places" is the PLACES HERE section Erica has asked to be rid of many times.
  // The locked card has category sections and nothing else, so it does not render.
  // Three places app-wide land here; the fix is to tag them, not to bucket them.
  const categorySections = reviewGroups.filter((g) => g.key !== 'note' && g.key !== 'place');
  const noteGroups = reviewGroups.filter((g) => g.key === 'note');

  // The rows inside a category section (and inside Notes). Lifted out of the old
  // single "reviewGroups" fold so the SAME markup serves every section — the locked
  // card says every section looks the same, and two copies is how they stop looking
  // the same.
  function renderGroupRows(g: { key: string; places: Place[]; entries: Entry[] }) {
    return (
      <>
        {/* Linked member places of this category */}
        {g.places.map((m) => {
          const dest = m.address || (m.lat || m.lng ? `${m.lat},${m.lng}` : '');
          return (
            <div key={m.id} className="newPlace-row">
              <Link className="newPlace-item" to={`/place/${m.id}`}>
                <span className="newPlace-title">{m.name}</span>
                {m.rating ? <span className="newPlace-rating">{'★'.repeat(m.rating)}</span> : null}
              </Link>
              {dest && (
                <a
                  className="directions-btn sm newPlace-dir"
                  href={`https://maps.apple.com/?daddr=${encodeURIComponent(dest)}&dirflg=d`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Directions to ${m.name}`}
                >
                  Directions
                </a>
              )}
            </div>
          );
        })}
        {/* Inline entry-notes of this category */}
        {g.entries.map((e) => {
          const dir = noteDirHref(e);
          return (
            <div key={e.id} className="newPlace-row">
              <Link
                className="newPlace-item"
                to={e.date ? `/place/${place.id}/day/${e.date}` : `/place/${place.id}`}
              >
                <span className="newPlace-title">{e.title}</span>
                {e.rating ? <span className="newPlace-rating">{'★'.repeat(e.rating)}</span> : null}
              </Link>
              {dir && (
                <a
                  className="directions-btn sm newPlace-dir"
                  href={dir}
                  target="_blank"
                  rel="noreferrer"
                  title={`Directions to ${e.address ?? e.title}`}
                >
                  Directions
                </a>
              )}
            </div>
          );
        })}
      </>
    );
  }

  async function submitVisit() {
    const start = vStart;
    const end = vMulti && vEnd ? vEnd : vStart;
    if (!start) return;
    try {
      // Atomic + idempotent: the visit and its attribution log together, and a
      // double-submit/retry with the same key won't create a second visit.
      if (!visitKeyRef.current) visitKeyRef.current = newExperienceKey();
      await addExperience(
        visitKeyRef.current,
        { id: place.id },
        { date: start, end_date: end < start ? start : end, who: vWho || undefined },
      );
      visitKeyRef.current = null;
      setAddingVisit(false);
      setVStart('');
      setVEnd('');
      setVMulti(false);
      setVWho('');
      await reloadVisits();
      showSnack({ message: 'Visit logged.' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add visit');
    }
  }
  // Saves as you change a date. Takes the values explicitly because React state
  // hasn't updated yet at the moment onChange fires. Keeps the row OPEN — closing
  // it mid-edit is what made the old pill feel like it fought you.
  async function saveVisitDates(id: string, start?: string, end?: string) {
    const s0 = start ?? evStart;
    const e0 = end ?? evEnd;
    if (!s0 || !e0) return;
    if (e0 < s0) {
      setError('A visit cannot end before it starts.');
      return;
    }
    try {
      await setVisitDates(id, s0, e0);
      await reloadVisits();
      await refreshPlace();
      showSnack({ message: 'Visit dates updated.' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the visit dates.');
    }
  }

  async function removeVisit(id: string, children: 'refuse' | 'detach' = 'refuse') {
    // Soft UX: remove immediately, offer Undo — friendlier than a browser confirm,
    // esp. on mobile. The snapshot the server returns is what Undo puts back, and it
    // is more than the row: participants, companions, evidence, and the grouping in
    // both directions.
    try {
      const snapshot = await deleteVisit(id, children);
      await reloadVisits();
      showSnack({
        message:
          children === 'detach'
            ? 'Trip removed — the visits inside it are on their own now.'
            : 'Visit removed.',
        actionLabel: 'Undo',
        onAction: async () => {
          try {
            await restoreVisit(snapshot);
            await reloadVisits();
          } catch (e) {
            // Undo is the safety net for a destructive action. Swallowing this
            // left the visit deleted while the user believed it was restored.
            setError(
              e instanceof Error
                ? `Could not undo: ${e.message}`
                : 'Could not undo — the visit is still removed. Log it again from this place.',
            );
          }
        },
      });
    } catch (e) {
      // Deleting a trip would free everything grouped inside it. The server refuses
      // rather than doing that quietly, so say what would happen and let her decide.
      if (isTripNotEmpty(e)) {
        showSnack({
          message: 'This trip still holds other visits.',
          actionLabel: 'Remove it anyway',
          onAction: () => void removeVisit(id, 'detach'),
        });
        return;
      }
      setError(e instanceof Error ? e.message : 'Could not delete visit');
    }
  }

  async function patch(p: Parameters<typeof updatePlace>[1]) {
    try {
      const updated = await updatePlace(place.id, p);
      onPlaceChanged(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  }

  // After photos change, re-pull the place so its cover_photo_id updates — this
  // is what turns its map marker into the cover photo (automatically).
  async function refreshPlace() {
    const updated = await fetchPlace(place.id).catch(() => null);
    if (updated) onPlaceChanged(updated);
    await reloadVisits(); // a new photo/activity day may have added a visit
  }

  // A name is chosen by a person and belongs to them. Go through set_place_name so
  // the owner and the space are recorded — a plain PATCH would set the text without
  // claiming it, and nothing would stop it drifting later.
  async function saveName() {
    setEditingName(false);
    const next = name.trim();
    if (!next || next === place.name) {
      setName(place.name);
      return;
    }
    try {
      const updated = await setPlaceName(place.id, next, nameScope);
      onPlaceChanged(updated);
    } catch (e) {
      setName(place.name);
      setError(e instanceof Error ? e.message : 'Could not rename this place.');
    }
  }

  // "Edit address" search: sets the full address + pin + state/country (for the
  // Directions link and the States/Countries stats). It does NOT touch the Title
  // — the title is entered by hand and stays independent of the address.
  async function setAddressFromSearch(r: SearchResult) {
    setError(null);
    const full = r.mapbox_id ? await retrieveResult(r).catch(() => r) : r;
    if (full.lat === 0 && full.lng === 0) {
      setError("Couldn't resolve that address — try another.");
      return;
    }
    setEditingAddress(false);
    const newAddress = full.address ?? full.label ?? place.address;
    const newAdmin1 = full.admin1 ?? place.admin1;
    await patch({
      lat: full.lat,
      lng: full.lng,
      admin1: newAdmin1,
      country: full.country ?? place.country,
      // Prefer the full address; fall back to the searched label if no street addr.
      address: newAddress,
      // Derive the city from the new address so trip grouping stays accurate.
      city: parseCity(newAddress, newAdmin1),
    });
  }

  async function toggleCat(slug: string) {
    const cur = place.categories ?? [];
    const on = cur.includes(slug);
    const next = on ? cur.filter((s) => s !== slug) : [...cur, slug];

    // There is no separate "make this a city / region / trail" control any more.
    // The TAG is the answer to "what is it?", and it does the work:
    //   City / Region — fetch the real OSM boundary so places inside roll up
    //                   spatially (that boundary IS what makes it a container).
    //   Trail         — set is_trail, which switches the card to the trail layout.
    if (slug === 'city' || slug === 'region') {
      if (on) await removeCityRegion();
      else await makeCityRegion(slug);
      return;
    }
    await patch({ categories: next, ...(slug === 'trail' ? { is_trail: !on } : {}) });
  }

  // City/region: pull the real OSM boundary for this place, mark it a container,
  // and let every leaf inside it roll up spatially (no manual "part of" needed).
  async function makeCityRegion(kind: 'city' | 'region') {
    setCityBusy(true);
    setCityMsg(null);
    try {
      const query = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
      const geojson = await fetchCityBoundary(query);
      if (!geojson) {
        setCityMsg(
          `No boundary found for “${place.name}” on OpenStreetMap. Use “edit” on the address to match a real place name, then try again.`,
        );
        return;
      }
      await setCityBoundary(place.id, geojson, kind);
      await refreshPlace();
    } catch (e) {
      setCityMsg(e instanceof Error ? e.message : 'Could not fetch that boundary.');
    } finally {
      setCityBusy(false);
    }
  }

  async function removeCityRegion() {
    setCityBusy(true);
    setCityMsg(null);
    try {
      await clearCity(place.id);
      await refreshPlace();
    } catch (e) {
      setCityMsg(e instanceof Error ? e.message : 'Could not remove that.');
    } finally {
      setCityBusy(false);
    }
  }

  // Add THIS place as a VISIT/stop of an existing place — NON-destructive: this
  // place is kept and linked to the chosen one (they can be different stops along
  // the same trail or trip). Full "shows under the parent" display is coming.
  // Add/remove this place from a container's membership. A place can be part of
  // several places at once (e.g. a trail AND a trip). Non-destructive — the place
  // keeps its own marker and just lists under each container it belongs to.
  async function togglePartOf(parentId: string) {
    if (!parentId) return;
    const cur = place.part_of ?? [];
    const next = cur.includes(parentId) ? cur.filter((id) => id !== parentId) : [...cur, parentId];
    try {
      await patch({ part_of: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update that place');
    }
  }

  // Add-from-the-container side: pick existing places and make them part of THIS
  // one in bulk (the "add everything we did on this trip" flow). Non-destructive.
  async function addMembers() {
    const ids = [...selectedMembers];
    for (const id of ids) {
      const child = allPlaces.find((p) => p.id === id);
      if (!child) continue;
      const next = [...new Set([...(child.part_of ?? []), place.id])];
      try {
        const updated = await updatePlace(id, { part_of: next });
        onPlaceChanged(updated);
      } catch {
        /* skip the ones that fail; keep going */
      }
    }
    setSelectedMembers(new Set());
    setAddingMembers(false);
    setMemberSearch('');
  }

  async function removePlace() {
    if (!confirm(`Delete "${place.name}" and everything in it?`)) return;
    try {
      await deletePlace(place.id);
      onPlaceDeleted(place.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete place');
    }
  }

  const hasHero = Boolean(place.cover_photo_id) && photosEnabled();

  // Example hint for the (manual) Title on a freshly-added category place.
  const titlePlaceholder = (() => {
    const cats = effectiveCategories(place);
    if (cats.includes('winery')) return 'Winery Name';
    if (cats.includes('stay')) return 'Hotel Name';
    if (cats.includes('dining')) return 'Name of Restaurant';
    if (cats.includes('brewery')) return 'Brewery Name';
    if (cats.some((c) => ['hiking', 'walking', 'running', 'biking'].includes(c)))
      return 'Trail name';
    return 'Add a title';
  })();

  // His/her ratings. With 2+ people, show a labeled row each (only YOURS is
  // editable) + an "you agree" note when they match. Solo → a single rating.
  const raters =
    people.length >= 2
      ? people
      : profile
        ? [{ id: profile.id, display_name: profile.display_name ?? 'You', role: profile.role }]
        : [];
  const bothRated = raters.length >= 2 && raters.every((p) => ratings[p.id] != null);
  const agree = bothRated && new Set(raters.map((p) => ratings[p.id])).size === 1;
  const ratingEl =
    raters.length >= 2 ? (
      <div className="dual-rating">
        {raters.map((pers) => {
          const mine = pers.id === profile?.id;
          return (
            <span key={pers.id} className="dual-rating-row">
              <span className="dual-rating-who">{mine ? 'You' : pers.display_name}</span>
              <StarRating
                value={ratings[pers.id] ?? null}
                size={15}
                readOnly={!mine}
                onChange={(n) => void rateMine(n)}
              />
            </span>
          );
        })}
        {agree && <span className="dual-rating-agree">you agree</span>}
      </div>
    ) : (
      <StarRating
        value={ratings[profile?.id ?? ''] ?? place.rating}
        size={16}
        readOnly={!canEdit}
        onChange={(n) => void rateMine(n)}
      />
    );

  // The place name, shown as the title on the photo. Click to edit it by hand;
  // the search below also fills it in.
  const titleEl =
    editingName && canRename ? (
      <input
        className="title-input"
        value={name}
        autoFocus
        placeholder={titlePlaceholder}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void saveName()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void saveName();
          if (e.key === 'Escape') {
            setName(place.name);
            setEditingName(false);
          }
        }}
      />
    ) : (
      <span
        className={canRename ? 'title-editable' : undefined}
        onClick={() => canRename && setEditingName(true)}
        title={
          canRename
            ? 'Tap to rename'
            : canEdit
              ? 'Named in the other person\u2019s space \u2014 only they can rename it'
              : undefined
        }
      >
        {place.name || <span className="title-empty">{titlePlaceholder}</span>}
        {place.auto && !place.is_home && <span className="auto-badge">auto</span>}
      </span>
    );

  // "City, State" line under the title — the text itself is the Directions link
  // (no separate Directions button). Routes to the named place/address.
  const dirDest =
    place.address?.trim() ||
    [place.name, place.admin1, place.country].filter(Boolean).join(', ') ||
    `${place.lat},${place.lng}`;
  const dirHref = `https://maps.apple.com/?daddr=${encodeURIComponent(dirDest)}&sll=${place.lat},${place.lng}&dirflg=d`;
  const regionText = [place.admin1, place.country].filter(Boolean).join(', ') || 'Unknown region';

  // THIS PLACE'S OWN DATES — built once, so the header line and the "Visits (N)"
  // dropdown cannot disagree. A visit = each activity row + any photo/entry-only
  // visit day an activity doesn't already cover. Notes are entries, NOT visits,
  // so they never count here.
  //
  // fetchActivitiesForPlaceTree returns the whole tree, and this list used to
  // take all of it: the Appalachian Trail listed nine separate "Maryland
  // Heights" rows. A section's dates belong to the SECTION, listed once below.
  const ownActs = (trailActs ?? []).filter((a) => a.place_id === place.id);
  // A trip/city/region shows its FUSED visit(s) — one trip is ONE visit ("San
  // Diego · Jul 11–16 · Trip"), never a row per activity. That was done by
  // DROPPING the activity rows, which hides them: San Diego's six outings and
  // Leesburg's four appeared nowhere. Nesting them inside the visit they
  // happened on keeps the one-row-per-occasion reading AND keeps the evidence.
  // An outing no visit covers still gets its own row — invisible is worse than
  // untidy.

  // A visit is the occasion; the ride and the run are what we DID during it, so
  // they hang off it (docs/SCHEMA.md) rather than sitting beside it. Brewster is
  // one fused 2-day stay containing a ride and a run — it read as three visits
  // because all three were siblings. Only stays that span more than a day, or
  // that were marked as a trip, adopt their activities; a single-day run is
  // already one flat row and gains nothing from nesting.
  const nestedActs = new Map<string, Activity[]>();
  const nestedIds = new Set<string>();
  for (const v of visits ?? []) {
    const end = v.end_date || v.start_date;
    if (!v.is_trip && end <= v.start_date) continue;
    const mine = ownActs.filter((a) => {
      const d = activityDay(a);
      // Same place as the visit — a hike on one section does not belong under a
      // visit logged on another.
      if ((a.place_id ?? place.id) !== v.place_id) return false;
      return d !== '' && d >= v.start_date && d <= end;
    });
    if (mine.length === 0) continue;
    nestedActs.set(v.id, mine);
    for (const a of mine) nestedIds.add(a.id);
  }

  const actRows = ownActs
    .filter((a) => !nestedIds.has(a.id))
    .map((a) => ({
      key: a.id,
      // Same locked format as every other row in this list ("May 2"), and off the
      // LOCAL day — start_date is UTC, so an evening outing rolls to tomorrow.
      date: visitDates(activityDay(a)),
      sub: [a.name, a.type, miStr(a.distance)].filter(Boolean).join(' · '),
      to: `/place/${a.place_id ?? place.id}/day/${activityDay(a)}`,
      del: null as string | null,
      start: '' as string,
      end: '' as string,
      sort: activityDay(a),
      solo: a.solo_profile as string | null,
      // An outing logged on a SECTION of a trail names that section, exactly as a
      // visit does — the segment rides on the row, not on a Sections list.
      seg:
        a.place_id && a.place_id !== place.id
          ? (allPlaces.find((p) => p.id === a.place_id)?.name ?? null)
          : null,
      trip: false,
      target: { type: 'activity' as const, id: a.id },
    }));
  // KEYED ON PLACE + DAY. This used to be the day alone, which was right when every
  // row belonged to one place. Rolling a trail's sections in broke that both ways: a
  // section visit vanished because the trail had an activity that day (59 rows instead
  // of 62), and the same day appeared twice from two different places.
  const dayKey = (placeId: string | null | undefined, day: string) =>
    `${placeId ?? place.id}|${day}`;
  const actDays = new Set(ownActs.map((a) => dayKey(a.place_id, activityDay(a))));
  // Visit rows an activity doesn't already cover: multi-day trips, and single
  // days with photos/entries but no run. A TRAIL used to be excluded here, which
  // hid the 32 days Erica logged on the Appalachian Trail itself — a trail is a
  // place you went, and the days you went are its dates.
  const visitRows = (visits ?? [])
    .filter(
      (v) => v.is_trip || nestedActs.has(v.id) || !actDays.has(dayKey(v.place_id, v.start_date)),
    )
    .map((v) => ({
      key: v.id,
      trip: v.is_trip,
      // No "· Trip": Erica asked for the word out of the Visits section entirely.
      // A multi-day visit still COUNTS as a trip in the stats bar (§2); it is just
      // never labelled. Dates in the locked format: "May 2", or "5/4 - 5/7".
      date: visitDates(v.start_date, v.end_date),
      // The SEGMENT NAME, when this visit was logged on a section of the trail
      // rather than the trail row. This is what replaced the Sections list.
      seg:
        v.place_id !== place.id ? (allPlaces.find((p) => p.id === v.place_id)?.name ?? null) : null,
      sub:
        [
          v.note ?? '',
          visitStats[v.id]?.photos ? `${visitStats[v.id].photos} photos` : '',
          visitStats[v.id]?.videos ? `${visitStats[v.id].videos} videos` : '',
        ]
          .filter(Boolean)
          .join(' · ') || null,
      to: `/place/${v.place_id}/day/${v.start_date}`,
      del: v.id as string | null,
      start: v.start_date as string,
      end: v.end_date as string,
      sort: v.start_date,
      solo: v.solo_profile as string | null,
      target: { type: 'visit' as const, id: v.id },
    }));
  // ONE ROW PER OUTING. Rolling a trail's sections in showed that 27 of the
  // Appalachian Trail's days exist TWICE — once on the trail and once on the section
  // walked that day (78 such pairs app-wide). They are one outing recorded in two
  // places, so the card would otherwise print "December 25" twice, one of them
  // blank. Where a day is covered by a SECTION row, the trail's own row for that day
  // is not drawn: the section row says everything the trail row said, plus which
  // section it was.
  //
  // NOTHING IS DELETED. Both records still exist and both still open; this only
  // decides what the card draws. The underlying double-recording is real and is
  // written up in STATE.md for Erica to decide on.
  const allRows = [...actRows, ...visitRows].sort((a, b) => b.sort.localeCompare(a.sort));
  const daysNamedBySection = new Set(allRows.filter((r) => r.seg).map((r) => r.sort));
  const visitListRows = allRows.filter((r) => r.seg || !daysNamedBySection.has(r.sort));
  const visitCount = visitListRows.length;

  // The sub-line under the address, in the words the locked card uses:
  // "Visited twice · 12 photos". A count with no noun ("· 1 visit") was the old
  // shape; Erica: "When a SECOND Visit is added to the same destination, the visit
  // becomes a Place you've visited twice."
  const photoTotal = Object.values(visitStats).reduce((n, v) => n + (v.photos ?? 0), 0);
  const visitedLine = [
    visitCount === 1
      ? 'Visited once'
      : visitCount === 2
        ? 'Visited twice'
        : `Visited ${visitCount} times`,
    photoTotal > 0 ? `${photoTotal} photo${photoTotal === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  // "Edit address" → a search pill that sets the address/pin (not the title).
  const addressSearch = (
    <div className="place-locate bucket-search">
      <MapSearch onPick={setAddressFromSearch} placeholder="Search an address or place…" />
    </div>
  );

  return (
    <aside className="panel">
      {hasHero ? (
        <div className="panel-hero" style={{ ['--pos' as string]: `${coverPos}%` }}>
          <AuthedImg
            photoId={place.cover_photo_id!}
            size="full"
            className={`panel-hero-img${canEdit ? ' adjustable' : ''}`}
            onClick={canEdit ? () => setAdjustCover((v) => !v) : undefined}
          />
          <button className="close hero-close" onClick={onClose} aria-label="Close">
            ×
          </button>
          {/* THE NAME, THEN THE RATING UNDER IT — the locked card, bottom-left of
              the photo. The stars used to sit above the name. */}
          <div className="hero-title">
            <h2 className="title-with-rating">{titleEl}</h2>
            <div className="hero-rating">{ratingEl}</div>
          </div>
          {/* Framing slider overlaid on the bottom of the photo when you tap it. */}
          {canEdit && adjustCover && (
            <input
              className="cover-pos-slider"
              type="range"
              min={0}
              max={100}
              value={coverPos}
              onChange={(e) => setCoverPos(Number(e.target.value))}
              onPointerUp={() => void patch({ cover_pos_y: coverPos })}
              onKeyUp={() => void patch({ cover_pos_y: coverPos })}
            />
          )}
        </div>
      ) : (
        <div className="panel-head">
          <div>
            <h2 className="title-with-rating">{titleEl}</h2>
            <div className="rating-above">{ratingEl}</div>
          </div>
          <div className="head-actions">
            <button className="close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>
      )}

      {/* Address line — the full address (tap for Directions) with an "edit" that
          opens a search. Independent of the Title. */}
      <div className={`meta ${place.is_trail ? 'meta-trail' : ''}`}>
        {editingAddress && canEdit ? (
          addressSearch
        ) : (
          <span>
            <a
              className="region-directions"
              href={dirHref}
              target="_blank"
              rel="noreferrer"
              title={`Directions to ${dirDest}`}
            >
              {place.address || regionText}
            </a>
            {canEdit && (
              <button className="link-btn region-edit-btn" onClick={() => setEditingAddress(true)}>
                edit
              </button>
            )}
            {visits && visitCount > 0 && ` · ${visitedLine}`}
            {place.bucket && <span className="bucket-flag"> · Bucket List</span>}
          </span>
        )}
        {place.park && <div className="park-badge">In {place.park}</div>}
        {place.is_trail && trailMilesSummary(trailMiles) && (
          <span className="trail-miles">
            {trailMilesSummary(trailMiles)}
            {(() => {
              const gainM = (trailActs ?? []).reduce((s, a) => s + (a.elevation_gain ?? 0), 0);
              return gainM > 0
                ? ` · ${Math.round(gainM * 3.28084).toLocaleString()} ft climbed`
                : '';
            })()}
          </span>
        )}
      </div>

      {/* Empty trail → let the user draw its route right on the map. */}
      {place.is_trail && canEdit && onAddRoute && (trailActs?.length ?? 0) === 0 && (
        <button className="primary add-route-btn" onClick={() => onAddRoute(place.id, place.name)}>
          + Add a route on the map
        </button>
      )}

      {!place.is_home && <WeatherLine lat={place.lat} lng={place.lng} />}

      {/* WHAT IS IT? — the only place a place's type is set. Tap a pill to toggle
          it. City and Region fetch the OSM boundary as you tap them, and Trail
          switches the card to the trail layout, so there is no second "make this
          a city / region / trail" row. TRIP is not offered at all: a trip is a
          visit you marked, in the Visits list (docs/SCHEMA.md). */}
      {canEdit && (
        <div className="cat-edit">
          <div className="cat-picker">
            {/* No City or Region pills — Erica does not want them on any card.
                A trip is a visit you marked, so 'trip' was never offered either. */}
            {CATEGORIES.filter(
              (c) => c.slug !== 'trip' && c.slug !== 'city' && c.slug !== 'region',
            ).map((c) => {
              const on =
                c.slug === 'trail'
                  ? place.is_trail
                  : c.slug === 'city' || c.slug === 'region'
                    ? place.category === c.slug
                    : (place.categories ?? []).includes(c.slug);
              return (
                <button
                  key={c.slug}
                  className={`cat-toggle ${on ? 'on' : ''}`}
                  disabled={cityBusy && (c.slug === 'city' || c.slug === 'region')}
                  onClick={() => void toggleCat(c.slug)}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          {cityBusy && <div className="label">Fetching the boundary…</div>}
          {cityMsg && <div className="city-region-msg">{cityMsg}</div>}
        </div>
      )}

      {/* The separate "Make this a City / Region" row is gone — the City and
          Region tags above do it. One question, one control. */}

      {(place.website || (canEdit && place.bucket)) && (
        <div className="card-actions">
          {place.website && (
            <a
              className="website-btn"
              href={normalizeUrl(place.website)}
              target="_blank"
              rel="noreferrer"
            >
              Website
            </a>
          )}
          {canEdit && place.bucket && (
            <button
              className="primary add-to-map-btn"
              onClick={() => void patch({ bucket: false, saved: true })}
            >
              Add to map
            </button>
          )}
        </div>
      )}

      {error && <div className="banner">{error}</div>}

      {/* Read-only tag chips for viewers (editors see the highlighted picker). */}
      {!canEdit && effectiveCategories(place).length > 0 && (
        <div className="cats">
          {effectiveCategories(place).map((slug) => (
            <span
              key={slug}
              className="cat-chip"
              title={`Show all ${categoryLabel(slug)} on the map`}
            >
              <Link className="cat-chip-link" to={`/?cat=${slug}`}>
                {categoryIcon(slug)} {categoryLabel(slug)}
              </Link>
            </span>
          ))}
        </div>
      )}

      {/* Overall review (rating lives next to the title; tags are above). */}
      {canEdit ? (
        <div>
          <textarea
            placeholder="Add a review of this place…"
            value={review}
            onChange={(e) => setReview(e.target.value)}
            style={{ minHeight: 60, marginTop: 10 }}
          />
          {review !== (place.review ?? '') && (
            <div className="btn-row" style={{ marginTop: 6 }}>
              <button
                className="primary"
                onClick={() => void patch({ review: review.trim() || null })}
              >
                Save review
              </button>
              <button onClick={() => setReview(place.review ?? '')}>Cancel</button>
            </div>
          )}
        </div>
      ) : (
        place.review && <p className="body">{place.review}</p>
      )}

      {/* Winery → favorite wines, brewery → favorite beer. A small blue link opens
          an editable list (stored newline-separated in `favorite`). */}
      {(() => {
        const cats = effectiveCategories(place);
        const isWine = cats.includes('winery');
        const isBeer = cats.includes('brewery');
        if (!isWine && !isBeer) return null;
        const noun = isWine ? 'wines' : 'beer';
        const one = isWine ? 'wine' : 'beer';
        const heading = isWine ? 'Favorite wines' : 'Favorite beer';
        const items = (place.favorite ?? '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        const saveItems = (next: string[]) => patch({ favorite: next.join('\n') || null });

        if (!canEdit) {
          return items.length ? (
            <div style={{ marginTop: 12 }}>
              <label className="fav-label">{heading}</label>
              <ul className="fav-list">
                {items.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            </div>
          ) : null;
        }

        return (
          <div style={{ marginTop: 12 }}>
            {items.length > 0 && (
              <>
                <label className="fav-label">{heading}</label>
                <ul className="fav-list">
                  {items.map((it, i) => (
                    <li key={i}>
                      <span>{it}</span>
                      <button
                        className="fav-del"
                        title="Remove"
                        onClick={() => void saveItems(items.filter((_, j) => j !== i))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {favOpen ? (
              <div className="field-row" style={{ marginTop: 4 }}>
                <input
                  autoFocus
                  value={favInput}
                  placeholder={`Add a ${one}…`}
                  onChange={(e) => setFavInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && favInput.trim()) {
                      void saveItems([...items, favInput.trim()]);
                      setFavInput('');
                    }
                  }}
                />
                <button
                  className="primary"
                  style={{ flex: 'none' }}
                  disabled={!favInput.trim()}
                  onClick={() => {
                    void saveItems([...items, favInput.trim()]);
                    setFavInput('');
                  }}
                >
                  Add
                </button>
                <button
                  style={{ flex: 'none' }}
                  onClick={() => {
                    setFavOpen(false);
                    setFavInput('');
                  }}
                >
                  Done
                </button>
              </div>
            ) : (
              <button className="add-newPlace-link" onClick={() => setFavOpen(true)}>
                + {items.length ? `Add another ${one}` : `Add your favorite ${noun}`}
              </button>
            )}
          </div>
        );
      })()}

      {/* Visits — uniform for places AND trails. Collapsed into a dropdown to
          save space; click "Visits (N)" → the dates. Trails list their logged
          activity days here in the same style as places. */}
      {(() => {
        // The rows are built once, above, so this list and the header count can
        // never disagree. Visits = actual times we went to THIS place.
        const rows = visitListRows;
        const isTrail = place.is_trail;
        const loading = visits === null || trailActs === null;
        // ONE visit row, so the year groups below cannot drift from each other.
        const renderVisitRow = (r: (typeof rows)[number]) => {
          // A visit row IS the control. Tapping it opens the one editor for
          // that visit — dates, who, trip, delete, and the places visited
          // inside it. There is no separate "Dates" pill: a pill that opens
          // a second row for one field is the thing that made this confusing.
          const open = editingVisit === r.key;
          const contents = r.trip ? (tripContents[r.key] ?? []) : [];
          const isVisit = !!r.del;
          const inside = nestedActs.get(r.key) ?? [];
          return (
            <div key={r.key} className={open ? 'visit-item open' : 'visit-item'}>
              <div className="visit-row">
                {isVisit ? (
                  <button
                    type="button"
                    className="visit-main visit-open"
                    aria-expanded={open}
                    onClick={() => {
                      setEditingVisit(open ? null : r.key);
                      setEvStart(r.start || '');
                      setEvEnd(r.end || r.start || '');
                    }}
                  >
                    <span className="visit-date">{r.date}</span>
                    {/* THE SEGMENT NAME, when this row was logged on a section of the
                        trail. It is what replaced the Sections list. */}
                    {r.seg && <span className="visit-seg">{r.seg}</span>}
                    {/* One muted summary, not a stack of chips. */}
                    {(() => {
                      const meta = [
                        r.sub,
                        contents.length > 0
                          ? `${contents.length} ${contents.length === 1 ? 'place' : 'places'}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      return meta ? <span className="visit-meta">{meta}</span> : null;
                    })()}
                  </button>
                ) : (
                  <Link className="visit-main" to={r.to}>
                    <span className="visit-date">{r.date}</span>
                    {r.seg && <span className="visit-seg">{r.seg}</span>}
                    {r.sub && <span className="muted">{r.sub}</span>}
                  </Link>
                )}
                {isVisit && (
                  <Link
                    className="visit-open-link"
                    to={`/visit/${r.key}`}
                    onClick={(e) => e.stopPropagation()}
                    title="Open this visit"
                  >
                    Open
                  </Link>
                )}
                {/* AN ACTIVITY IS EDITED INSIDE ITS VISIT, not here. Erica: "once
                    there was more than one visit to a place the activities should
                    only be editable in each visit which is the dates." So a visit
                    row keeps its control and an activity row does not — you open
                    the visit, which is where that outing lives. */}
                {canEdit && people.length >= 2 && r.target.type === 'visit' && (
                  <select
                    className="attribution-select visit-who"
                    value={r.solo ?? ''}
                    title="Who was here"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => void setRowSolo(r.target, e.target.value || null)}
                  >
                    {/* Not "Together" — Erica asked for that word out of the
                                  Visits section entirely; it now means tagging someone
                                  in a flok. This control only says who was here, and
                                  "Both" is the word the app already uses for it. */}
                    <option value="">{people.length > 2 ? 'Everyone' : 'Both'}</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id === profile?.id ? 'Just me' : `Just ${p.display_name}`}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* The places we visited during this visit to the bigger
                            place. They are places in their own right — not stops,
                            not notes — and they belong inside this visit. */}
              {contents.length > 0 && (
                <ul className="trip-contents">
                  {contents.map((c) => (
                    <li key={c.visit_id}>
                      <Link to={`/place/${c.place_id}`}>{c.place_name}</Link>
                      <span className="muted">{visitDates(c.start_date, c.end_date)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* What we did during this stay. These are evidence, not
                            separate visits — the ride and the run at Brewster
                            happened on ONE 2-day visit. */}
              {inside.length > 0 && (
                <ul className="trip-contents visit-evidence">
                  {inside.map((a) => (
                    <li key={a.id}>
                      <Link to={`/place/${place.id}/day/${activityDay(a)}`}>
                        {a.name || a.type}
                      </Link>
                      <span className="muted">
                        {[a.type, miStr(a.distance), visitDates(activityDay(a))]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {canEdit && open && isVisit && (
                <div className="visit-editor">
                  {/* Dates save on change — a Save button for two fields is
                                one control too many. */}
                  <div className="ve-dates">
                    <input
                      type="date"
                      value={evStart}
                      aria-label="Visit start date"
                      onChange={(e) => {
                        setEvStart(e.target.value);
                        void saveVisitDates(r.del!, e.target.value, evEnd);
                      }}
                    />
                    <span className="ve-to">to</span>
                    <input
                      type="date"
                      value={evEnd}
                      aria-label="Visit end date"
                      onChange={(e) => {
                        setEvEnd(e.target.value);
                        void saveVisitDates(r.del!, evStart, e.target.value);
                      }}
                    />
                  </div>
                  <div className="ve-actions">
                    <button
                      className={r.trip ? 've-btn on' : 've-btn'}
                      aria-pressed={r.trip}
                      onClick={() => void toggleVisitIsTrip(r.del!, !r.trip)}
                    >
                      Trip
                    </button>
                    <button className="ve-btn ve-danger" onClick={() => void removeVisit(r.del!)}>
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        };
        return (
          <>
            <details className="visits-details">
              <summary className="visits-summary">
                Visits{rows.length > 0 ? ` (${rows.length})` : ''}
              </summary>
              {loading ? (
                <p style={{ color: 'var(--muted)' }}>Loading…</p>
              ) : rows.length === 0 ? (
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                  {isTrail ? 'Nothing logged here yet.' : 'No visits logged yet.'}
                </p>
              ) : (
                <div className="visits">
                  {/* YEARS DROP DOWN TO LISTS (Erica, 2026-08-11) — newest first, only
                      years that have visits, the newest one already open. Sixty-two
                      visits on the Appalachian Trail is what makes this necessary. */}
                  {(() => {
                    const years = byYear(rows.map((r) => ({ ...r, start_date: r.sort })));
                    const newest = years[0]?.year;
                    return years.map(({ year, rows: yearRows }) => (
                      <details key={year} className="visit-year" open={year === newest}>
                        <summary className="visit-year-head">
                          <span className="visit-year-n">{year}</span>
                          <span className="label">
                            {yearRows.length} {yearRows.length === 1 ? 'visit' : 'visits'}
                          </span>
                        </summary>
                        {yearRows.map((r) => renderVisitRow(r))}
                      </details>
                    ));
                  })()}
                </div>
              )}
            </details>

            {canEdit && !addingVisit && (
              <button
                className="primary log-visit-btn"
                onClick={() => {
                  setAddingVisit(true);
                  setVStart(new Date().toISOString().slice(0, 10));
                }}
              >
                {visitCount > 0 ? 'Log another visit' : 'Log a visit'}
              </button>
            )}

            {canEdit && addingVisit && (
              <div className="entry" style={{ marginTop: 8 }}>
                <label>Date{vMulti ? ' — from' : ''}</label>
                <input type="date" value={vStart} onChange={(e) => setVStart(e.target.value)} />
                {vMulti && (
                  <>
                    <label>to</label>
                    <input type="date" value={vEnd} onChange={(e) => setVEnd(e.target.value)} />
                  </>
                )}
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={vMulti}
                    onChange={(e) => setVMulti(e.target.checked)}
                    style={{ width: 'auto' }}
                  />
                  Multiple days
                </label>
                {people.length >= 2 && (
                  <>
                    <label>Who was there</label>
                    <select
                      className="attribution-select"
                      value={vWho}
                      onChange={(e) => setVWho(e.target.value)}
                    >
                      <option value="">Both of us</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id === profile?.id ? 'Just me' : `Just ${p.display_name}`}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <div className="btn-row">
                  <button className="primary" disabled={!vStart} onClick={() => void submitVisit()}>
                    Save visit
                  </button>
                  <button
                    onClick={() => {
                      setAddingVisit(false);
                      setVWho('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* There is no "Trips to this place" section any more. A trip is a VISIT you
          marked, so it belongs in the Visits list above with the places you went to
          during it nested inside it — not in a second list beside it. This section
          read from the retired `trips` table and was the last thing showing trips and
          visits as two different kinds of thing on one card. */}

      <h3 style={{ marginTop: 22 }}>Photos and Videos</h3>
      <PhotoGallery place={place} visits={visits ?? undefined} onUploaded={refreshPlace} />

      {/* ROUTES — third, per the locked card. The map shows EVERY route from every
          visit; the list under it is every one of them by name. Hikes, biking,
          walking and running all live here — there is no Activities section and
          there are no activity pills. */}
      {(trailActs ?? []).length > 0 && (
        <>
          <h3 style={{ marginTop: 22 }}>
            Routes <span className="label">({(trailActs ?? []).length})</span>
          </h3>
          <RouteMiniMap place={place} />
          <div className="route-rows">
            {(trailActs ?? []).map((a) => (
              <Link
                key={a.id}
                className="route-row"
                to={a.local_date ? `/place/${place.id}/day/${a.local_date}` : `/place/${place.id}`}
              >
                <span className="route-row-name">{a.name || a.type}</span>
                <span className="label">
                  {a.type}
                  {a.distance ? ` · ${(a.distance / 1609.344).toFixed(1)} mi` : ''}
                  {a.local_date ? ` · ${visitDates(a.local_date)}` : ''}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* THE SECTIONS LIST IS GONE (Erica, approved preview 2026-08-11): "Remove the
          segments and have the visit dates like all the other cards… When a visit is
          added, user can add the segment name." A section's visits now appear in the
          Visits section above, each carrying its segment name, so a trail card reads
          exactly like every other card — which is the whole point of one template.
          The trail's map of its walked sections moved with it; the Routes section
          above already draws every route on the trail. Restore: commit before this. */}

      {/* THE CATEGORY SECTIONS — Restaurants, Beaches, Wineries. Each is its own
          section with its own heading, plural, exactly like the locked card. They
          used to be folds INSIDE Notes and Reviews, which is why Wonderland read as
          a note rather than a restaurant. */}
      {categorySections.map((g) => (
        <div key={g.key}>
          <h3 style={{ marginTop: 22 }}>
            {pluralLabel(g.label)}{' '}
            <span className="label">({g.places.length + g.entries.length})</span>
          </h3>
          <div className="newPlace-groups">{renderGroupRows(g)}</div>
        </div>
      ))}

      {/* NOTES AND REVIEWS — last, and holding only notes and reviews. No blue "+"
          link in the heading; the fillable box sits at the BOTTOM of the section. */}
      <div className="visits-head">
        <h3 style={{ marginTop: 22 }}>NOTES AND REVIEWS</h3>
      </div>

      {canEdit && addingMembers && (
        <div className="entry">
          <label>Add places you've already saved to this one</label>
          <input
            className="member-search"
            placeholder="Search your places…"
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
          />
          <div className="member-list">
            {allPlaces
              .filter(
                (p) =>
                  p.id !== place.id &&
                  !p.bucket &&
                  !(p.part_of ?? []).includes(place.id) &&
                  (memberSearch.trim() === '' ||
                    p.name.toLowerCase().includes(memberSearch.trim().toLowerCase())),
              )
              .sort((a, b) => a.name.localeCompare(b.name))
              .slice(0, 40)
              .map((p) => {
                const on = selectedMembers.has(p.id);
                return (
                  <label key={p.id} className="member-opt">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setSelectedMembers((prev) => {
                          const next = new Set(prev);
                          if (on) next.delete(p.id);
                          else next.add(p.id);
                          return next;
                        })
                      }
                    />
                    <span>
                      {p.name}
                      {p.admin1 ? <span className="label"> · {p.admin1}</span> : null}
                    </span>
                  </label>
                );
              })}
          </div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button
              className="save-btn-green"
              disabled={selectedMembers.size === 0}
              onClick={() => void addMembers()}
            >
              Add {selectedMembers.size || ''} {selectedMembers.size === 1 ? 'place' : 'places'}
            </button>
            <button
              onClick={() => {
                setAddingMembers(false);
                setSelectedMembers(new Set());
                setMemberSearch('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {noteGroups.length > 0 ? (
        <div className="newPlace-groups">
          {noteGroups.map((g) => (
            <div key={g.key}>{renderGroupRows(g)}</div>
          ))}
        </div>
      ) : (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Nothing written here yet.</p>
      )}

      {/* The fillable box, at the bottom of the section it belongs to. */}
      {canEdit && (
        <EntryEditor
          placeId={place.id}
          defaultDate={place.last_visit ?? new Date().toISOString().slice(0, 10)}
          onSave={addNote}
          onCancel={() => undefined}
        />
      )}

      {/* Attribution ("who was here") is NOT a place-level property — a place can
          be visited solo one time and together another. It lives ONLY on each
          visit row (the Me/Both/Josh chip in the Visits list above). No toggle here. */}

      {canEdit && (
        <div className="btn-row bottom-actions" style={{ marginTop: 22 }}>
          <button onClick={() => setMerging((v) => !v)}>Add to a trail</button>
          <button className="danger" onClick={() => void removePlace()}>
            Delete
          </button>
          {!place.bucket &&
            (place.saved ? (
              <span className="saved-note">Saved</span>
            ) : (
              <button className="save-btn-green" onClick={() => void patch({ saved: true })}>
                Save
              </button>
            ))}
        </div>
      )}
      {merging && (
        <div className="entry">
          {(place.part_of ?? []).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {(place.part_of ?? []).map((id) => {
                const par = allPlaces.find((p) => p.id === id);
                if (!par) return null;
                return (
                  <span key={id} className="cat-chip">
                    {par.name}
                    <button
                      className="cat-chip-x"
                      title={`Remove from ${par.name}`}
                      onClick={() => void togglePartOf(id)}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <select
            className="kind-select"
            value=""
            onChange={(e) => e.target.value && void togglePartOf(e.target.value)}
          >
            <option value="">Select…</option>
            {allPlaces
              // TRAILS ONLY. This used to list every place not already inside
              // something — ~115 options — and offered "trip" containers that no
              // longer exist (a trip is a visit you marked, migration 0133).
              // Cities and regions attach SPATIALLY by boundary, so picking one by
              // hand was never how containment worked.
              .filter(
                (p) => p.is_trail && p.id !== place.id && !(place.part_of ?? []).includes(p.id),
              )
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.admin1 ? ` — ${p.admin1}` : ''}
                </option>
              ))}
          </select>
        </div>
      )}
    </aside>
  );
}
