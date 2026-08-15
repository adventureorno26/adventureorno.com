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
import MapSearch from './MapSearch';
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
  const [partOf, setPartOf] = useState('');
  const trails = places.filter((p) => p.is_trail).sort((a, b) => a.name.localeCompare(b.name));
  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [admin1, setAdmin1] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [visitDate, setVisitDate] = useState('');
  const [who, setWho] = useState<Who>('both');
  const [website, setWebsite] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  // Asked once, here only (§0.6): "Is this a trail with sections?" — and having said
  // yes, the offer to draw its reference route straight away.
  const [drawAfter, setDrawAfter] = useState(false);
  const [poi, setPoi] = useState<PoiDetails | null>(null);
  const [poiChecked, setPoiChecked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const choices = whoChoices(people, meId, { everyone: 'together' });
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
          part_of: partOf ? [partOf] : undefined,
        },
        !wanted && visitDate && !files.length ? { date: visitDate, who: whoParam() } : {},
      );
      const placeId = res.place_id;

      // Enrichments create_experience doesn't own.
      if (website) await updatePlace(placeId, { website }).catch(() => undefined);
      // Somewhere-to-go-later has no visit, so there is nothing to attribute.
      if (!wanted && who !== 'both') {
        // Not swallowed: losing this silently means the place is saved and
        // attributed to the wrong people, with nothing on screen to say so.
        await setPlaceSolo(placeId, whoProfileId(who, meId)).catch((e: unknown) => {
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
  // a trip is a visit you marked, not a kind of place (docs/SCHEMA.md). Trail is the
  // one container a person sets by hand, and it is set by the question above — asking
  // again here would be asking twice.
  const NOT_A_TAG = new Set(['city', 'region', 'trip', 'trail']);
  const avail = MANUAL_CATEGORIES.filter((c) => !tags.includes(c.slug) && !NOT_A_TAG.has(c.slug));

  // Guard against losing entered work: confirm before closing a dirty draft.
  const dirty = !!name.trim() || files.length > 0 || !!visitDate || tags.length > 0 || !!website;
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
      <div
        className="npd-card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="New place"
        tabIndex={-1}
      >
        {/* THE COVER, exactly where the saved card has it (§0.6: cover, then name).
            It is a real control — it opens the same picker the Photos section uses —
            not a label pretending to be one. Photos chosen here are attached on Save,
            and the first becomes the cover. */}
        <div className="npd-cover">
          <button type="button" className="npd-cover-btn" onClick={() => fileRef.current?.click()}>
            {files.length > 0
              ? `${files.length} photo${files.length === 1 ? '' : 's'} — the first is the cover`
              : 'Add a cover photo'}
          </button>
          <button className="npd-x" onClick={requestCancel} aria-label="Cancel">
            ×
          </button>
        </div>
        <div className="npd-head">
          <b>{wanted ? 'Somewhere to go later' : 'A place you have been'}</b>
        </div>

        <label className="npd-row">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this place"
          />
        </label>

        <div className="npd-row">
          <span>Location</span>
          <MapSearch placeholder="Search an address or place…" onPick={pickLocation} />
          <div className="npd-coords label">
            {lat.toFixed(5)}, {lng.toFixed(5)}
            {[admin1, country].filter(Boolean).length
              ? ` · ${[admin1, country].filter(Boolean).join(', ')}`
              : ''}
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

        <div className="npd-row">
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

        {/* ASKED ONCE, AND ONLY HERE (§0.6). A trail is the one kind of place that is
            not obvious from where you tapped: it is a container whose SECTIONS are the
            places that count, so answering yes changes what the rest of this card
            means. The answer is not stored twice — it sets the `trail` tag, which is
            what makes a place a trail, and the tag list below no longer offers it. */}
        <div className="npd-row">
          <span>Is this a trail with sections?</span>
          <div className="ps-who-toggle">
            <button type="button" className={isTrail ? '' : 'on'} onClick={() => setIsTrail(false)}>
              No
            </button>
            <button type="button" className={isTrail ? 'on' : ''} onClick={() => setIsTrail(true)}>
              Yes
            </button>
          </div>
          {isTrail && (
            <span className="label">
              Its sections are the places that count — this one holds them together.
            </span>
          )}
        </div>

        {!wanted && (
          <div className="npd-row">
            {/* A trail can exist before you have walked any of it, so its date is
                genuinely optional: with no date, no visit is logged. */}
            <span>{isTrail ? 'Date you walked it (optional)' : 'Visit date'}</span>
            <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
          </div>
        )}

        {isTrail && (
          <div className="npd-row">
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
        )}

        <div className="npd-row">
          <span>What is it?</span>
          <div className="pe-chips">
            {tags.map((slug) => (
              <button
                key={slug}
                type="button"
                className="pe-chip"
                onClick={() => setTags((t) => t.filter((c) => c !== slug))}
              >
                {categoryLabel(slug)} ×
              </button>
            ))}
          </div>
          {avail.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && setTags((t) => [...t, e.target.value])}
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

        {/* Where does it belong? Nothing, or a trail. Cities and regions attach by
            boundary, so they are never asked. Hidden entirely when no trail exists
            — an empty question is still a question. */}
        {trails.length > 0 && !tags.includes('trail') && (
          <div className="npd-row">
            <span>Part of a trail?</span>
            <select value={partOf} onChange={(e) => setPartOf(e.target.value)}>
              <option value="">Nothing</option>
              {trails.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {!wanted && (
          <div className="npd-row">
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
        )}

        <div className="npd-row">
          <span>Photos {files.length ? `(${files.length})` : ''}</span>
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
        </div>

        {busy && <div className="label">{busy}</div>}
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="primary" disabled={!!busy} onClick={() => void save()}>
            {wanted ? 'Save to the list' : 'Save place'}
          </button>
          <button onClick={requestCancel} disabled={!!busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
