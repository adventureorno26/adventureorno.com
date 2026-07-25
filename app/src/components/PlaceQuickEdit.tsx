import { useState } from 'react';
import { setPlaceSolo, updatePlace } from '../lib/data';
import type { MapPerson } from '../lib/data';
import { MANUAL_CATEGORIES, categoryLabel } from '../lib/categories';
import MapSearch from './MapSearch';
import type { Place } from '../lib/types';

type Who = 'both' | 'mine' | 'josh';

/** Compact, place-card-style editor: rename, fix the location with an
 *  address/place search (for photos with no GPS), retag, rate, set who was
 *  there — reusable anywhere a place needs quick editing (e.g. the photo sorter). */
export default function PlaceQuickEdit({
  place,
  people,
  meId,
  onUpdated,
}: {
  place: Place;
  people: MapPerson[];
  meId: string | null;
  onUpdated: (p: Place) => void;
}) {
  const [name, setName] = useState(place.name);
  const [busy, setBusy] = useState<string | null>(null);
  const joshId = people.find((p) => p.id !== meId)?.id ?? null;

  async function patch(p: Partial<Place>, label = 'Saving…') {
    setBusy(label);
    try {
      const upd = await updatePlace(place.id, p);
      onUpdated(upd);
    } catch {
      /* ignore */
    }
    setBusy(null);
  }

  function who(): Who {
    // Place-level view: null solo = both.
    return place.solo_profile == null
      ? 'both'
      : place.solo_profile === joshId
        ? 'josh'
        : 'mine';
  }
  async function setWho(k: Who) {
    const profileId = k === 'both' ? null : k === 'mine' ? meId : joshId;
    setBusy('Saving…');
    try {
      await setPlaceSolo(place.id, profileId ?? null);
      onUpdated({ ...place, solo_profile: profileId ?? null });
    } catch {
      /* ignore */
    }
    setBusy(null);
  }

  const avail = MANUAL_CATEGORIES.filter((c) => !(place.categories ?? []).includes(c.slug));

  return (
    <div className="pqe">
      <label className="pqe-row">
        <span>Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() !== place.name && void patch({ name: name.trim() })}
          placeholder="Name"
        />
      </label>

      <div className="pqe-row">
        <span>Location</span>
        <MapSearch
          placeholder="Search an address or place to set the location…"
          onPick={(r) => {
            setName(r.name);
            void patch(
              {
                name: r.name,
                admin1: r.admin1,
                country: r.country,
                address: r.address,
                lat: r.lat,
                lng: r.lng,
              },
              'Setting location…',
            );
          }}
        />
        {place.address && <div className="pqe-current label">{place.address}</div>}
      </div>

      <div className="pqe-row">
        <span>Tags</span>
        <div className="pqe-tags">
          <div className="pe-chips">
            {(place.categories ?? []).map((slug) => (
              <button
                key={slug}
                type="button"
                className="pe-chip"
                onClick={() =>
                  void patch({ categories: (place.categories ?? []).filter((c) => c !== slug) })
                }
              >
                {categoryLabel(slug)} ×
              </button>
            ))}
          </div>
          {avail.length > 0 && (
            <select
              value=""
              onChange={(e) =>
                e.target.value &&
                void patch({
                  categories: [...new Set([...(place.categories ?? []), e.target.value])],
                })
              }
            >
              <option value="">+ tag</option>
              {avail.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="pqe-row">
        <span>Rating</span>
        <select
          value={place.rating ?? 0}
          onChange={(e) => void patch({ rating: Number(e.target.value) || null })}
        >
          <option value={0}>—</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {'★'.repeat(n)}
            </option>
          ))}
        </select>
      </div>

      <div className="pqe-row">
        <span>Who</span>
        <select value={who()} onChange={(e) => void setWho(e.target.value as Who)}>
          <option value="both">Both</option>
          <option value="mine">Just me</option>
          <option value="josh">Just Josh</option>
        </select>
      </div>

      {busy && <div className="label">{busy}</div>}
    </div>
  );
}
