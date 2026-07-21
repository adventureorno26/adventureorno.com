import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addPlaceToTrail,
  addVisit,
  createEntry,
  deletePlace,
  deleteVisit,
  fetchEntries,
  fetchMapPeople,
  fetchPlace,
  fetchVisits,
  mergePlaces,
  updatePlace,
  type MapPerson,
} from '../lib/data';
import type { Activity, Entry, NewEntry, Place, Visit } from '../lib/types';
import {
  CATEGORIES,
  categoryIcon,
  categoryLabel,
  categoryReviewLabel,
  effectiveCategories,
} from '../lib/categories';
import { useAuth } from '../auth/AuthProvider';
import { fetchActivitiesForPlace, fetchMileageForPlaces } from '../lib/strava';
import { photosEnabled } from '../lib/photos';
import { retrieveResult, type SearchResult } from '../lib/maptiler';
import AuthedImg from './AuthedImg';
import { PinIcon } from './Icons';
import EntryEditor from './EntryEditor';
import MapSearch from './MapSearch';
import PhotoGallery from './PhotoGallery';
import RouteMiniMap from './RouteMiniMap';
import StarRating from './StarRating';

interface Props {
  place: Place;
  allPlaces: Place[];
  onClose: () => void;
  onPlaceChanged: (place: Place) => void;
  onPlaceDeleted: (id: string) => void;
  onMerged: (loserId: string, winner: Place) => void;
  onAddRoute?: (placeId: string, name: string) => void;
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

// Singular noun for a Strava activity type (Hike → "hike", Ride → "ride").
const ACTIVITY_NOUN: Record<string, string> = {
  Run: 'run',
  Hike: 'hike',
  Walk: 'walk',
  Ride: 'ride',
};
function activityNoun(type: string, n: number): string {
  const base = ACTIVITY_NOUN[type] ?? 'activity';
  if (n === 1) return base;
  return base === 'activity' ? 'activities' : `${base}s`;
}
/** "2 hikes" when a trailhead's activities share a type, else "3 activities". */
function groupCountLabel(runs: Activity[]): string {
  const types = new Set(runs.map((r) => r.type));
  const type = types.size === 1 ? [...types][0] : 'activity';
  return `${runs.length} ${activityNoun(type, runs.length)}`;
}

/** Plural noun for a trail's "Logged ___" heading: "hikes" if all hikes, else
 *  "runs"/"walks"/… when uniform, "activities" when mixed or empty. */
function trailActivityNoun(acts: Activity[] | null): string {
  if (!acts || acts.length === 0) return 'activities';
  const types = new Set(acts.map((a) => a.type));
  const type = types.size === 1 ? [...types][0] : 'activity';
  return activityNoun(type, 2);
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
    .map(([type, m]) => `${(m / 1609.344).toFixed(1)} mi ${ACTIVITY_VERB[type] ?? type.toLowerCase()}`)
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
  const startOpt: Intl.DateTimeFormatOptions = sameYear
    ? { month: 'short', day: 'numeric' }
    : full;
  return `${s.toLocaleDateString(undefined, startOpt)} – ${e.toLocaleDateString(undefined, full)}`;
}

export default function PlacePanel({
  place,
  allPlaces,
  onClose,
  onPlaceChanged,
  onPlaceDeleted,
  onMerged,
  onAddRoute,
}: Props) {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';

  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [trailActs, setTrailActs] = useState<Activity[] | null>(null);
  const [trailMiles, setTrailMiles] = useState<Record<string, number>>({});
  const [spots, setSpots] = useState<Entry[] | null>(null);
  const [addingSpot, setAddingSpot] = useState(false);
  const [addingVisit, setAddingVisit] = useState(false);
  const [vStart, setVStart] = useState('');
  const [vEnd, setVEnd] = useState('');
  const [vMulti, setVMulti] = useState(false);
  const [merging, setMerging] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(place.name);
  const [error, setError] = useState<string | null>(null);

  const [review, setReview] = useState(place.review ?? '');
  const [favorite, setFavorite] = useState(place.favorite ?? '');
  const [people, setPeople] = useState<MapPerson[]>([]);
  const [trailSel, setTrailSel] = useState('');
  const [trailheadName, setTrailheadName] = useState('');
  const [editingRegion, setEditingRegion] = useState(false);
  const [eAdmin1, setEAdmin1] = useState(place.admin1 ?? '');
  const [eCountry, setECountry] = useState(place.country ?? '');

  async function saveRegion() {
    setEditingRegion(false);
    await patch({ admin1: eAdmin1.trim() || null, country: eCountry.trim() || null });
  }
  const [coverPos, setCoverPos] = useState(place.cover_pos_y ?? 50);
  const [adjustCover, setAdjustCover] = useState(false);

  useEffect(() => {
    fetchMapPeople().then(setPeople).catch(() => undefined);
  }, []);

  useEffect(() => {
    setReview(place.review ?? '');
    setFavorite(place.favorite ?? '');
    setName(place.name);
    setCoverPos(place.cover_pos_y ?? 50);
    setEAdmin1(place.admin1 ?? '');
    setECountry(place.country ?? '');
  }, [place]);

  async function reloadVisits() {
    setVisits(await fetchVisits(place.id).catch(() => []));
  }
  async function reloadSpots() {
    setSpots(await fetchEntries(place.id).catch(() => []));
  }
  // Add a spot/review straight from the main card; its category tags the place
  // and it shows under that category's review section here + on its day.
  async function addSpot(draft: NewEntry) {
    await createEntry({ ...draft, place_id: place.id });
    setAddingSpot(false);
    await reloadSpots();
    await refreshPlace(); // pick up the tag the spot's kind added
  }
  useEffect(() => {
    let active = true;
    setVisits(null);
    setSpots(null);
    fetchVisits(place.id)
      .then((rows) => active && setVisits(rows))
      .catch(() => active && setVisits([]));
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
    if (!place.is_trail) {
      setTrailActs(null);
      setTrailMiles({});
      return;
    }
    let active = true;
    setTrailActs(null);
    fetchActivitiesForPlace(place.id)
      .then((rows) => active && setTrailActs(rows))
      .catch(() => active && setTrailActs([]));
    const memberIds = allPlaces.filter((p) => p.trail_id === place.id).map((p) => p.id);
    fetchMileageForPlaces([place.id, ...memberIds])
      .then((m) => active && setTrailMiles(m))
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.id, place.is_trail, allPlaces]);

  // Group a trail's activities by trailhead (fallback: Strava name), each group's
  // runs newest-first, and groups ordered by their most-recent run.
  const trailGroups = useMemo(() => {
    if (!trailActs) return [];
    const byHead = new Map<string, Activity[]>();
    for (const a of trailActs) {
      const label = a.trailhead?.trim() || a.name?.trim() || 'Run';
      if (!byHead.has(label)) byHead.set(label, []);
      byHead.get(label)!.push(a);
    }
    const groups = [...byHead.entries()].map(([label, runs]) => ({
      label,
      runs: [...runs].sort((x, y) => (y.start_date ?? '').localeCompare(x.start_date ?? '')),
    }));
    groups.sort((g, h) =>
      (h.runs[0]?.start_date ?? '').localeCompare(g.runs[0]?.start_date ?? ''),
    );
    return groups;
  }, [trailActs]);

  // Group spots by their tag (category), in CATEGORIES order, notes last.
  const spotGroups: { key: string; label: string; icon: string; items: Entry[] }[] = [];
  if (spots && spots.length) {
    const order = [...CATEGORIES.map((c) => c.slug), 'note'];
    const byKind = new Map<string, Entry[]>();
    for (const e of spots) {
      const k = e.kind || 'note';
      if (!byKind.has(k)) byKind.set(k, []);
      byKind.get(k)!.push(e);
    }
    for (const k of order) {
      const items = byKind.get(k);
      if (items && items.length) {
        spotGroups.push({
          key: k,
          label: k === 'note' ? 'Notes' : categoryReviewLabel(k),
          icon: k === 'note' ? '📝' : categoryIcon(k),
          items,
        });
      }
    }
  }

  async function submitVisit() {
    const start = vStart;
    const end = vMulti && vEnd ? vEnd : vStart;
    if (!start) return;
    try {
      await addVisit(place.id, start, end < start ? start : end);
      setAddingVisit(false);
      setVStart('');
      setVEnd('');
      setVMulti(false);
      await reloadVisits();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add visit');
    }
  }
  async function removeVisit(id: string) {
    if (!confirm('Delete this visit?')) return;
    try {
      await deleteVisit(id);
      await reloadVisits();
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

  async function saveName() {
    setEditingName(false);
    if (name.trim() && name.trim() !== place.name) await patch({ name: name.trim(), auto: false });
    else setName(place.name);
  }

  // The search also fills the title: picking a result sets the name (Title), the
  // state/country, the pin location, and — through those — the Directions link.
  async function setLocationFromSearch(r: SearchResult) {
    setError(null);
    const full = r.mapbox_id ? await retrieveResult(r).catch(() => r) : r;
    if (full.lat === 0 && full.lng === 0) {
      setError("Couldn't resolve that location — try another.");
      return;
    }
    await patch({
      name: full.name?.trim() || place.name,
      auto: false,
      lat: full.lat,
      lng: full.lng,
      admin1: full.admin1 ?? place.admin1,
      country: full.country ?? place.country,
      address: full.address ?? place.address,
    });
  }

  // Trail assignment: either make this place its own trail, or attach it as a
  // trailhead of an existing trail (keeps its photos/marker).
  async function addToExistingTrail() {
    if (!trailSel) return;
    setError(null);
    try {
      await addPlaceToTrail(place.id, trailSel, trailheadName.trim() || place.name);
      const updated = await fetchPlace(place.id);
      if (updated) onPlaceChanged(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add to trail');
    }
  }

  async function toggleCat(slug: string) {
    const cur = place.categories ?? [];
    const next = cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug];
    await patch({ categories: next });
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
  // A trail or one of its trailheads → the location search is labelled "Trailhead".
  const isTrailPlace = place.is_trail || Boolean(place.trail_id);

  const ratingEl = (
    <StarRating
      value={place.rating}
      size={16}
      readOnly={!canEdit}
      onChange={(n) => void patch({ rating: n })}
    />
  );

  // The place name, shown as the title on the photo. Click to edit it by hand;
  // the search below also fills it in.
  const titleEl =
    editingName && canEdit ? (
      <input
        className="title-input"
        value={name}
        autoFocus
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
        className={canEdit ? 'title-editable' : undefined}
        onClick={() => canEdit && setEditingName(true)}
        title={canEdit ? 'Tap to rename' : undefined}
      >
        {place.name}
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

  // The location search: find the city & state; it fills the Title, State, pin,
  // and the Directions link. For a freshly-added category place with no name yet,
  // the placeholder hints what to type ("Winery Name", "Name of Restaurant"…).
  const searchExample = (): string => {
    if (place.name) return `${place.name} — search to change`;
    const cats = effectiveCategories(place);
    if (cats.includes('winery')) return 'Winery Name';
    if (cats.includes('stay')) return 'Hotel Name';
    if (cats.includes('dining')) return 'Name of Restaurant';
    if (cats.includes('brewery')) return 'Brewery Name';
    if (cats.some((c) => ['hiking', 'walking', 'running', 'biking'].includes(c)))
      return 'Trail or spot name';
    return 'Search for a place…';
  };
  const locateSearch = canEdit && (
    <div className="place-locate bucket-search">
      {isTrailPlace && <div className="locate-label">Trailhead</div>}
      <MapSearch onPick={setLocationFromSearch} placeholder={searchExample()} />
    </div>
  );

  return (
    <aside className="panel">
      {hasHero ? (
        <div className="panel-hero" style={{ ['--pos' as string]: `${coverPos}%` }}>
          <AuthedImg photoId={place.cover_photo_id!} size="full" className="panel-hero-img" />
          <button className="close hero-close" onClick={onClose} aria-label="Close">
            ×
          </button>
          {canEdit && (
            <button
              className="hero-adjust"
              title="Adjust cover framing"
              onClick={() => setAdjustCover((v) => !v)}
            >
              ⤢
            </button>
          )}
          {canEdit && adjustCover && (
            <input
              className="hero-pos"
              type="range"
              min={0}
              max={100}
              value={coverPos}
              onChange={(e) => setCoverPos(Number(e.target.value))}
              onPointerUp={() => void patch({ cover_pos_y: coverPos })}
              onKeyUp={() => void patch({ cover_pos_y: coverPos })}
            />
          )}
          {/* Stars above the title, bottom-left of the photo. */}
          <div className="hero-title">
            <div className="hero-rating">{ratingEl}</div>
            <h2 className="title-with-rating">{titleEl}</h2>
          </div>
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
      {canEdit && !place.saved && !place.bucket && (
        <div className="save-place">
          <span>Not saved — it won’t show on the map or count until you save.</span>
          <button className="primary" onClick={() => void patch({ saved: true })}>
            Save to map
          </button>
        </div>
      )}

      {/* Search to change the title/state (also fills them in). */}
      {locateSearch}

      {/* City, State — the text itself is the Directions link. */}
      <div className={`meta ${place.is_trail ? 'meta-trail' : ''}`}>
        <span>
          {editingRegion && canEdit ? (
            <span className="region-edit">
              <input
                placeholder="State / region"
                value={eAdmin1}
                autoFocus
                onChange={(e) => setEAdmin1(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void saveRegion()}
              />
              <input
                placeholder="Country"
                value={eCountry}
                onChange={(e) => setECountry(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void saveRegion()}
              />
              <button className="primary" style={{ flex: 'none' }} onClick={() => void saveRegion()}>
                Save
              </button>
            </span>
          ) : (
            <>
              <a
                className="region-directions"
                href={dirHref}
                target="_blank"
                rel="noreferrer"
                title={`Directions to ${dirDest}`}
              >
                {regionText}
              </a>
              {canEdit && (
                <button className="link-btn region-edit-btn" onClick={() => setEditingRegion(true)}>
                  edit
                </button>
              )}
              {visits && visits.length > 0 && ` · ${visits.length} visit${visits.length > 1 ? 's' : ''}`}
              {place.bucket && <span className="bucket-flag"> · 🔖 Bucket List!</span>}
            </>
          )}
        </span>
        {place.is_trail && trailMilesSummary(trailMiles) && (
          <span className="trail-miles">{trailMilesSummary(trailMiles)}</span>
        )}
      </div>

      {/* Edit tags — under the region line, above the tag chips. */}
      {canEdit && (
        <details className="cat-edit">
          <summary>Edit tags</summary>
          <div className="cat-picker">
            {CATEGORIES.map((c) => {
              const on = (place.categories ?? []).includes(c.slug);
              return (
                <button
                  key={c.slug}
                  className={`cat-toggle ${on ? 'on' : ''}`}
                  onClick={() => void toggleCat(c.slug)}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </details>
      )}
      {place.address && <div className="place-address">📍 {place.address}</div>}

      {(place.website || (canEdit && place.bucket)) && (
        <div className="card-actions">
          {place.website && (
            <a className="website-btn" href={normalizeUrl(place.website)} target="_blank" rel="noreferrer">
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

      {/* Category tags — above the review box. Tap × to remove a tag you added. */}
      <div className="cats">
        {effectiveCategories(place).map((slug) => {
          const removable = canEdit && (place.categories ?? []).includes(slug);
          return (
            <span key={slug} className="cat-chip" title={`Show all ${categoryLabel(slug)} on the map`}>
              <Link className="cat-chip-link" to={`/?cat=${slug}`}>
                {categoryIcon(slug)} {categoryLabel(slug)}
              </Link>
              {removable && (
                <button
                  className="cat-chip-x"
                  title={`Remove ${categoryLabel(slug)} tag`}
                  onClick={() => void toggleCat(slug)}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        {effectiveCategories(place).length === 0 && (
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>No tags yet</span>
        )}
      </div>

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
              <button className="primary" onClick={() => void patch({ review: review.trim() || null })}>
                Save review
              </button>
              <button onClick={() => setReview(place.review ?? '')}>Cancel</button>
            </div>
          )}
        </div>
      ) : (
        place.review && <p className="body">{place.review}</p>
      )}

      {/* Category-specific favorite: wines (winery) / meal (dining) / beer (brewery). */}
      {(() => {
        const cats = effectiveCategories(place);
        const favLabel = cats.includes('winery')
          ? 'Favorite wines'
          : cats.includes('dining')
            ? 'Favorite meal'
            : cats.includes('brewery')
              ? 'Favorite beer'
              : null;
        if (!favLabel) return null;
        if (!canEdit) {
          return place.favorite ? (
            <p className="body">
              <b>{favLabel}:</b> {place.favorite}
            </p>
          ) : null;
        }
        return (
          <div style={{ marginTop: 12 }}>
            <label className="fav-label">{favLabel}</label>
            <div className="field-row" style={{ marginTop: 4 }}>
              <input
                value={favorite}
                placeholder={favLabel}
                onChange={(e) => setFavorite(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void patch({ favorite: favorite.trim() || null });
                }}
              />
              {favorite !== (place.favorite ?? '') && (
                <button
                  className="primary"
                  style={{ flex: 'none' }}
                  onClick={() => void patch({ favorite: favorite.trim() || null })}
                >
                  Save
                </button>
              )}
            </div>
          </div>
        );
      })()}


      {place.is_trail ? (
        /* Trails — runs/hikes grouped by trailhead; tap a run for its map + miles. */
        <>
          <div className="visits-head">
            <h3 style={{ margin: '22px 0 0' }}>Trailheads</h3>
          </div>
          {(() => {
            const members = allPlaces.filter((p) => p.trail_id === place.id);
            return members.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                No trailheads linked yet. Open a place along this trail and use “This is a Trail →
                add to an existing trail”.
              </p>
            ) : (
              <div className="trailhead-cards">
                {members.map((th) => (
                  <Link key={th.id} className="trailhead-card" to={`/place/${th.id}`}>
                    {th.cover_photo_id ? (
                      <AuthedImg
                        photoId={th.cover_photo_id}
                        size="thumb"
                        className="trailhead-thumb"
                      />
                    ) : (
                      <span className="trailhead-thumb ph">
                        <PinIcon size={18} />
                      </span>
                    )}
                    <span className="trailhead-card-name">{th.name}</span>
                    {th.admin1 && <span className="muted">{th.admin1}</span>}
                  </Link>
                ))}
              </div>
            );
          })()}

          <div className="visits-head">
            <h3 style={{ margin: '22px 0 0' }}>
              Logged {trailActivityNoun(trailActs)}
              {trailActs && trailActs.length > 0 ? ` (${trailActs.length})` : ''}
            </h3>
            {canEdit && onAddRoute && (
              <button className="link-btn" onClick={() => onAddRoute(place.id, place.name)}>
                ＋ Add a route
              </button>
            )}
          </div>
          {trailActs === null ? (
            <p style={{ color: 'var(--muted)' }}>Loading…</p>
          ) : trailActs.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              Nothing logged on this trail yet. Tap <b>＋ Add a route</b> to trace one on the map, or
              log it to Strava.
            </p>
          ) : (
            <div className="trailheads">
              {trailGroups.map((g) => (
                <details key={g.label} className="trailhead-group" open={trailGroups.length <= 3}>
                  <summary>
                    <span className="trailhead-name">{g.label}</span>
                    <span className="muted"> · {groupCountLabel(g.runs)}</span>
                  </summary>
                  <div className="trail-runs">
                    {g.runs.map((a) => (
                      <Link
                        key={a.id}
                        className="trail-run"
                        to={`/place/${place.id}/day/${(a.start_date ?? '').slice(0, 10)}`}
                      >
                        <span className="visit-date">{fmtRunDate(a.start_date)}</span>
                        <span className="muted">
                          {a.type} · {miStr(a.distance)}
                        </span>
                      </Link>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Visits — each trip; tap to open its day (map + photos + spots) */}
          <div className="visits-head">
            <h3 style={{ margin: '22px 0 0' }}>
              Visits{visits && visits.length > 0 ? ` (${visits.length})` : ''}
            </h3>
            {canEdit && !addingVisit && (
              <button
                className="link-btn"
                onClick={() => {
                  setAddingVisit(true);
                  setVStart(new Date().toISOString().slice(0, 10));
                }}
              >
                ＋ Add a visit
              </button>
            )}
          </div>

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
              <div className="btn-row">
                <button className="primary" disabled={!vStart} onClick={() => void submitVisit()}>
                  Add visit
                </button>
                <button onClick={() => setAddingVisit(false)}>Cancel</button>
              </div>
            </div>
          )}

          {visits === null ? (
            <p style={{ color: 'var(--muted)' }}>Loading…</p>
          ) : visits.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              No visits logged yet. Add one, or upload a photo here.
            </p>
          ) : (
            <div className="visits">
              {visits.map((v) => (
                <div key={v.id} className="visit-row">
                  <Link className="visit-main" to={`/place/${place.id}/day/${v.start_date}`}>
                    <span className="visit-date">{fmtVisit(v)}</span>
                  </Link>
                  {canEdit && (
                    <button
                      className="visit-del"
                      title="Delete visit"
                      onClick={() => void removeVisit(v.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <h3 style={{ marginTop: 22 }}>Photos and Videos</h3>
      <PhotoGallery place={place} visits={visits ?? undefined} onUploaded={refreshPlace} />

      <RouteMiniMap place={place} />

      {/* Spots & reviews — grouped by tag; each category label only appears once
          you've added a review of that kind, so the card stays uncluttered. */}
      <div className="visits-head">
        <h3 style={{ marginTop: 22 }}>Spots &amp; reviews</h3>
        {canEdit && !addingSpot && (
          <button className="link-btn" onClick={() => setAddingSpot(true)}>
            ＋ Add a spot
          </button>
        )}
      </div>

      {canEdit && addingSpot && (
        <EntryEditor
          placeId={place.id}
          defaultDate={place.last_visit ?? new Date().toISOString().slice(0, 10)}
          onSave={addSpot}
          onCancel={() => setAddingSpot(false)}
        />
      )}

      {spotGroups.length > 0 ? (
        <div className="spot-groups">
          {spotGroups.map((g) => (
            <div className="spot-group" key={g.key}>
              <div className="spot-group-head">
                {g.icon} {g.label} <span className="label">({g.items.length})</span>
              </div>
              {g.items.map((e) => {
                const dir = spotDirHref(e);
                return (
                  <div key={e.id} className="spot-row">
                    <Link
                      className="spot-item"
                      to={e.date ? `/place/${place.id}/day/${e.date}` : `/place/${place.id}`}
                    >
                      <span className="spot-title">{e.title}</span>
                      {e.rating ? <span className="spot-rating">{'★'.repeat(e.rating)}</span> : null}
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
            </div>
          ))}
        </div>
      ) : (
        !addingSpot && (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            No spots yet. Add a restaurant, trail, winery… with a rating and review.
          </p>
        )
      )}

      {/* Whose place is this — Both (default) or just one of you. */}
      {canEdit && people.length >= 2 && (
        <div className="attribution-row">
          <label>Whose is this?</label>
          <select
            value={place.solo_profile ?? ''}
            onChange={(e) => void patch({ solo_profile: e.target.value || null })}
          >
            <option value="">Both of us</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                Just {p.display_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {canEdit && (
        <div className="btn-row bottom-actions" style={{ marginTop: 22 }}>
          <button onClick={() => setMerging((v) => !v)}>Merge…</button>
          <button className="danger" onClick={() => void removePlace()}>
            Delete
          </button>

          {/* "This is a Trail" lives on the same line as Merge / Delete. */}
          {!place.is_trail && !place.trail_id && (
            <details className="cat-edit trail-assign inline-trail">
              <summary>This is a Trail</summary>
              <div style={{ marginTop: 8 }}>
                <button className="primary" onClick={() => void patch({ is_trail: true })}>
                  Yes — make this its own trail
                </button>
                {allPlaces.some((p) => p.is_trail) && (
                  <>
                    <div className="trail-or">or add it as a trailhead on an existing trail:</div>
                    <div className="field-row">
                      <select value={trailSel} onChange={(e) => setTrailSel(e.target.value)}>
                        <option value="">Choose a trail…</option>
                        {allPlaces
                          .filter((p) => p.is_trail)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="field-row" style={{ marginTop: 6 }}>
                      <input
                        placeholder={`Trailhead name (default: ${place.name})`}
                        value={trailheadName}
                        onChange={(e) => setTrailheadName(e.target.value)}
                      />
                      <button
                        className="primary"
                        style={{ flex: 'none' }}
                        disabled={!trailSel}
                        onClick={() => void addToExistingTrail()}
                      >
                        Add to trail
                      </button>
                    </div>
                  </>
                )}
              </div>
            </details>
          )}
          {place.trail_id && (
            <span className="trail-member">
              Trailhead of{' '}
              <Link to={`/place/${place.trail_id}`}>
                {allPlaces.find((p) => p.id === place.trail_id)?.name ?? 'a trail'}
              </Link>
              <button className="link-btn" onClick={() => void patch({ trail_id: null })}>
                Remove from trail
              </button>
            </span>
          )}
          {place.is_trail && (
            <label className="trail-toggle">
              <input type="checkbox" checked onChange={() => void patch({ is_trail: false })} />
              This is a trail
            </label>
          )}
        </div>
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
        </div>
      )}

      {/* Save at the very bottom — unsaved places don't stay on the map. */}
      {canEdit && !place.bucket && (
        <div className="save-bottom">
          {place.saved ? (
            <span className="saved-note">Saved — this place shows on the map.</span>
          ) : (
            <>
              <button className="primary save-btn" onClick={() => void patch({ saved: true })}>
                Save this place
              </button>
              <span className="unsaved-note">
                Not saved yet — unsaved places disappear from the map.
              </span>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
