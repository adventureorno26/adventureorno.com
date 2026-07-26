import { useEffect, useMemo, useRef, useState } from 'react';
import { createPlace, fetchPoiDetails, setPlaceSolo, type PoiDetails } from '../lib/data';
import type { MapPerson } from '../lib/data';
import { mapPool, uploadPhoto } from '../lib/photos';
import { reverseGeocode, type SearchResult } from '../lib/maptiler';
import { googlePhotosEnabled, pickFromGooglePhotos } from '../lib/googlePhotos';
import { haversineMeters } from '../lib/geo';
import { MANUAL_CATEGORIES, categoryLabel } from '../lib/categories';
import MapSearch from './MapSearch';
import type { Place } from '../lib/types';

type Who = 'both' | 'mine' | 'josh';

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
}: {
  initialLat: number;
  initialLng: number;
  presetName?: string;
  places: Place[];
  people: MapPerson[];
  meId: string | null;
  onSaved: (placeId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(presetName ?? '');
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
  const [poi, setPoi] = useState<PoiDetails | null>(null);
  const [poiChecked, setPoiChecked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const joshId = people.find((p) => p.id !== meId)?.id ?? null;

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
      const created = await createPlace({
        name: name.trim() || 'New place',
        admin1,
        country,
        address,
        lat,
        lng,
        categories: tags,
        website,
        saved: true,
      });
      if (files.length) {
        setBusy(`Adding ${files.length} photo${files.length === 1 ? '' : 's'}…`);
        const takenAt = visitDate ? `${visitDate}T12:00:00Z` : undefined;
        await mapPool(
          files,
          (f) => uploadPhoto(f, { placeId: created.id, lat, lng, takenAt, override: true }).catch(() => null),
          4,
        );
      }
      if (who !== 'both') {
        const pid = who === 'mine' ? meId : joshId;
        await setPlaceSolo(created.id, pid ?? null).catch(() => undefined);
      }
      onSaved(created.id);
    } catch {
      setBusy(null);
    }
  }

  const avail = MANUAL_CATEGORIES.filter((c) => !tags.includes(c.slug));

  return (
    <div className="npd-overlay" role="dialog" aria-label="New place">
      <div className="npd-card">
        <div className="npd-head">
          <b>New place</b>
          <button className="npd-x" onClick={onCancel} aria-label="Cancel">
            ×
          </button>
        </div>

        <label className="npd-row">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        </label>

        <div className="npd-row">
          <span>Location</span>
          <MapSearch placeholder="Search an address or place…" onPick={pickLocation} />
          <div className="npd-coords label">
            {lat.toFixed(5)}, {lng.toFixed(5)}
            {[admin1, country].filter(Boolean).length ? ` · ${[admin1, country].filter(Boolean).join(', ')}` : ''}
          </div>
        </div>

        {dupes.length > 0 && (
          <div className="npd-dupes">
            <b>
              Possible duplicate{dupes.length > 1 ? 's' : ''} within{' '}
              {radius >= 1000 ? `${(radius / 1000).toFixed(radius % 1000 ? 1 : 0)} km` : `${radius} m`}:
            </b>
            {dupes.map((p) => (
              <button key={p.id} className="npd-dupe" onClick={() => onSaved(p.id)}>
                {p.name} · {Math.round(haversineMeters({ lat, lng }, { lat: p.lat, lng: p.lng }))} m —
                use this
              </button>
            ))}
            <span className="label">…or fill in the fields below and Save to create a separate place.</span>
          </div>
        )}

        <div className="npd-row">
          <span>Official details (OpenStreetMap)</span>
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
                <button
                  type="button"
                  className="npd-dupe"
                  onClick={() => setWebsite(poi.website)}
                >
                  Use website: {poi.website}
                </button>
              )}
              {poi.category && <div className="label">OSM type: {poi.category}</div>}
            </div>
          ) : poiChecked ? (
            <div className="label">No extra details found for this spot.</div>
          ) : null}
          {website && <div className="npd-current label">Website: {website}</div>}
        </div>

        <div className="npd-row">
          <span>Visit date</span>
          <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
        </div>

        <div className="npd-row">
          <span>Tags</span>
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
            <select value="" onChange={(e) => e.target.value && setTags((t) => [...t, e.target.value])}>
              <option value="">+ tag</option>
              {avail.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="npd-row">
          <span>Who was there</span>
          <div className="ps-who-toggle">
            {(['both', 'mine', 'josh'] as const).map((k) => (
              <button key={k} type="button" className={who === k ? 'on' : ''} onClick={() => setWho(k)}>
                {k === 'both' ? 'Both' : k === 'mine' ? 'Just me' : 'Just Josh'}
              </button>
            ))}
          </div>
        </div>

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
            Save place
          </button>
          <button onClick={onCancel} disabled={!!busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
