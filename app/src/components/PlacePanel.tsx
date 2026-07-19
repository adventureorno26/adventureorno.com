import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deletePlace, fetchPlace, fetchPlaceDays, mergePlaces, updatePlace } from '../lib/data';
import type { Place, PlaceDay } from '../lib/types';
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

function dayLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function daySummary(d: PlaceDay): string {
  const parts: string[] = [];
  if (d.activities) parts.push(`${d.activities} route${d.activities > 1 ? 's' : ''}`);
  if (d.entries) parts.push(`${d.entries} spot${d.entries > 1 ? 's' : ''}`);
  if (d.photos) parts.push(`${d.photos} photo${d.photos > 1 ? 's' : ''}`);
  return parts.join(' · ') || 'Visited';
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

  const [days, setDays] = useState<PlaceDay[] | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(place.name);
  const [review, setReview] = useState(place.review ?? '');
  const [first, setFirst] = useState(place.first_visit ?? '');
  const [last, setLast] = useState(place.last_visit ?? '');
  const [loc, setLoc] = useState('');

  useEffect(() => {
    setName(place.name);
    setReview(place.review ?? '');
    setFirst(place.first_visit ?? '');
    setLast(place.last_visit ?? '');
  }, [place]);

  useEffect(() => {
    let active = true;
    setDays(null);
    fetchPlaceDays(place.id)
      .then((rows) => active && setDays(rows))
      .catch(() => active && setDays([]));
    return () => {
      active = false;
    };
  }, [place.id]);

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
  }

  async function saveName() {
    setEditingName(false);
    if (name.trim() && name.trim() !== place.name) await patch({ name: name.trim(), auto: false });
    else setName(place.name);
  }

  async function saveDates() {
    await patch({ first_visit: first || null, last_visit: last || null });
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
        <div className="panel-hero">
          <AuthedImg photoId={place.cover_photo_id!} size="full" className="panel-hero-img" />
          <button className="close hero-close" onClick={onClose} aria-label="Close">
            ×
          </button>
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
        {place.visit_count > 0 &&
          ` · ${place.visit_count} day${place.visit_count > 1 ? 's' : ''} here`}
      </div>

      {/* Trip dates — editable so multi-day visits aren't cut to one activity */}
      {canEdit ? (
        <div className="date-edit">
          <input
            type="date"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            onBlur={() => void saveDates()}
          />
          <span className="date-arrow">→</span>
          <input
            type="date"
            value={last}
            onChange={(e) => setLast(e.target.value)}
            onBlur={() => void saveDates()}
          />
        </div>
      ) : (
        (place.first_visit || place.last_visit) && (
          <div className="meta">
            {[place.first_visit, place.last_visit].filter(Boolean).join(' → ')}
          </div>
        )
      )}

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

      {/* Visits — each day links to the day view (map + spots) */}
      <h3 style={{ marginTop: 22 }}>Visits</h3>
      {days === null ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : days.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>No dated visits yet.</p>
      ) : (
        <div className="visits">
          {days.map((d) => (
            <Link key={d.day} className="visit-row" to={`/place/${place.id}/day/${d.day}`}>
              <span className="visit-main">
                {d.label ? (
                  <>
                    <span className="visit-name">{d.label}</span>
                    <span className="visit-date sub">{dayLabel(d.day)}</span>
                  </>
                ) : (
                  <>
                    <span className="visit-date">{dayLabel(d.day)}</span>
                    <span className="visit-date sub">{daySummary(d)}</span>
                  </>
                )}
              </span>
              <span className="visit-arrow">›</span>
            </Link>
          ))}
        </div>
      )}

      <h3 style={{ marginTop: 22 }}>Photos</h3>
      <PhotoGallery place={place} onUploaded={refreshPlace} />

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
