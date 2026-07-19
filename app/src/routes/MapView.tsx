import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import maplibregl, { type GeoJSONSource, type MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAPTILER_STYLE_URL, forwardGeocode, reverseGeocode } from '../lib/maptiler';
import { createPlace, fetchPlaces, triggerGeocode } from '../lib/data';
import { readGps, uploadPhoto } from '../lib/photos';
import { fetchPlaceCounts, type PlaceCount } from '../lib/strava';
import { isInHomeZone } from '../lib/geo';
import { CATEGORIES, categoryColor, effectiveCategories, primaryCategory } from '../lib/categories';
import type { Place } from '../lib/types';
import StatsBar from '../components/StatsBar';
import PlacePanel from '../components/PlacePanel';
import UnassignedTray from '../components/UnassignedTray';

const SOURCE_ID = 'places';

function toFeatureCollection(
  places: Place[],
  counts: Map<string, PlaceCount>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: places.map((p) => {
      const c = counts.get(p.id);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: {
          id: p.id,
          name: p.name,
          country: p.country ?? '',
          first_visit: p.first_visit ?? '',
          last_visit: p.last_visit ?? '',
          photos: c?.photo_count ?? 0,
          routes: c?.route_count ?? 0,
          color: categoryColor(primaryCategory(p)),
        },
      };
    }),
  };
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const addModeRef = useRef(false);
  const countsRef = useRef<Map<string, PlaceCount>>(new Map());
  const prevSelRef = useRef<string | null>(null);

  const [places, setPlaces] = useState<Place[]>([]);
  const [ready, setReady] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [searching, setSearching] = useState(false);
  const [filterCat, setFilterCat] = useState<string | null>(null);

  const [trayNonce, setTrayNonce] = useState(0);

  const navigate = useNavigate();
  const { id: selectedId } = useParams();
  const selectedPlace = places.find((p) => p.id === selectedId) ?? null;

  addModeRef.current = addMode;

  // Push new source data whenever the places list changes.
  const syncSource = useCallback((rows: Place[]) => {
    const map = mapRef.current;
    if (!map || !map.getSource(SOURCE_ID)) return;
    (map.getSource(SOURCE_ID) as GeoJSONSource).setData(
      toFeatureCollection(rows, countsRef.current),
    );
  }, []);

  // Initial data load — places, plus per-place photo/route counts for popups.
  useEffect(() => {
    fetchPlaces()
      .then(setPlaces)
      .catch((e) => setBanner(e instanceof Error ? e.message : 'Failed to load places'));
    fetchPlaceCounts()
      .then((c) => {
        countsRef.current = c;
        syncSource(places);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time map init.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAPTILER_STYLE_URL,
      center: [0, 20],
      zoom: 1.4,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    map.on('load', () => {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        promoteId: 'id',
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 45,
      });

      // Soft glow beneath clusters.
      map.addLayer({
        id: 'cluster-glow',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#3b82f6',
          'circle-opacity': 0.28,
          'circle-blur': 1,
          'circle-radius': ['step', ['get', 'point_count'], 26, 10, 34, 50, 44],
        },
      });
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#3b82f6',
          'circle-opacity': 0.95,
          'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 50, 30],
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(200,230,255,0.7)',
        },
      });
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Open Sans Bold', 'Noto Sans Bold'],
          'text-size': 13,
        },
        paint: { 'text-color': '#05121f' },
      });
      // Highlight ring under the selected pin.
      map.addLayer({
        id: 'pin-highlight',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['get', 'id'], '__none__'],
        paint: {
          'circle-radius': 24,
          'circle-color': '#3b82f6',
          'circle-opacity': 0.3,
          'circle-blur': 0.5,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#60a5fa',
        },
      });
      // Soft category-colored glow under each place.
      map.addLayer({
        id: 'place-glow',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': 15,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.28,
          'circle-blur': 1,
        },
      });
      // Color-coded place markers (grow when selected). Reliable circles — no
      // fragile icon images.
      map.addLayer({
        id: 'place-pins',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 9, 7],
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffffff',
        },
      });
      // Transparent hit target on top so taps ALWAYS land on a place.
      map.addLayer({
        id: 'place-hit',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': 20,
          'circle-color': '#000',
          'circle-opacity': 0,
        },
      });

      setReady(true);
    });

    // Zoom into a cluster on click.
    map.on('click', 'clusters', (e) => {
      const feature = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
      const clusterId = feature.properties?.cluster_id;
      const src = map.getSource(SOURCE_ID) as GeoJSONSource;
      void src.getClusterExpansionZoom(clusterId).then((zoom) => {
        map.easeTo({
          center: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
          zoom,
        });
      });
    });

    // Select a place on click.
    map.on('click', 'place-hit', (e) => {
      const f = e.features?.[0] as MapGeoJSONFeature | undefined;
      const id = f?.properties?.id as string | undefined;
      if (id) navigate(`/place/${id}`);
    });

    // Click handling: our pins are handled above. Otherwise, if you clicked a
    // city / POI label on the basemap, make a place there (prefilled with its
    // name); an empty-map click only adds a place while in add mode.
    map.on('click', (e) => {
      const ours = map.queryRenderedFeatures(e.point, { layers: ['clusters', 'place-hit'] });
      if (ours.length > 0) return;

      const label = map.queryRenderedFeatures(e.point).find((f) => {
        const lid = f.layer.id;
        return (
          f.geometry.type === 'Point' &&
          f.properties &&
          (f.properties.name || f.properties['name:en'] || f.properties.name_en) &&
          !['cluster-count', 'place-pins', 'place-hit'].includes(lid)
        );
      });
      if (label) {
        const nm = (label.properties!.name ||
          label.properties!['name:en'] ||
          label.properties!.name_en) as string;
        void handleAddAt(e.lngLat.lng, e.lngLat.lat, nm);
        return;
      }

      if (!addModeRef.current) return;
      void handleAddAt(e.lngLat.lng, e.lngLat.lat);
    });

    // Hover popup on points.
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
    popupRef.current = popup;

    map.on('mouseenter', 'place-hit', (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as Record<string, string>;
      const dates = [p.first_visit, p.last_visit].filter(Boolean).join(' → ') || 'No dates yet';
      const html = `
        <div class="popup-name">${escapeHtml(p.name)}</div>
        <div class="popup-meta">${escapeHtml(dates)}</div>
        <div class="popup-chips">
          <span class="chip">📷 ${Number(p.photos) || 0}</span>
          <span class="chip">🥾 ${Number(p.routes) || 0}</span>
        </div>`;
      popup
        .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
        .setHTML(html)
        .addTo(map);
    });
    map.on('mouseleave', 'place-hit', () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });
    map.on('mouseenter', 'clusters', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'clusters', () => (map.getCanvas().style.cursor = ''));

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter the map by the selected tag (default: all places).
  const visiblePlaces = filterCat
    ? places.filter((p) => effectiveCategories(p).includes(filterCat))
    : places;

  // Keep the source in sync once both map and data are ready.
  useEffect(() => {
    if (ready) syncSource(visiblePlaces);
  }, [ready, visiblePlaces, syncSource]);

  // Highlight the selected pin (ring + enlarge via feature-state).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (map.getLayer('pin-highlight')) {
      map.setFilter('pin-highlight', ['==', ['get', 'id'], selectedId ?? '__none__']);
    }
    const prev = prevSelRef.current;
    if (prev && prev !== selectedId) {
      map.setFeatureState({ source: SOURCE_ID, id: prev }, { selected: false });
    }
    if (selectedId) map.setFeatureState({ source: SOURCE_ID, id: selectedId }, { selected: true });
    prevSelRef.current = selectedId ?? null;
  }, [selectedId, ready, places]);

  async function handleAddAt(lng: number, lat: number, presetName?: string) {
    setAddMode(false);
    if (isInHomeZone({ lng, lat })) {
      setBanner('That spot is inside the 15-mile home zone — places there are not tracked.');
      return;
    }
    setBanner('Adding that place…');
    // Use the clicked label's name if we have it; otherwise reverse-geocode.
    const geo = presetName ? null : await reverseGeocode(lng, lat);
    try {
      const created = await createPlace({
        name: presetName ?? geo?.name ?? 'New place',
        country: geo?.country ?? null,
        admin1: geo?.admin1 ?? null,
        lng,
        lat,
      });
      setPlaces((prev) => [...prev, created]);
      setBanner(null);
      navigate(`/place/${created.id}`);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'Could not create place');
    }
  }

  // Add photos: geotagged ones auto-place by GPS; photos WITHOUT a location get
  // a fresh card (placed at the current map center) so you can set the spot.
  async function handleAddPhotos(files: FileList) {
    setBanner('Uploading photos…');
    let added = 0;
    const noLoc: File[] = [];
    for (const f of Array.from(files)) {
      const gps = await readGps(f);
      if (gps) {
        try {
          const r = await uploadPhoto(f);
          if (r.ok) added++;
        } catch {
          /* ignore per-file */
        }
      } else {
        noLoc.push(f);
      }
    }

    // Photos with no location → one new card at the map center to place manually.
    let newPlaceId: string | null = null;
    if (noLoc.length > 0) {
      const ctr = mapRef.current?.getCenter();
      const lat = ctr?.lat ?? 39;
      const lng = ctr?.lng ?? -77;
      try {
        const created = await createPlace({
          name: 'New place',
          country: null,
          admin1: null,
          lat,
          lng,
        });
        newPlaceId = created.id;
        for (const f of noLoc) {
          await uploadPhoto(f, { placeId: created.id, lat, lng, override: true }).catch(
            () => undefined,
          );
        }
      } catch {
        /* ignore */
      }
    }

    if (added > 0) await triggerGeocode().catch(() => undefined);
    const rows = await fetchPlaces().catch(() => places);
    setPlaces(rows);
    await fetchPlaceCounts()
      .then((c) => {
        countsRef.current = c;
        syncSource(rows);
      })
      .catch(() => undefined);
    setTrayNonce((n) => n + 1);

    if (newPlaceId) {
      setBanner('Set this place’s location using the address box on the card.');
      navigate(`/place/${newPlaceId}`);
    } else {
      setBanner(
        added > 0 ? `Added ${added} photo${added > 1 ? 's' : ''} to the map.` : 'No photos added.',
      );
    }
  }

  // Add a place by typing an address / place name (no map click needed).
  async function handleAddByAddress() {
    const q = address.trim();
    if (!q) return;
    setSearching(true);
    setBanner('Finding that address…');
    const geo = await forwardGeocode(q);
    if (!geo) {
      setBanner(`Couldn't find "${q}". Try a more specific address or place name.`);
      setSearching(false);
      return;
    }
    if (isInHomeZone({ lng: geo.lng, lat: geo.lat })) {
      setBanner('That address is inside the 15-mile home zone — places there are not tracked.');
      setSearching(false);
      return;
    }
    try {
      const created = await createPlace({
        name: geo.name,
        country: geo.country,
        admin1: geo.admin1,
        lng: geo.lng,
        lat: geo.lat,
      });
      setPlaces((prev) => [...prev, created]);
      setAddress('');
      setAddMode(false);
      setBanner(null);
      mapRef.current?.flyTo({ center: [geo.lng, geo.lat], zoom: 12 });
      navigate(`/place/${created.id}`);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'Could not create place');
    }
    setSearching(false);
  }

  function handlePlaceChanged(updated: Place) {
    setPlaces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  function handlePlaceDeleted(id: string) {
    setPlaces((prev) => prev.filter((p) => p.id !== id));
    navigate('/');
  }

  // A merge removes the loser and updates the winner's aggregates. Re-fetch to
  // pick up recomputed visit stats / cover photo from the server.
  function handleMerged(loserId: string, winner: Place) {
    setPlaces((prev) => prev.filter((p) => p.id !== loserId));
    fetchPlaces()
      .then(setPlaces)
      .catch(() => undefined);
    navigate(`/place/${winner.id}`);
  }

  return (
    <div className="map-root">
      <div ref={containerRef} className="map-canvas" />

      <StatsBar
        places={places}
        addMode={addMode}
        onToggleAdd={() => setAddMode((v) => !v)}
        onAddPhotos={handleAddPhotos}
      />

      <div className="tag-filter">
        <span className="tag-filter-ico">🔍</span>
        <select value={filterCat ?? ''} onChange={(e) => setFilterCat(e.target.value || null)}>
          <option value="">All places</option>
          {CATEGORIES.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.icon} {c.label}
            </option>
          ))}
        </select>
      </div>

      {addMode && (
        <div className="add-bar">
          <input
            autoFocus
            placeholder="Type an address or place name…"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleAddByAddress()}
          />
          <button
            className="primary"
            disabled={searching || !address.trim()}
            onClick={() => void handleAddByAddress()}
          >
            {searching ? 'Finding…' : 'Add'}
          </button>
          <span className="add-hint">or click the map</span>
        </div>
      )}

      {banner && (
        <div
          className="banner"
          style={{ position: 'absolute', top: 58, left: 14, right: 14, zIndex: 6, maxWidth: 520 }}
        >
          {banner}
        </div>
      )}

      <UnassignedTray
        key={trayNonce}
        places={places}
        onChanged={() => setTrayNonce((n) => n + 1)}
      />

      {selectedPlace && (
        <PlacePanel
          place={selectedPlace}
          allPlaces={places}
          onClose={() => navigate('/')}
          onPlaceChanged={handlePlaceChanged}
          onPlaceDeleted={handlePlaceDeleted}
          onMerged={handleMerged}
        />
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
