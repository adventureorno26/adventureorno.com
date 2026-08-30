import { useState } from 'react';
import { setPlaceSolo, updatePlace } from '../lib/data';
import { announceWho } from '../lib/whoWasThere';
import { showSnack } from '../lib/snackbar';
import type { MapPerson } from '../lib/data';
import { MANUAL_CATEGORIES, categoryLabel } from '../lib/categories';
import { whoSingle } from '../lib/participants';
import WhoPicker from './WhoPicker';
import MapSearch from './MapSearch';
import type { Place } from '../lib/types';

/** Compact, place-card-style editor: rename, fix the location with an
 *  address/place search (for photos with no GPS), retag, rate, set who was
 *  there — reusable anywhere a place needs quick editing (e.g. the photo sorter). */
export default function PlaceQuickEdit({
  place,
  people,
  meId,
  onUpdated,
  hideWho,
  whoProfiles = [],
}: {
  place: Place;
  people: MapPerson[];
  meId: string | null;
  onUpdated: (p: Place) => void;
  hideWho?: boolean; // hide the who control entirely
  // WHO IS ON THIS PLACE, derived from its visits (place_attribution). There is no
  // place-level column — reading one was why Rehoboth Beach claimed everyone while its
  // visit was correctly Erica's.
  //
  // The per-VISIT variant of this control went with the dropdown (2026-08-30). It had no
  // caller: the photo sorter asks who was on the visit ONCE, above its own copy of this
  // editor, and passes `hideWho` here. Two props nobody set were two ways for the place
  // question and the visit question to be answered in the same box again.
  whoProfiles?: string[];
}) {
  const [name, setName] = useState(place.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [who, setWhoLocal] = useState<string[]>(whoProfiles);

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

  async function setWho(ids: string[]) {
    // ONE NAME, because that is what the place-level writer holds:
    // `set_place_solo(p_place, p_profile)` takes a single profile id. The picker is
    // `capacity="one"` for exactly this reason — the alternative is a multi-select that
    // keeps the first name and reports a save it did not make.
    const profileId = whoSingle(ids, meId);
    setBusy('Saving…');
    try {
      // setPlaceSolo writes every VISIT at this place; the place itself holds no
      // attribution. It also only STATES your own presence — naming somebody else raises
      // one question about the place (0240/0242), so the control must not show them as
      // being there until they have answered it.
      const outcome = await setPlaceSolo(place.id, profileId);
      announceWho(outcome, people);
      if (!outcome.asked.length) setWhoLocal(profileId ? [profileId] : []);
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
            <WhoPicker
              people={people}
              meId={meId}
              value={who}
              capacity="one"
              heading="Who goes to this place?"
              note="This sets every visit here, and the place-level record holds one name. Nobody ticked means it was just you."
              onChange={(ids) => void setWho(ids)}
            />
          </div>
        )}
      </div>

      {busy && <div className="label">{busy}</div>}
    </div>
  );
}
