import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addExperience,
  fetchPoiDetails,
  newExperienceKey,
  setPlaceSolo,
  updatePlace,
  type PoiDetails,
} from '../lib/data';
import type { MapPerson } from '../lib/data';
import { mapPool, uploadPhoto } from '../lib/photos';
import { reverseGeocode, type SearchResult } from '../lib/maptiler';
import { googlePhotosEnabled, pickFromGooglePhotos } from '../lib/googlePhotos';
import { haversineMeters } from '../lib/geo';
import { MANUAL_CATEGORIES, categoryLabel } from '../lib/categories';
import { whoChoices, whoProfileId } from '../lib/participants';
import { showSnack } from '../lib/snackbar';
import { announceWho } from '../lib/whoWasThere';
import MapSearch from './MapSearch';
import CardCover from './CardCover';
import StarRating from './StarRating';
import { useDialog } from '../lib/useDialog';
import type { Place } from '../lib/types';

/** 'both' | 'mine' | a profile id — built from the real members (lib/participants). */
type Who = string;

// How close another place must be to count as a possible duplicate, by type.
// Tight for point venues (a restaurant next door is a different place); wide for
// parks/trails/areas. Fixes photos attaching to a place tens of km away.
const TYPE_RADIUS_M: Record<string, number> = {
  dining: 100,
  winery: 100,
  brewery: 100,
  stay: 120,
  sunrise: 400,
  sunset: 400,
  beach: 1500,
  viewpoint: 2000,
  camping: 2000,
  jeeping: 3000,
  trail: 5000,
};
function dupeRadius(tags: string[]): number {
  if (tags.length === 0) return 300;
  return Math.max(...tags.map((t) => TYPE_RADIUS_M[t] ?? 300));
}

/** Explicit draft for a NEW place — nothing is written to the database until you
 *  press Save. Search or start from a clicked point, review the coordinates and
 *  any nearby duplicates, add photos + a visit date + tags + who, then Save once.
 *  Replaces the old "create a real row immediately, delete it if unused" flow. */
