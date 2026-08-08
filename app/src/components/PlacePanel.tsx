import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addExperience,
  clearCity,
  createEntry,
  createPlaceAtomic,
  deletePlace,
  deleteVisit,
  restoreVisit,
  fetchCityBoundary,
  fetchEntries,
  fetchMapPeople,
  fetchPlace,
  fetchPlaceRatings,
  fetchPlaceVisitStats,
  fetchSpatialMembers,
  fetchVisits,
  newExperienceKey,
  setCityBoundary,
  setMyRating,
  setPlaceName,
  canRenamePlace,
  setVisitIsTrip,
  fetchTripContents,
  type TripContent,
  setVisitDates,
  setVisitSolo,
  updatePlace,
  type MapPerson,
} from '../lib/data';
import type { Activity, Entry, NewEntry, Place, Visit } from '../lib/types';
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
import TrailSectionsMap from './TrailSectionsMap';
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
  visitCounts?: Map<string, number>;
}

/** Prepend https:// when the user typed a bare domain, so the link works. */
function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Apple Maps directions link for a spot's OWN address/coords, or null if it has
 *  neither (then it just shows as a plain entry with no Directions button). */
function spotDirHref(e: Entry): string | null {
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

/** ISO timestamp → "Mar 7, 2026". */
function fmtRunDate(iso: string | null): string {
  if (!iso) return 'Undated';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** A visit as one line: single day, or a compact date range. */
function fmtVisit(v: Visit): string {
  const s = new Date(v.start_date + 'T00:00:00');
  const e = new Date(v.end_date + 'T00:00:00');
  const full: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  if (v.start_date === v.end_date) return s.toLocaleDateString(undefined, full);
  const sameYear = s.getFullYear() === e.getFullYear();
  const startOpt: Intl.DateTimeFormatOptions = sameYear ? { month: 'short', day: 'numeric' } : full;
  return `${s.toLocaleDateString(undefined, startOpt)} – ${e.toLocaleDateString(undefined, full)}`;
}

export default function PlacePanel({
  place,
  allPlaces,
  onClose,
  onPlaceChanged,
  onPlaceDeleted,
  onAddRoute,
  visitCounts,
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
  const [spots, setSpots] = useState<Entry[] | null>(null);
  const [addingSpot, setAddingSpot] = useState(false);
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
  const [spatialCount, setSpatialCount] = useState<number | null>(null);
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

  async function reloadVisits() {
    const rows = await fetchVisits(place.id).catch(() => []);
    setVisits(rows);
    setVisitStats(await fetchPlaceVisitStats(place.id).catch(() => ({})));
    const trips = rows.filter((v) => v.is_trip);
    const pairs = await Promise.all(
      trips.map(async (v) => [v.id, await fetchTripContents(v.id).catch(() => [])] as const),
    );
    setTripContents(Object.fromEntries(pairs));
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

  async function reloadSpots() {
    setSpots(await fetchEntries(place.id).catch(() => []));
  }
  // Add a spot/review straight from the main card; its category tags the place
  // and it shows under that category's review section here + on its day.
  // Unified model: a spot is a CHILD PLACE (its own marker, card, count) rather
  // than a separate entry. Plain "notes" stay as entries (they aren't places).
  async function addSpot(draft: NewEntry) {
    if (draft.kind === 'note') {
      await createEntry({ ...draft, place_id: place.id });
    } else {
      // ONE atomic write (migration 0122). This used to be three separate
      // requests — createPlace, then updatePlace for rating/review, then
      // addVisit — so a failure after the first left a half-built spot with no
      // review and no visit, and a retry created a second place.
      const spot = await createPlaceAtomic(
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
      onPlaceChanged(spot); // add the new place to the map
    }
    setAddingSpot(false);
    await reloadSpots();
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

  // How many leaf places fall inside this container's boundary (city/region).
  useEffect(() => {
    let active = true;
    setSpatialCount(null);
    if (place.category === 'city' || place.category === 'region') {
      fetchSpatialMembers(place.id)
        .then((ids) => active && setSpatialCount(ids.length))
        .catch(() => active && setSpatialCount(null));
    }
    return () => {
      active = false;
    };
  }, [place.id, place.category]);

  useEffect(() => {
    let active = true;
    setVisits(null);
    setSpots(null);
    fetchVisits(place.id)
      .then((rows) => active && setVisits(rows))
      .catch(() => active && setVisits([]));
    fetchPlaceVisitStats(place.id)
      .then((s) => active && setVisitStats(s))
      .catch(() => active && setVisitStats({}));
    fetchEntries(place.id)
      .then((rows) => active && setSpots(rows))
      .catch(() => active && setSpots([]));
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
  // everything else groups them by category alongside its entry-spots.
  const memberPlaces = allPlaces
    .filter((p) => (p.part_of ?? []).includes(place.id))
    .sort((a, b) => (a.first_visit ?? '').localeCompare(b.first_visit ?? ''));

  // Trail card: its member places ARE its sections. Split into done (visited) and
  // not-yet so a long trail's progress lives in one place. Done first, most-recent
  // first; not-yet alphabetical.
  //
  // "Done" means done IN THE CURRENT VIEW. places.visit_count is global, so a
  // section only Josh has walked read as done in Erica's "Just me" — the same
  // mistake the map badge made before it moved to place_visit_counts. When the
  // per-view counts haven't loaded (or a card is opened outside the map) it falls
  // back to the global count rather than showing an empty trail.
  const sectionDone = (p: Place): boolean =>
    visitCounts ? (visitCounts.get(p.id) ?? 0) > 0 : p.visit_count > 0 || Boolean(p.first_visit);
  const trailSections = place.is_trail
    ? {
        done: memberPlaces
          .filter(sectionDone)
          .sort((a, b) => (b.last_visit ?? '').localeCompare(a.last_visit ?? '')),
        todo: memberPlaces
          .filter((p) => !sectionDone(p))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }
    : null;

  // SPOTS AND REVIEWS — ONE dropdown per category, holding BOTH member places
  // ("part of" this one) and entry-spots of that category. So "dining" shows a
  // single "Restaurant Reviews" section listing every reviewed restaurant,
  // whether it's a linked place or an inline spot. In CATEGORIES order. This is
  // the Appalachian-Trail grouping, now used for EVERY card (trips included) so a
  // hotel reads as "Hotel Reviews", not under the trip's city name.
  //
  // A TRAIL is the exception: its member places are its SECTIONS and are listed
  // once, in the Sections list below. They used to appear there AND here, split
  // across "Hiking", "Trail" and "Places" by whatever tag happened to be first —
  // so one Appalachian Trail segment showed up twice under two different headings.
  const reviewGroups: { key: string; label: string; places: Place[]; entries: Entry[] }[] = [];
  {
    const groupedMembers = place.is_trail ? [] : memberPlaces;
    const placeByKind = new Map<string, Place[]>();
    for (const m of groupedMembers) {
      const k = (m.categories && m.categories[0]) || 'place';
      if (!placeByKind.has(k)) placeByKind.set(k, []);
      placeByKind.get(k)!.push(m);
    }
    const entryByKind = new Map<string, Entry[]>();
    for (const e of spots ?? []) {
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

  async function removeVisit(id: string) {
    // Soft UX: remove immediately, offer Undo that restores the FULL original visit
    // (date, note, attribution, override, trip flag) — friendlier than a browser
    // confirm, esp. on mobile.
    const v = (visits ?? []).find((x) => x.id === id);
    try {
      await deleteVisit(id);
      await reloadVisits();
      showSnack({
        message: 'Visit removed.',
        actionLabel: 'Undo',
        onAction: async () => {
          if (!v) return;
          try {
            await restoreVisit(v);
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
      return 'Trail or spot name';
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

  // One visit count, shared by the header line AND the "Visits (N)" dropdown so
  // they always agree. A visit = each activity row + any photo/entry-only visit
  // day an activity doesn't already cover. Notes are entries, NOT visits, so they
  // never count here. (Mirrors the row build inside the Visits section below.)
  const _isTrailCard = place.is_trail;
  const _isRollupCard = !!place.holds_children && !_isTrailCard;
  const _actsForCount = trailActs ?? [];
  const _actDaysForCount = new Set(_actsForCount.map((a) => (a.start_date ?? '').slice(0, 10)));
  const visitCount = _isTrailCard
    ? _actsForCount.length
    : (_isRollupCard ? 0 : _actsForCount.length) +
      (visits ?? []).filter(
        (v) => _isRollupCard || v.is_trip || !_actDaysForCount.has(v.start_date),
      ).length;

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
          {/* Stars above the title, bottom-left of the photo. */}
          <div className="hero-title">
            <div className="hero-rating">{ratingEl}</div>
            <h2 className="title-with-rating">{titleEl}</h2>
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
            <div className="rating-above">{ratingEl}</div>
            <h2 className="title-with-rating">{titleEl}</h2>
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
            {visits && visitCount > 0 && ` · ${visitCount} visit${visitCount > 1 ? 's' : ''}`}
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
            {CATEGORIES.filter((c) => c.slug !== 'trip').map((c) => {
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
          {spatialCount != null && (place.category === 'city' || place.category === 'region') && (
            <div className="label">
              {spatialCount} place{spatialCount === 1 ? '' : 's'} inside
            </div>
          )}
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
              <button className="add-spot-link" onClick={() => setFavOpen(true)}>
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
        const isTrail = place.is_trail;
        // A trip/city/region rollup shows its FUSED visit(s) — one trip is ONE
        // visit (e.g. "San Diego · Jul 11–16 · Trip"), never a row per activity.
        // Only LEAF places break out each activity as its own dated row.
        const isRollup = place.holds_children && !isTrail;
        // Visits = actual times we went to THIS place. On a leaf, every Strava/
        // Garmin activity gets its own row (date · name · type · miles); photo/
        // entry-only days and multi-day trips show as dated visit rows.
        const acts = trailActs ?? [];

        // A visit is the occasion; the ride and the run are what we DID during it,
        // so they hang off it (docs/SCHEMA.md) rather than sitting beside it.
        // Brewster is one fused 2-day stay containing a ride and a run — it read as
        // three visits because all three were siblings. Only stays that span more
        // than a day, or that were marked as a trip, adopt their activities; a
        // single-day run is already one flat row and gains nothing from nesting.
        const nestedActs = new Map<string, Activity[]>();
        const nestedIds = new Set<string>();
        if (!isTrail && !isRollup) {
          for (const v of visits ?? []) {
            const end = v.end_date || v.start_date;
            if (!v.is_trip && end <= v.start_date) continue;
            const mine = acts.filter((a) => {
              const d = (a.start_date ?? '').slice(0, 10);
              return d !== '' && d >= v.start_date && d <= end;
            });
            if (mine.length === 0) continue;
            nestedActs.set(v.id, mine);
            for (const a of mine) nestedIds.add(a.id);
          }
        }

        const actRows = isRollup
          ? []
          : acts
              .filter((a) => !nestedIds.has(a.id))
              .map((a) => ({
                key: a.id,
                date: fmtRunDate(a.start_date),
                sub: [a.name, a.type, miStr(a.distance)].filter(Boolean).join(' · '),
                to: `/place/${place.id}/day/${(a.start_date ?? '').slice(0, 10)}`,
                del: null as string | null,
                start: '' as string,
                end: '' as string,
                sort: (a.start_date ?? '').slice(0, 10),
                solo: a.solo_profile as string | null,
                trip: false,
                target: { type: 'activity' as const, id: a.id },
              }));
        const actDays = new Set(acts.map((a) => (a.start_date ?? '').slice(0, 10)));
        // Non-trail places also surface visit rows an activity doesn't already
        // cover: multi-day trips, and single days with photos/entries but no run.
        const visitRows = isTrail
          ? []
          : (visits ?? [])
              // Rollups show all their (fused) visits; leaves show trips, any stay
              // that adopted activities, and any photo/entry day an activity row
              // doesn't already cover.
              .filter(
                (v) => isRollup || v.is_trip || nestedActs.has(v.id) || !actDays.has(v.start_date),
              )
              .map((v) => ({
                key: v.id,
                trip: v.is_trip,
                date: v.is_trip ? `${fmtVisit(v)} · Trip` : fmtVisit(v),
                sub:
                  [
                    v.note ?? '',
                    visitStats[v.id]?.photos ? `${visitStats[v.id].photos} photos` : '',
                    visitStats[v.id]?.videos ? `${visitStats[v.id].videos} videos` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ') || null,
                to: `/place/${place.id}/day/${v.start_date}`,
                del: v.id as string | null,
                start: v.start_date as string,
                end: v.end_date as string,
                sort: v.start_date,
                solo: v.solo_profile as string | null,
                target: { type: 'visit' as const, id: v.id },
              }));
        const rows = [...actRows, ...visitRows].sort((a, b) => b.sort.localeCompare(a.sort));
        const loading = isTrail ? trailActs === null : visits === null || trailActs === null;
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
                  {rows.map((r) => {
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
                              {r.sub && <span className="muted">{r.sub}</span>}
                            </Link>
                          )}
                          {canEdit && people.length >= 2 && (
                            <select
                              className="attribution-select visit-who"
                              value={r.solo ?? ''}
                              title="Who was here"
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => void setRowSolo(r.target, e.target.value || null)}
                            >
                              <option value="">Both</option>
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
                            not spots — and they belong inside this visit. */}
                        {contents.length > 0 && (
                          <ul className="trip-contents">
                            {contents.map((c) => (
                              <li key={c.visit_id}>
                                <Link to={`/place/${c.place_id}`}>{c.place_name}</Link>
                                <span className="muted">
                                  {c.start_date === c.end_date
                                    ? fmtRunDate(c.start_date)
                                    : `${fmtRunDate(c.start_date)} – ${fmtRunDate(c.end_date)}`}
                                </span>
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
                                <Link
                                  to={`/place/${place.id}/day/${(a.start_date ?? '').slice(0, 10)}`}
                                >
                                  {a.name || a.type}
                                </Link>
                                <span className="muted">
                                  {[a.type, miStr(a.distance), fmtRunDate(a.start_date)]
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
                              <button
                                className="ve-btn ve-danger"
                                onClick={() => void removeVisit(r.del!)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
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
      <PhotoGallery place={place} onUploaded={refreshPlace} />

      {/* SECTIONS — a trail's member places are its sections. Shows the ones
          you've done (with dates) up top, then any not-yet-done, all in one place. */}
      {trailSections && (trailSections.done.length > 0 || trailSections.todo.length > 0) && (
        <>
          <h3 style={{ marginTop: 22 }}>
            SECTIONS{' '}
            <span className="label">
              ({trailSections.done.length}/{trailSections.done.length + trailSections.todo.length}{' '}
              done)
            </span>
          </h3>
          {/* Rollup: sections done · total miles · total visit-days across sections. */}
          {(() => {
            const done = trailSections.done;
            const totalMiles = Object.values(trailMiles).reduce((s, m) => s + m, 0) / 1609.344;
            const totalVisits = done.reduce((s, m) => s + (m.visit_count || 0), 0);
            return (
              <div className="our-stats" style={{ marginBottom: 12 }}>
                <span className="stat">
                  <b>{done.length}</b> <span className="label">sections done</span>
                </span>
                {totalMiles > 0 && (
                  <span className="stat">
                    <b>{totalMiles.toFixed(1)}</b> <span className="label">miles</span>
                  </span>
                )}
                {totalVisits > 0 && (
                  <span className="stat">
                    <b>{totalVisits}</b> <span className="label">visits</span>
                  </span>
                )}
              </div>
            );
          })()}
          {/* One fitted map of every done section along this trail. */}
          {trailSections.done.length > 0 && (
            <TrailSectionsMap trail={place} sections={trailSections.done} />
          )}
          <div className="spot-groups">
            {trailSections.done.length > 0 && (
              <details className="spot-cat" open>
                <summary className="spot-cat-head">
                  Done <span className="label">({trailSections.done.length})</span>
                </summary>
                {trailSections.done.map((m) => (
                  <div key={m.id} className="spot-row">
                    <Link className="spot-item" to={`/place/${m.id}`}>
                      <span className="spot-title">{m.name}</span>
                      <span className="muted">
                        {m.first_visit ? fmtRunDate(m.first_visit) : ''}
                        {m.visit_count > 1 ? ` · ${m.visit_count}×` : ''}
                      </span>
                    </Link>
                  </div>
                ))}
              </details>
            )}
            {trailSections.todo.length > 0 && (
              <details className="spot-cat">
                <summary className="spot-cat-head">
                  Not yet <span className="label">({trailSections.todo.length})</span>
                </summary>
                {trailSections.todo.map((m) => (
                  <div key={m.id} className="spot-row">
                    <Link className="spot-item" to={`/place/${m.id}`}>
                      <span className="spot-title">{m.name}</span>
                    </Link>
                  </div>
                ))}
              </details>
            )}
          </div>
        </>
      )}

      {/* SPOTS AND REVIEWS — heading like Photos and Videos, with a blue add link.
          Each logged category is a dropdown that opens to its spots. */}
      <div className="visits-head">
        <h3 style={{ marginTop: 22 }}>NOTES AND REVIEWS</h3>
        {canEdit && !addingSpot && (
          <span style={{ display: 'flex', gap: 12 }}>
            <button className="add-spot-link" onClick={() => setAddingSpot(true)}>
              + Add a place here
            </button>
            <button className="add-spot-link" onClick={() => setAddingMembers((v) => !v)}>
              + Add existing places
            </button>
          </span>
        )}
      </div>

      {canEdit && addingMembers && (
        <div className="entry">
          <label>
            Add places you've already saved to this one (a trip's stops, a trail's spots)
          </label>
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

      {canEdit && addingSpot && (
        <EntryEditor
          placeId={place.id}
          defaultDate={place.last_visit ?? new Date().toISOString().slice(0, 10)}
          onSave={addSpot}
          onCancel={() => setAddingSpot(false)}
        />
      )}
      {reviewGroups.length > 0 ? (
        <div className="spot-groups">
          {reviewGroups.map((g) => (
            <details className="spot-cat" key={g.key}>
              <summary className="spot-cat-head">
                {g.label} <span className="label">({g.places.length + g.entries.length})</span>
              </summary>
              {/* Linked member places of this category */}
              {g.places.map((m) => {
                const dest = m.address || (m.lat || m.lng ? `${m.lat},${m.lng}` : '');
                return (
                  <div key={m.id} className="spot-row">
                    <Link className="spot-item" to={`/place/${m.id}`}>
                      <span className="spot-title">{m.name}</span>
                      {m.rating ? (
                        <span className="spot-rating">{'★'.repeat(m.rating)}</span>
                      ) : null}
                    </Link>
                    {dest && (
                      <a
                        className="directions-btn sm spot-dir"
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
              {/* Inline entry-spots of this category */}
              {g.entries.map((e) => {
                const dir = spotDirHref(e);
                return (
                  <div key={e.id} className="spot-row">
                    <Link
                      className="spot-item"
                      to={e.date ? `/place/${place.id}/day/${e.date}` : `/place/${place.id}`}
                    >
                      <span className="spot-title">{e.title}</span>
                      {e.rating ? (
                        <span className="spot-rating">{'★'.repeat(e.rating)}</span>
                      ) : null}
                    </Link>
                    {dir && (
                      <a
                        className="directions-btn sm spot-dir"
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
            </details>
          ))}
        </div>
      ) : (
        !addingSpot && (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Nothing written here yet.</p>
        )
      )}

      <RouteMiniMap place={place} />

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
