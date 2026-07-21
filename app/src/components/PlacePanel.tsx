import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addVisit,
  createEntry,
  deletePlace,
  deleteVisit,
  fetchEntries,
  fetchMapPeople,
  fetchPlace,
  fetchVisits,
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
  const [editingAddress, setEditingAddress] = useState(false);
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
    const memberIds = allPlaces
      .filter((p) => (p.part_of ?? []).includes(place.id))
      .map((p) => p.id);
    fetchMileageForPlaces([place.id, ...memberIds])
      .then((m) => active && setTrailMiles(m))
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.id, place.is_trail, allPlaces]);

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

  // Member places ("part of" this one) are spots too — a trip's stops, a trail's
  // trailheads. Grouped by their tag and shown in SPOTS AND REVIEWS. Each keeps
  // its own map marker and links to its own card.
  const memberGroups: { key: string; label: string; items: Place[] }[] = [];
  {
    const members = allPlaces
      .filter((p) => (p.part_of ?? []).includes(place.id))
      .sort((a, b) => (a.first_visit ?? '').localeCompare(b.first_visit ?? ''));
    const byKind = new Map<string, Place[]>();
    for (const m of members) {
      const k = (m.categories && m.categories[0]) || 'place';
      if (!byKind.has(k)) byKind.set(k, []);
      byKind.get(k)!.push(m);
    }
    const order = [...CATEGORIES.map((c) => c.slug), 'place'];
    for (const k of order) {
      const items = byKind.get(k);
      if (items && items.length) {
        memberGroups.push({
          key: `mg-${k}`,
          label: k === 'place' ? 'Places' : categoryReviewLabel(k),
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
    await patch({
      lat: full.lat,
      lng: full.lng,
      admin1: full.admin1 ?? place.admin1,
      country: full.country ?? place.country,
      // Prefer the full address; fall back to the searched label if no street addr.
      address: full.address ?? full.label ?? place.address,
    });
  }

  async function toggleCat(slug: string) {
    const cur = place.categories ?? [];
    const next = cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug];
    await patch({ categories: next });
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
    const next = cur.includes(parentId)
      ? cur.filter((id) => id !== parentId)
      : [...cur, parentId];
    try {
      await patch({ part_of: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update that place');
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
        className={canEdit ? 'title-editable' : undefined}
        onClick={() => canEdit && setEditingName(true)}
        title={canEdit ? 'Tap to rename' : undefined}
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

      {/* Cover-photo framing slider — appears below the title when you tap the
          photo. Sized/coloured like before, just repositioned. */}
      {hasHero && canEdit && adjustCover && (
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
            {visits && visits.length > 0 && ` · ${visits.length} visit${visits.length > 1 ? 's' : ''}`}
            {place.bucket && <span className="bucket-flag"> · Bucket List</span>}
          </span>
        )}
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

      {/* Category-specific favorite: wines (winery) / beer (brewery). Meal is
          intentionally excluded from the main card. */}
      {(() => {
        const cats = effectiveCategories(place);
        const favLabel = cats.includes('winery')
          ? 'Favorite wines'
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


      {/* Visits — uniform for places AND trails. Collapsed into a dropdown to
          save space; click "Visits (N)" → the dates. Trails list their logged
          activity days here in the same style as places. */}
      {(() => {
        const isTrail = place.is_trail;
        // Visits = actual times we went to THIS place (its own dated visits/runs).
        // Member places ("part of" this one) list under SPOTS AND REVIEWS instead.
        const rows = isTrail
          ? (trailActs ?? []).map((a) => ({
              key: a.id,
              date: fmtRunDate(a.start_date),
              // Each visit: date · name · type · miles.
              sub: [a.name, a.type, miStr(a.distance)].filter(Boolean).join(' · '),
              to: `/place/${place.id}/day/${(a.start_date ?? '').slice(0, 10)}`,
              del: null as string | null,
            }))
          : (visits ?? []).map((v) => ({
              key: v.id,
              date: fmtVisit(v),
              sub: null as string | null,
              to: `/place/${place.id}/day/${v.start_date}`,
              del: v.id as string | null,
            }));
        const loading = isTrail ? trailActs === null : visits === null;
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
                  {rows.map((r) => (
                    <div key={r.key} className="visit-row">
                      <Link className="visit-main" to={r.to}>
                        <span className="visit-date">{r.date}</span>
                        {r.sub && <span className="muted">{r.sub}</span>}
                      </Link>
                      {canEdit && r.del && (
                        <button
                          className="visit-del"
                          title="Delete visit"
                          onClick={() => void removeVisit(r.del!)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </details>

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
          </>
        );
      })()}

      <h3 style={{ marginTop: 22 }}>Photos and Videos</h3>
      <PhotoGallery place={place} onUploaded={refreshPlace} />

      {/* SPOTS AND REVIEWS — heading like Photos and Videos, with a blue add link.
          Each logged category is a dropdown that opens to its spots. */}
      <div className="visits-head">
        <h3 style={{ marginTop: 22 }}>SPOTS AND REVIEWS</h3>
        {canEdit && !addingSpot && (
          <button className="add-spot-link" onClick={() => setAddingSpot(true)}>
            + Add a spot
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
      {spotGroups.length > 0 || memberGroups.length > 0 ? (
        <div className="spot-groups">
          {memberGroups.map((g) => (
            <details className="spot-cat" key={g.key}>
              <summary className="spot-cat-head">
                {g.label} <span className="label">({g.items.length})</span>
              </summary>
              {g.items.map((m) => {
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
            </details>
          ))}
          {spotGroups.map((g) => (
            <details className="spot-cat" key={g.key}>
              <summary className="spot-cat-head">
                {g.label} <span className="label">({g.items.length})</span>
              </summary>
              {g.items.map((e) => {
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
        !addingSpot && <p style={{ color: 'var(--muted)', fontSize: 13 }}>No spots yet.</p>
      )}

      <RouteMiniMap place={place} />

      {/* Bottom line: Both of us · Part of… · Delete · Save (green). */}
      {canEdit && (
        <div className="btn-row bottom-actions" style={{ marginTop: 22 }}>
          {people.length >= 2 && (
            <select
              className="attribution-select"
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
          )}
          <button onClick={() => setMerging((v) => !v)}>Part of…</button>
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
              // Only offer top-level containers — not places already part of
              // something, not this place, not ones already chosen.
              .filter(
                (p) =>
                  p.id !== place.id &&
                  (p.part_of ?? []).length === 0 &&
                  !(place.part_of ?? []).includes(p.id),
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
