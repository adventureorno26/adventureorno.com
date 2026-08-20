import { useState } from 'react';
import { setPlaceSolo, updatePlace } from '../lib/data';
import { announceWho } from '../lib/whoWasThere';
import { showSnack } from '../lib/snackbar';
import type { MapPerson } from '../lib/data';
import { MANUAL_CATEGORIES, categoryLabel } from '../lib/categories';
import { whoChoices, whoKey, whoProfileId } from '../lib/participants';
import MapSearch from './MapSearch';
import type { Place } from '../lib/types';

/** 'both' | 'mine' | a profile id. Built from the real members (lib/participants),
 *  never from a hardcoded pair. */
type Who = string;

/** Compact, place-card-style editor: rename, fix the location with an
 *  address/place search (for photos with no GPS), retag, rate, set who was
 *  there — reusable anywhere a place needs quick editing (e.g. the photo sorter). */
export default function PlaceQuickEdit({
  place,
  people,
  meId,
  onUpdated,
  hideWho,
  visitWho,
  onVisitWho,
  soloProfile = null,
}: {
  place: Place;
  people: MapPerson[];
  meId: string | null;
  onUpdated: (p: Place) => void;
  hideWho?: boolean; // hide the who control entirely
  // When provided, the Who dropdown is wired to a per-VISIT value instead of the
  // place-level attribution (used by the photo sorter).
  visitWho?: Who;
  onVisitWho?: (w: Who) => void;
  // Attribution DERIVED from this place's visits (place_attribution). There is no
  // place-level column any more — reading one was why Rehoboth Beach said "Both"
  // while its visit was correctly Erica's.
  soloProfile?: string | null;
}) {
  const [name, setName] = useState(place.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [solo, setSolo] = useState<string | null>(soloProfile);
  const choices = whoChoices(people, meId);

  async function patch(p: Partial<Place>, label = 'Saving…') {
    setBusy(label);
    try {
      const upd = await updatePlace(place.id, p);
      onUpdated(upd);
    } catch (e) {
      // A silently-dropped edit looks exactly like a successful one: the spinner
      // clears and nothing changes. Say so instead.
      showSnack({
        message:
          e instanceof Error ? `Could not save: ${e.message}` : 'Could not save that change.',
      });
    }
    setBusy(null);
  }

  function who(): Who {
    // Derived from the visits: null = everyone.
    return whoKey(solo, meId);
  }
  async function setWho(k: Who) {
    const profileId = whoProfileId(k, meId);
    setBusy('Saving…');
    try {
      // setPlaceSolo writes every VISIT at this place; the place itself holds no
      // attribution. It also only STATES your own presence — naming somebody else raises
      // one question about the place (0240/0242), so the control must not show them as
      // being there until they have answered it.
      const outcome = await setPlaceSolo(place.id, profileId ?? null);
      announceWho(outcome, people);
      if (!outcome.asked.length) setSolo(profileId ?? null);
      onUpdated(place);
    } catch (e) {
      showSnack({
        message:
          e instanceof Error ? `Could not change who: ${e.message}` : 'Could not change who went.',
      });
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

      <div className="pqe-inline">
        <div className="pqe-row pqe-tagcol">
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

        <div className="pqe-row pqe-ratecol">
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

        {!hideWho && (
          <div className="pqe-row pqe-whocol">
            <span>Who</span>
            {onVisitWho ? (
              <select
                value={visitWho ?? 'both'}
                onChange={(e) => onVisitWho(e.target.value as Who)}
              >
                {choices.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            ) : (
              <select value={who()} onChange={(e) => void setWho(e.target.value as Who)}>
                {choices.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {busy && <div className="label">{busy}</div>}
    </div>
  );
}