export default function NewPlaceDraft({
  initialLat,
  initialLng,
  presetName,
  places,
  people,
  meId,
  onSaved,
  onCancel,
  mode = 'visited',
}: {
  initialLat: number;
  initialLng: number;
  presetName?: string;
  places: Place[];
  people: MapPerson[];
  meId: string | null;
  // The second argument is the trail's name, and it is only passed when this save
  // made a trail AND the person asked to draw its route now — the caller hands off
  // to the map's draw mode instead of opening the card.
  onSaved: (placeId: string, drawRouteNamed?: string) => void;
  onCancel: () => void;
  // 'visited' = a place I've been (asks when + who). 'bucket' = somewhere to go
  // later, which has no visit and therefore nobody to attribute it to.
  mode?: 'visited' | 'bucket';
}) {
  const wanted = mode === 'bucket';
  const [name, setName] = useState(presetName ?? '');
  // Where does it belong? A TRAIL is the only container ever chosen by hand —
  // cities and regions attach spatially by boundary, so they are never a question.
  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [admin1, setAdmin1] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [visitDate, setVisitDate] = useState('');
  const [who, setWho] = useState<Who>('both');
  const [website, setWebsite] = useState<string | null>(null);
  // Staged like every other field on this card — nothing is written until Save.
  const [rating, setRating] = useState<number | null>(null);
  // The address is shown as a line with an "edit" that opens the search, exactly as the
  // saved card does it, rather than as a permanently-open search box.
  const [editingAddress, setEditingAddress] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  // Asked once, here only (§0.6): "Is this a trail with sections?" — and having said
  // yes, the offer to draw its reference route straight away.
  const [drawAfter, setDrawAfter] = useState(false);
  const [poi, setPoi] = useState<PoiDetails | null>(null);
  const [poiChecked, setPoiChecked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const choices = whoChoices(people, meId);
  // Idempotency keys per save action (reused on retry, reset on success). One for
  // the "create new place" action, one for "add to an existing (duplicate) place".
  const keyNew = useRef<string | null>(null);
  const keyExisting = useRef<string | null>(null);

  // ONE FACT, ONE PLACE. Being a trail IS carrying the `trail` tag — that is what
  // sets `is_trail` on save. The question above reads and writes the tag rather than
  // keeping its own boolean beside it, because a second copy is the bug this codebase
  // keeps having: two mechanisms for one fact, and the screen reading the copy.
  const isTrail = tags.includes('trail');
  function setIsTrail(yes: boolean) {
    setTags((t) =>
      yes ? [...t.filter((c) => c !== 'trail'), 'trail'] : t.filter((c) => c !== 'trail'),
    );
    if (!yes) setDrawAfter(false);
  }

  // Map the tri-state Who selector to the create_experience `who` param.
  function whoParam(): string | undefined {
    return whoProfileId(who, meId) ?? undefined; // 'both' — leave attribution unset
  }

  // Name/region from the coordinates, unless the caller preset a name.
  useEffect(() => {
    if (presetName) return;
    void reverseGeocode(lng, lat).then((g) => {
      if (!g) return;
      setName((n) => n || g.name);
      setAdmin1(g.admin1);
      setCountry(g.country);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Possible duplicates: saved places within a type-aware radius of this spot.
  const radius = dupeRadius(tags);
  const dupes = useMemo(
    () =>
      places
        .filter(
          (p) => p.saved && haversineMeters({ lat, lng }, { lat: p.lat, lng: p.lng }) <= radius,
        )
        .sort(
          (a, b) =>
            haversineMeters({ lat, lng }, { lat: a.lat, lng: a.lng }) -
            haversineMeters({ lat, lng }, { lat: b.lat, lng: b.lng }),
        )
        .slice(0, 5),
    [places, lat, lng, radius],
  );

  function pickLocation(r: SearchResult) {
    setLat(r.lat);
    setLng(r.lng);
    setName(r.name);
    setAdmin1(r.admin1);
    setCountry(r.country);
    setAddress(r.address);
    setPoi(null);
    setPoiChecked(false);
    setEditingAddress(false);
  }

  async function lookupPoi() {
    setBusy('Looking up on OpenStreetMap…');
    const d = await fetchPoiDetails(lat, lng);
    setPoi(d);
    setPoiChecked(true);
    setBusy(null);
  }

  async function save() {
    if (busy) return;
    setBusy('Saving…');
    try {
      if (!keyNew.current) keyNew.current = newExperienceKey();
      // Place + (optional) manual visit + attribution created atomically. A manual
      // visit is only logged when there are NO photos — with photos, the visit is
      // derived from the photo dates (avoids double-counting).
      const res = await addExperience(
        keyNew.current,
        {
          name: name.trim() || 'New place',
          admin1,
          country,
          address,
          lat,
          lng,
          categories: tags,
          saved: true,
          bucket: wanted,
          // Tagging it Trail IS what makes it a trail — there is no separate
          // "make this a trail" control any more.
          is_trail: tags.includes('trail'),
        },
        !wanted && visitDate && !files.length ? { date: visitDate, who: whoParam() } : {},
      );
      const placeId = res.place_id;

      // Enrichments create_experience doesn't own. The rating is staged on the blank
      // card like everything else, so it is applied here rather than as you tap.
      const extra: { website?: string; rating?: number } = {};
      if (website) extra.website = website;
      if (rating != null) extra.rating = rating;
      if (Object.keys(extra).length) await updatePlace(placeId, extra).catch(() => undefined);
      // Somewhere-to-go-later has no visit, so there is nothing to attribute.
      if (!wanted && who !== 'both') {
        // Not swallowed: losing this silently means the place is saved and
        // attributed to the wrong people, with nothing on screen to say so.
        await setPlaceSolo(placeId, whoProfileId(who, meId))
          .then((outcome) => announceWho(outcome, people))
          .catch((e: unknown) => {
            showSnack({
              message:
                e instanceof Error
                  ? `Saved, but could not set who was there: ${e.message}`
                  : 'Saved, but could not set who was there.',
            });
          });
      }

      if (files.length) {
        setBusy(`Adding ${files.length} photo${files.length === 1 ? '' : 's'}…`);
        const takenAt = visitDate ? `${visitDate}T12:00:00Z` : undefined;
        await mapPool(
          files,
          (f) => uploadPhoto(f, { placeId, lat, lng, takenAt, override: true }).catch(() => null),
          4,
        );
      }
      keyNew.current = null;
      // A new trail whose route she asked to draw goes straight to the map's draw
      // mode; everything else opens its card.
      onSaved(placeId, isTrail && drawAfter ? name.trim() || 'New place' : undefined);
    } catch {
      setBusy(null);
    }
  }

  // Picking a nearby duplicate should NOT throw away what you already entered —
  // carry the visit date, who, and photos onto the existing place as a NEW visit,
  // then open it. (Attribution here is per-visit, matching the model.)
  async function addToExisting(p: Place) {
    if (busy) return;
    setBusy('Adding your visit…');
    try {
      if (!keyExisting.current) keyExisting.current = newExperienceKey();
      // Same atomic path against an existing place; manual visit only when there
      // are no photos (photos derive their own visit).
      await addExperience(
        keyExisting.current,
        { id: p.id },
        visitDate && !files.length ? { date: visitDate, who: whoParam() } : {},
      );
      if (files.length) {
        setBusy(`Adding ${files.length} photo${files.length === 1 ? '' : 's'}…`);
        const takenAt = visitDate ? `${visitDate}T12:00:00Z` : undefined;
        await mapPool(
          files,
          (f) =>
            uploadPhoto(f, {
              placeId: p.id,
              lat: p.lat,
              lng: p.lng,
              takenAt,
              override: true,
            }).catch(() => null),
          4,
        );
      }
      keyExisting.current = null;
      onSaved(p.id);
    } catch {
      setBusy(null);
    }
  }

  // Tags you can actually choose. City and Region are NOT offered: they attach
  // spatially by boundary, so asking is meaningless. Trip is not offered either —
  // a trip is a visit you marked, not a kind of place (docs/STATE.md §0.4). Trail is the
  // one container a person sets by hand, and it is set by the question above — asking
  // again here would be asking twice.
  const NOT_A_TAG = new Set(['city', 'region', 'trip', 'trail']);
  // `avail` (the "+ tag" dropdown's remaining options) went with the select: the locked
  // card shows category TAGS AS PILLS, and on a blank card every one of them is still a
  // choice, so the whole palette is offered and each pill toggles itself.

  // Guard against losing entered work: confirm before closing a dirty draft.
  const dirty =
    !!name.trim() ||
    files.length > 0 ||
    !!visitDate ||
    tags.length > 0 ||
    !!website ||
    rating != null;
  function requestCancel() {
    if (busy) return;
    if (dirty && !confirm('Discard this new place and everything you’ve entered?')) return;
    onCancel();
  }
  const cardRef = useDialog<HTMLDivElement>(requestCancel);

  return (
    <div
      className="npd-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestCancel();
      }}
    >
      {/* THE BLANK CARD IS THE CARD WITH ITS FIELDS EMPTY (rebuilt 2026-08-28).
          §"THE CARD — LOCKED": "The blank (new) card is the same card with the fields
          empty... Its Visits section says 'this is visit one', because saving a new place
          IS its first visit. Routes and Restaurants say 'Added once this first visit is
          saved'."

          It used to be a dialog of label-and-input rows — Name, Location, Official details,
          Visit date, What is it? — with no sections at all, and none of that copy anywhere
          in the app. It carries `.panel` now, so it inherits the card's own stylesheet:
          the same cover, the same uppercase blue-rule headings, the same everything. The
          logic underneath is untouched — the duplicate check, the POI lookup, the reverse
          geocode and the atomic save all still do exactly what they did. */}
      <aside
        className="panel npd-card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={wanted ? 'Somewhere to go later' : 'New place'}
        tabIndex={-1}
      >
        {/* 1. THE COVER, 2. THE NAME OVER IT, 3. THE RATING UNDER THE NAME. The same
            component the saved card and the visit card use, so the three cannot drift. */}
        <CardCover
          onClose={requestCancel}
          closeLabel="Cancel"
          onPickPhoto={() => fileRef.current?.click()}
          slotLabel={
            files.length > 0
              ? `${files.length} photo${files.length === 1 ? '' : 's'} — the first is the cover`
              : 'Add a cover photo'
          }
          title={
            <input
              className="title-input hero-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name this place"
              aria-label="Name this place"
            />
          }
          rating={
            // Dim stars mean not rated yet — the locked card's words. Staged like every
            // other field: nothing is written until Save.
            <StarRating value={rating} size={16} onChange={(n) => setRating(n)} />
          }
        />

        {/* 4. THE ADDRESS, prefilled from where you tapped and editable, then the sub-line
            saying what this is in plain words. */}
        <div className="meta">
          {editingAddress ? (
            <div className="place-locate bucket-search">
              <MapSearch placeholder="Search an address or place…" onPick={pickLocation} />
            </div>
          ) : (
            <span>
              <span className="region-directions">
                {address || [admin1, country].filter(Boolean).join(', ') || 'Where you tapped'}
              </span>
              <button className="link-btn region-edit-btn" onClick={() => setEditingAddress(true)}>
                edit
              </button>
            </span>
          )}
          <div className="npd-coords label">
            {lat.toFixed(5)}, {lng.toFixed(5)} · {wanted ? 'not visited yet' : 'this is visit one'}
          </div>
        </div>

        {dupes.length > 0 && (
          <div className="npd-dupes">
            <b>
              Possible duplicate{dupes.length > 1 ? 's' : ''} within{' '}
              {radius >= 1000
                ? `${(radius / 1000).toFixed(radius % 1000 ? 1 : 0)} km`
                : `${radius} m`}
              :
            </b>
            {dupes.map((p) => (
              <button key={p.id} className="npd-dupe" onClick={() => void addToExisting(p)}>
                {p.name} · {Math.round(haversineMeters({ lat, lng }, { lat: p.lat, lng: p.lng }))} m
                — {visitDate || files.length ? 'add my visit here' : 'use this'}
              </button>
            ))}
            <span className="label">
              …or fill in the fields below and Save to create a separate place.
            </span>
          </div>
        )}

        {/* 5. CATEGORY TAGS AS PILLS — never city or region. The whole palette is offered
            here, because on a blank card every one of them is still a choice. */}
        <div className="cat-pills">
          {MANUAL_CATEGORIES.filter((c) => !NOT_A_TAG.has(c.slug)).map((c) => {
            const on = tags.includes(c.slug);
            return (
              <button
                key={c.slug}
                type="button"
                className={`cat-pill${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() =>
                  setTags((t) => (on ? t.filter((x) => x !== c.slug) : [...t, c.slug]))
                }
              >
                {categoryLabel(c.slug)}
              </button>
            );
          })}
        </div>

        {/* ASKED ONCE, AND ONLY HERE. A trail is the one kind of place that is not obvious
            from where you tapped: it is a container whose SECTIONS are the places that
            count, so answering yes changes what the rest of this card means. The answer is
            not stored twice — it sets the `trail` tag, which is what makes a place a trail,
            and the pills above do not offer it.

            "Part of a trail?" was DELETED here on 2026-08-28 at Erica's instruction: the
            toggle is what labels a trail, and one card asked about trails twice. */}
        <div className="npd-ask">
          <span>Is this a trail with sections?</span>
          <div className="ps-who-toggle">
            <button type="button" className={isTrail ? '' : 'on'} onClick={() => setIsTrail(false)}>
              No
            </button>
            <button type="button" className={isTrail ? 'on' : ''} onClick={() => setIsTrail(true)}>
              Yes
            </button>
          </div>
        </div>
        {isTrail && (
          <span className="label">
            Its sections are the places that count — this one holds them together.
          </span>
        )}

        {/* ───────── THE SECTIONS, in the locked order, each saying what will fill it ───────── */}

        <h3 style={{ marginTop: 22 }}>
          Visits <span className="label">{wanted ? 'none yet' : 'this is visit one'}</span>
        </h3>
        {wanted ? (
          <div className="npd-fill">
            Somewhere to go later has no visit yet — add one after you have been.
          </div>
        ) : (
          <div className="npd-visit-one">
            <label className="npd-field">
              <span>{isTrail ? 'Date you walked it (optional)' : 'Date'}</span>
              <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
            </label>
            <div className="npd-field">
              <span>Who was there</span>
              <div className="ps-who-toggle">
                {choices.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={who === c.key ? 'on' : ''}
                    onClick={() => setWho(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <h3 style={{ marginTop: 22 }}>
          Photos and Videos{' '}
          {files.length > 0 && <span className="label">({files.length} to add)</span>}
        </h3>
        <div className="btn-row">
          {googlePhotosEnabled() && (
            <button
              onClick={() =>
                void pickFromGooglePhotos((s) => setBusy(s))
                  .then((f) => {
                    setBusy(null);
                    setFiles((cur) => [...cur, ...f]);
                  })
                  .catch(() => setBusy(null))
              }
            >
              Google Photos
            </button>
          )}
          <button onClick={() => fileRef.current?.click()}>Choose photos</button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const f = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = '';
              setFiles((cur) => [...cur, ...f]);
            }}
          />
        </div>

        <h3 style={{ marginTop: 22 }}>Routes</h3>
        {isTrail ? (
          <div className="npd-field">
            <span>Its route</span>
            <div className="ps-who-toggle">
              <button
                type="button"
                className={drawAfter ? '' : 'on'}
                onClick={() => setDrawAfter(false)}
              >
                Not now
              </button>
              <button
                type="button"
                className={drawAfter ? 'on' : ''}
                onClick={() => setDrawAfter(true)}
              >
                Draw it after saving
              </button>
            </div>
          </div>
        ) : (
          <div className="npd-fill">Added once this first visit is saved</div>
        )}

        <h3 style={{ marginTop: 22 }}>Restaurants</h3>
        <div className="npd-fill">Added once this first visit is saved</div>

        <h3 style={{ marginTop: 22 }}>NOTES AND REVIEWS</h3>
        <div className="npd-fill">Write a note or review — once this first visit is saved</div>

        {/* Official details sit last: they enrich a place that already has a name, and on
            the locked card nothing about them belongs above the sections. */}
        <div className="npd-field" style={{ marginTop: 18 }}>
          <span>Official details</span>
          <button type="button" onClick={() => void lookupPoi()} disabled={!!busy}>
            Look up name &amp; website
          </button>
          {poi && (poi.name || poi.website || poi.category) ? (
            <div className="npd-poi">
              {poi.name && poi.name !== name && (
                <button type="button" className="npd-dupe" onClick={() => setName(poi.name!)}>
                  Use name: {poi.name}
                </button>
              )}
              {poi.website && (
                <button type="button" className="npd-dupe" onClick={() => setWebsite(poi.website)}>
                  Use website: {poi.website}
                </button>
              )}
              {poi.category && <div className="label">Type: {poi.category}</div>}
            </div>
          ) : poiChecked ? (
            <div className="label">No extra details found for this place.</div>
          ) : null}
          {website && <div className="npd-current label">Website: {website}</div>}
        </div>

        {/* 7. THE FOOTER. On the blank card: Save · Cancel. */}
        {busy && <div className="label">{busy}</div>}
        <div className="btn-row npd-footer">
          <button className="primary" disabled={!!busy} onClick={() => void save()}>
            {wanted ? 'Save to the list' : 'Save'}
          </button>
          <button onClick={requestCancel} disabled={!!busy}>
            Cancel
          </button>
        </div>
      </aside>
    </div>
  );
}
