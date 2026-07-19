import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addVisit,
  deletePlace,
  deleteVisit,
  fetchEntries,
  fetchPlace,
  fetchVisits,
  mergePlaces,
  updatePlace,
} from '../lib/data';
import type { Entry, Place, Visit } from '../lib/types';
import { CATEGORIES, categoryIcon, categoryLabel, effectiveCategories } from '../lib/categories';
import { useAuth } from '../auth/AuthProvider';
import { forwardGeocode } from '../lib/maptiler';
import { photosEnabled } from '../lib/photos';
import AuthedImg from './AuthedImg';
import PhotoGallery from './PhotoGallery';
import StarRating from './StarRating';

interface Props {
  place: Place;
  allPlaces: Place[];
  onClose: () => void;
  onPlaceChanged: (place: Place) => void;
  onPlaceDeleted: (id: string) => void;
  onMerged: (loserId: string, winner: Place) => void;
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
}: Props) {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';

  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [spots, setSpots] = useState<Entry[] | null>(null);
  const [addingVisit, setAddingVisit] = useState(false);
  const [vStart, setVStart] = useState('');
  const [vEnd, setVEnd] = useState('');
  const [vMulti, setVMulti] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(place.name);
  const [review, setReview] = useState(place.review ?? '');
  const [loc, setLoc] = useState('');
  const [coverPos, setCoverPos] = useState(place.cover_pos_y ?? 50);
  const [adjustCover, setAdjustCover] = useState(false);

  useEffect(() => {
    setName(place.name);
    setReview(place.review ?? '');
    setCoverPos(place.cover_pos_y ?? 50);
  }, [place]);

  async function reloadVisits() {
    setVisits(await fetchVisits(place.id).catch(() => []));
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
          label: k === 'note' ? 'Notes' : categoryLabel(k),
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

  async function setLocation(query: string) {
    const q = query.trim();
    if (!q) return;
    setError(null);
    const geo = await forwardGeocode(q);
    if (!geo) {
      setError(`Couldn't find "${q}".`);
      return;
    }
    await patch({
      lat: geo.lat,
      lng: geo.lng,
      admin1: place.admin1 ?? geo.admin1,
      country: place.country ?? geo.country,
    });
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
          <div className="hero-title">
            <h2>{titleEl}</h2>
          </div>
        </div>
      ) : (
        <div className="panel-head">
          <h2>{titleEl}</h2>
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      )}
      <div className="meta">
        {[place.admin1, place.country].filter(Boolean).join(', ') || 'Unknown region'}
        {visits && visits.length > 0 && ` · ${visits.length} visit${visits.length > 1 ? 's' : ''}`}
      </div>

      {/* Set / move the location by address (for photos added without GPS) */}
      {canEdit && (
        <details className="cat-edit">
          <summary>📍 Set / move location</summary>
          <div className="field-row" style={{ marginTop: 4 }}>
            <input
              placeholder="Type an address or place…"
              value={loc}
              onChange={(e) => setLoc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void setLocation(loc).then(() => setLoc(''));
              }}
            />
            <button
              className="primary"
              style={{ flex: 'none' }}
              onClick={() => void setLocation(loc).then(() => setLoc(''))}
            >
              Set
            </button>
          </div>
        </details>
      )}

      {error && <div className="banner">{error}</div>}

      {/* Overall rating + review */}
      <div className="rating-row">
        <StarRating
          value={place.rating}
          readOnly={!canEdit}
          onChange={(n) => void patch({ rating: n })}
        />
      </div>
      {canEdit ? (
        <div>
          <textarea
            placeholder="Add a review of this place…"
            value={review}
            onChange={(e) => setReview(e.target.value)}
            style={{ minHeight: 60 }}
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

      {/* Category tags — tap × to remove a tag you added (tags derived from your
          Strava activities can't be removed here since they reflect real routes). */}
      <div className="cats">
        {effectiveCategories(place).map((slug) => {
          const removable = canEdit && (place.categories ?? []).includes(slug);
          return (
            <span key={slug} className="cat-chip" title={categoryLabel(slug)}>
              {categoryIcon(slug)} {categoryLabel(slug)}
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
                  {c.icon} {c.label}
                </button>
              );
            })}
          </div>
        </details>
      )}

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

      <h3 style={{ marginTop: 22 }}>Photos and Videos</h3>
      <PhotoGallery place={place} onUploaded={refreshPlace} />

      {/* All spots at this place, grouped by tag */}
      {spotGroups.length > 0 && (
        <>
          <h3 style={{ marginTop: 22 }}>Spots</h3>
          <div className="spot-groups">
            {spotGroups.map((g) => (
              <div className="spot-group" key={g.key}>
                <div className="spot-group-head">
                  {g.icon} {g.label} <span className="label">({g.items.length})</span>
                </div>
                {g.items.map((e) => (
                  <Link
                    key={e.id}
                    className="spot-item"
                    to={e.date ? `/place/${place.id}/day/${e.date}` : `/place/${place.id}`}
                  >
                    <span className="spot-title">{e.title}</span>
                    {e.rating ? <span className="spot-rating">{'★'.repeat(e.rating)}</span> : null}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {canEdit && (
        <div className="btn-row" style={{ marginTop: 22 }}>
          <button onClick={() => setMerging((v) => !v)}>Merge…</button>
          <button className="danger" onClick={() => void removePlace()}>
            Delete
          </button>
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
    </aside>
  );
}
