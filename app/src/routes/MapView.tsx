import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import polyline from '@mapbox/polyline';
import {
  MAPTILER_STYLE_URL,
  forwardGeocode,
  reverseGeocode,
  snapWalkingRoute,
  type SearchResult,
} from '../lib/maptiler';
import {
  createPlace,
  deletePlace,
  fetchMapPeople,
  fetchPlaces,
  fetchVisits,
  triggerGeocode,
  type MapPerson,
} from '../lib/data';
import { fetchPhotoObjectUrl, mapPool, readGps, uploadPhoto } from '../lib/photos';
import { googlePhotosEnabled, pickFromGooglePhotos } from '../lib/googlePhotos';
import {
  createManualActivity,
  fetchActivityLines,
  fetchPlaceCounts,
  type PlaceCount,
} from '../lib/strava';
import { haversineMeters } from '../lib/geo';
import { CATEGORIES, categoryColor, effectiveCategories, primaryCategory } from '../lib/categories';
import type { Place } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import StatsBar from '../components/StatsBar';
import PlacePanel from '../components/PlacePanel';
import UnassignedTray from '../components/UnassignedTray';
import MapSearch from '../components/MapSearch';
import OnThisDay from '../components/OnThisDay';
import PersonFilter from '../components/PersonFilter';
import SearchPalette from '../components/SearchPalette';
import MemoryBanner from '../components/MemoryBanner';

const SOURCE_ID = 'places';

// A place's effective cover photo — its own, or (for a trail) a trailhead's.
function effectiveCover(p: Place, all: Place[]): string | null {
  if (p.cover_photo_id) return p.cover_photo_id;
  if (p.is_trail)
    return all.find((x) => x.trail_id === p.id && x.cover_photo_id)?.cover_photo_id ?? null;
  return null;
}

function toFeatureCollection(places: Place[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: places.map((p) => {
      const cover = effectiveCover(p, places);
      const primary = primaryCategory(p);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: {
          id: p.id,
          photo: cover ? 1 : 0,
          icon: cover ? `ph-${cover}` : '',
          color: categoryColor(primary),
          // White type indicator on no-photo pins (D=Dining, W=Winery, …).
          glyph: cover || primary === 'default' ? '' : primary.charAt(0).toUpperCase(),
        },
      };
    }),
  };
}

// Cache of thumbnail object URLs, keyed by photo id (shared across the module).
const coverUrlCache = new Map<string, string>();
async function coverUrl(photoId: string): Promise<string> {
  const cached = coverUrlCache.get(photoId);
  if (cached) return cached;
  const url = await fetchPhotoObjectUrl(photoId, 'thumb');
  coverUrlCache.set(photoId, url);
  return url;
}

// Render a place's cover thumbnail into a circular map icon (white ring).
async function circleIcon(photoId: string): Promise<ImageData | null> {
  try {
    const url = await coverUrl(photoId);
    const img = new Image();
    img.src = url;
    await img.decode();
    const S = 100;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 5, 0, Math.PI * 2);
    ctx.clip();
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 4, 4, S - 8, S - 8);
    ctx.restore();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2);
    ctx.stroke();
    return ctx.getImageData(0, 0, S, S);
  } catch {
    return null;
  }
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const addModeRef = useRef(false);
  const countsRef = useRef<Map<string, PlaceCount>>(new Map());

  const placesRef = useRef<Place[]>([]);
  // Placeholder pins created by a map tap — auto-removed on close if left empty.
  const pendingRef = useRef<Set<string>>(new Set());
  const navigateRef = useRef<(to: string) => void>(() => undefined);

  const [places, setPlaces] = useState<Place[]>([]);
  const [ready, setReady] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [searching, setSearching] = useState(false);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  // "Just me / Just Josh / Both" filter (null = both).
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [people, setPeople] = useState<MapPerson[]>([]);
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [activitySub, setActivitySub] = useState(false);
  const [activityFilter, setActivityFilter] = useState('');
  const [photoSub, setPhotoSub] = useState(false);
  const addFileRef = useRef<HTMLInputElement | null>(null);
  // Google Photos import is owner-only (Erica), web, and only if configured.
  const canGooglePhotos = profile?.role === 'owner' && googlePhotosEnabled();

  async function importGooglePhotos() {
    setPhotoSub(false);
    setAddMenuOpen(false);
    try {
      const files = await pickFromGooglePhotos((s) => setBanner(s));
      if (files.length) await handleAddPhotos(files);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'Google Photos import failed');
    }
  }

  // +Add → a category/activity: create an empty place pre-tagged, open its card.
  // The card's title-search fills name + location (placeholder shows an example).
  async function addTagged(tag: string) {
    setAddMenuOpen(false);
    setActivitySub(false);
    const c = mapRef.current?.getCenter();
    try {
      const p = await createPlace({
        name: '',
        country: null,
        admin1: null,
        lat: c?.lat ?? 39.5,
        lng: c?.lng ?? -98.5,
        categories: [tag],
        saved: false,
      });
      // Add to state so the card renders immediately (no waiting / map click).
      setPlaces((prev) => [...prev, p]);
      navigate(`/place/${p.id}`);
    } catch {
      setBanner('Could not add — try again.');
    }
  }

  // Draw-a-trail mode: tap the map to add waypoints; segments snap to walking paths.
  const [drawMode, setDrawMode] = useState(false);
  const [drawName, setDrawName] = useState('');
  const [drawType, setDrawType] = useState('Hike');
  const [drawDist, setDrawDist] = useState(0);
  const [drawCount, setDrawCount] = useState(0);
  const [drawBusy, setDrawBusy] = useState(false);
  const drawModeRef = useRef(false);
  const drawPtsRef = useRef<[number, number][]>([]);
  const drawLineRef = useRef<[number, number][]>([]);
  const drawEncodedRef = useRef<string | null>(null);
  const drawTargetRef = useRef<string | null>(null); // attach the drawn route to this place
  const addDrawPointRef = useRef<(lng: number, lat: number) => void>(() => undefined);
  drawModeRef.current = drawMode;

  const [trayNonce, setTrayNonce] = useState(0);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { id: selectedId } = useParams();
  const selectedPlace = places.find((p) => p.id === selectedId) ?? null;

  addModeRef.current = addMode;
  navigateRef.current = navigate;
  placesRef.current = places;

  const syncSource = useCallback((rows: Place[]) => {
    const map = mapRef.current;
    if (!map || !map.getSource(SOURCE_ID)) return;
    (map.getSource(SOURCE_ID) as GeoJSONSource).setData(toFeatureCollection(rows));
  }, []);

  const showPopup = useCallback((place: Place, coords: [number, number]) => {
    const map = mapRef.current;
    const popup = popupRef.current;
    if (!map || !popup) return;
    const c = countsRef.current.get(place.id);
    const dates =
      [place.first_visit, place.last_visit].filter(Boolean).join(' → ') || 'No dates yet';
    popup
      .setLngLat(coords)
      .setHTML(
        `<div class="popup-name">${escapeHtml(place.name)}</div>
         <div class="popup-meta">${escapeHtml(dates)}</div>
         <div class="popup-chips">
           <span class="chip">📷 ${c?.photo_count ?? 0}</span>
           <span class="chip">🥾 ${c?.route_count ?? 0}</span>
         </div>`,
      )
      .addTo(map);
  }, []);


  // Initial data load — places + per-place photo/route counts for popups.
  useEffect(() => {
    fetchPlaces()
      .then(setPlaces)
      .catch((e) => setBanner(e instanceof Error ? e.message : 'Failed to load places'));
    fetchPlaceCounts()
      .then((c) => {
        countsRef.current = c;
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The two people, for the "just me" filter + attribution.
  useEffect(() => {
    void fetchMapPeople().then(setPeople).catch(() => undefined);
  }, [places.length]);

  // Draw every activity's route line on the main map (tap a line → its place card).
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;
    const TYPE_COLOR: Record<string, string> = {
      Hike: '#4dd07a',
      Walk: '#22d3ee',
      Run: '#ff8a3d',
      Ride: '#c98bff',
    };
    // Both = post-cutoff routes; a person = their full history (pre-cutoff too).
    void fetchActivityLines(personFilter)
      .then((lines) => {
        const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
        for (const l of lines) {
          let coords: [number, number][] = [];
          try {
            coords = polyline.decode(l.summary_polyline).map(([la, ln]) => [ln, la] as [number, number]);
          } catch {
            continue;
          }
          if (coords.length < 2) continue;
          features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: { place_id: l.place_id, color: TYPE_COLOR[l.type] ?? '#3b82f6' },
          });
        }
        (map.getSource('trailroutes') as GeoJSONSource | undefined)?.setData({
          type: 'FeatureCollection',
          features,
        });
      })
      .catch(() => undefined);
  }, [ready, places.length, personFilter]);

  // One-time map init.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAPTILER_STYLE_URL,
      // Open framed on the whole contiguous US (responsive to screen size).
      bounds: [
        [-125, 24.5],
        [-66.5, 49.5],
      ],
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    map.on('load', () => {
      // Trail/route lines render UNDER the place markers; tap a line to open its
      // place card (rename / merge / reassign there).
      map.addSource('trailroutes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'trailroutes-line',
        type: 'line',
        source: 'trailroutes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 4],
          'line-opacity': 0.85,
        },
      });
      map.on('click', 'trailroutes-line', (e) => {
        const pid = e.features?.[0]?.properties?.place_id as string | undefined;
        if (pid) navigateRef.current(`/place/${pid}`);
      });
      map.on('mouseenter', 'trailroutes-line', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'trailroutes-line', () => (map.getCanvas().style.cursor = ''));

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
      // Unclustered places WITHOUT a photo → a colored dot (GPU-rendered, so it
      // never drifts on zoom).
      map.addLayer({
        id: 'place-dots',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'photo'], 0]],
        paint: {
          'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 11, 8],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      });
      // White type letter centered on each no-photo pin (its category indicator).
      map.addLayer({
        id: 'place-glyphs',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'photo'], 0]],
        layout: {
          'text-field': ['get', 'glyph'],
          'text-font': ['Open Sans Bold', 'Noto Sans Bold'],
          'text-size': 11,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#fff' },
      });
      // Unclustered places WITH a photo → the cover as a circular symbol icon,
      // lazily generated in `styleimagemissing`. Symbols are part of the map, so
      // they stay anchored to their exact coordinates through any zoom.
      map.addLayer({
        id: 'place-photos',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'photo'], 1]],
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-size': 1,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
      map.on('styleimagemissing', (e) => {
        const iid = e.id;
        if (!iid || !iid.startsWith('ph-') || map.hasImage(iid)) return;
        // Reserve the id with a transparent placeholder so it doesn't refire,
        // then fill in the real circular thumbnail once it decodes.
        map.addImage(iid, { width: 100, height: 100, data: new Uint8Array(100 * 100 * 4) }, { pixelRatio: 2 });
        void circleIcon(iid.slice(3)).then((data) => {
          if (data && map.hasImage(iid)) map.updateImage(iid, data);
        });
      });
      for (const layer of ['place-dots', 'place-glyphs', 'place-photos'] as const) {
        map.on('click', layer, (e) => {
          const pid = e.features?.[0]?.properties?.id as string | undefined;
          if (pid) navigateRef.current(`/place/${pid}`);
        });
        map.on('mouseenter', layer, (e) => {
          map.getCanvas().style.cursor = 'pointer';
          const pid = e.features?.[0]?.properties?.id as string | undefined;
          const place = placesRef.current.find((p) => p.id === pid);
          if (place) showPopup(place, [place.lng, place.lat]);
        });
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = '';
          popupRef.current?.remove();
        });
      }

      // Draw-a-trail overlay (waypoints + snapped line).
      map.addSource('draw', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'draw-line',
        type: 'line',
        source: 'draw',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#f43f5e', 'line-width': 4, 'line-opacity': 0.9 },
      });
      map.addLayer({
        id: 'draw-pts',
        type: 'circle',
        source: 'draw',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#fff',
          'circle-stroke-color': '#f43f5e',
          'circle-stroke-width': 2,
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

    // Individual places are DOM markers (they handle their own clicks). A canvas
    // click that isn't on a cluster: create a place at a clicked city/POI label,
    // or (in add mode) at an empty spot.
    map.on('click', (e) => {
      // Draw-a-trail: every tap drops a waypoint (segments snap to walking paths).
      if (drawModeRef.current) {
        addDrawPointRef.current(e.lngLat.lng, e.lngLat.lat);
        return;
      }
      const onCluster = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
      if (onCluster.length > 0) return;
      // Tapped an existing place marker → its layer handler opens the card.
      if (
        map.queryRenderedFeatures(e.point, {
          layers: ['place-dots', 'place-glyphs', 'place-photos'],
        }).length > 0
      )
        return;

      const label = map.queryRenderedFeatures(e.point).find((f) => {
        const lid = f.layer.id;
        return (
          f.geometry.type === 'Point' &&
          f.properties &&
          (f.properties.name || f.properties['name:en'] || f.properties.name_en) &&
          !['cluster-count', 'place-dots', 'place-photos'].includes(lid)
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

    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 26,
    });

    map.on('mouseenter', 'clusters', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'clusters', () => (map.getCanvas().style.cursor = ''));

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter the map: bucket-list places are hidden unless their toggle is on;
  // visited places follow the selected activity tag and the person filter.
  const visiblePlaces = places.filter((p) => {
    if (p.bucket) return false; // bucket-list places live on the bucket page, not the main map
    if (!p.saved) return false; // only saved places appear on the map
    // "Just me / Just Josh" hides only places explicitly marked the OTHER person's.
    if (personFilter && p.solo_profile && p.solo_profile !== personFilter) return false;
    return !filterCat || effectiveCategories(p).includes(filterCat);
  });

  // Show the person filter once both people exist (test/bot excluded server-side).
  const filterPeople = people;

  // Keep the source in sync once both map and data are ready (idle → syncMarkers).
  useEffect(() => {
    if (ready) syncSource(visiblePlaces);
  }, [ready, visiblePlaces, syncSource]);

  // Deep link: /?cat=dining (tapping a category on a card) → filter the map to
  // that category and zoom to fit those photo-pins.
  useEffect(() => {
    const cat = searchParams.get('cat');
    if (!cat) return;
    setFilterCat(cat);
    const map = mapRef.current;
    if (!ready || !map) return;
    const pts = places.filter((p) => effectiveCategories(p).includes(cat));
    if (pts.length === 0) return;
    const b = new maplibregl.LngLatBounds();
    for (const p of pts) b.extend([p.lng, p.lat]);
    map.fitBounds(b, { padding: 80, maxZoom: 13, duration: 700 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, ready, places]);

  // Selected place: highlight its symbol/dot via feature-state.
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (prevSelectedRef.current) {
      map.setFeatureState({ source: SOURCE_ID, id: prevSelectedRef.current }, { selected: false });
    }
    if (selectedId) {
      map.setFeatureState({ source: SOURCE_ID, id: selectedId }, { selected: true });
    }
    prevSelectedRef.current = selectedId ?? null;
  }, [selectedId, ready]);

  // Opening a place (e.g. from the stats list) flies the map to its marker if it
  // isn't already on screen, so you always see the pin behind the card.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedPlace) return;
    const pt: [number, number] = [selectedPlace.lng, selectedPlace.lat];
    if (!map.getBounds().contains(pt)) {
      map.flyTo({ center: pt, zoom: Math.max(map.getZoom(), 11), duration: 800 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready]);

  // ---- Draw-a-trail mode -------------------------------------------------
  async function refreshDrawGeometry() {
    const map = mapRef.current;
    const pts = drawPtsRef.current;
    let lineCoords: [number, number][] = pts;
    let dist = 0;
    drawEncodedRef.current = null;
    if (pts.length >= 2) {
      const snapped = await snapWalkingRoute(pts);
      if (snapped) {
        lineCoords = polyline.decode(snapped.polyline).map(([la, ln]) => [ln, la] as [number, number]);
        dist = snapped.distance;
        drawEncodedRef.current = snapped.polyline;
      } else {
        for (let i = 1; i < pts.length; i++) {
          dist += haversineMeters(
            { lng: pts[i - 1][0], lat: pts[i - 1][1] },
            { lng: pts[i][0], lat: pts[i][1] },
          );
        }
      }
    }
    drawLineRef.current = lineCoords;
    setDrawDist(dist);
    const feats: GeoJSON.Feature[] = pts.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: p },
      properties: {},
    }));
    if (lineCoords.length >= 2) {
      feats.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: lineCoords },
        properties: {},
      });
    }
    (map?.getSource('draw') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: feats,
    });
  }

  async function addDrawPoint(lng: number, lat: number) {
    drawPtsRef.current = [...drawPtsRef.current, [lng, lat]];
    setDrawCount(drawPtsRef.current.length);
    await refreshDrawGeometry();
  }
  addDrawPointRef.current = addDrawPoint;

  function undoDrawPoint() {
    drawPtsRef.current = drawPtsRef.current.slice(0, -1);
    setDrawCount(drawPtsRef.current.length);
    void refreshDrawGeometry();
  }

  function exitDraw() {
    setDrawMode(false);
    drawPtsRef.current = [];
    drawLineRef.current = [];
    drawEncodedRef.current = null;
    drawTargetRef.current = null;
    setDrawCount(0);
    setDrawDist(0);
    setDrawName('');
    (mapRef.current?.getSource('draw') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: [],
    });
  }

  function nearestPlaceId(lng: number, lat: number, maxM: number): string | null {
    let best: string | null = null;
    let bestD = maxM;
    for (const p of placesRef.current) {
      const d = haversineMeters({ lng, lat }, { lng: p.lng, lat: p.lat });
      if (d < bestD) {
        bestD = d;
        best = p.id;
      }
    }
    return best;
  }

  async function saveDrawnTrail() {
    const pts = drawPtsRef.current;
    if (pts.length < 2) {
      setBanner('Tap at least two points to draw a trail.');
      return;
    }
    if (!drawName.trim()) {
      setBanner('Give the trail a name first.');
      return;
    }
    setDrawBusy(true);
    try {
      const encoded =
        drawEncodedRef.current ??
        polyline.encode(drawLineRef.current.map(([ln, la]) => [la, ln] as [number, number]));
      const [startLng, startLat] = pts[0];
      // If launched from a trail card, attach to that trail; else nearest place.
      let placeId = drawTargetRef.current ?? nearestPlaceId(startLng, startLat, 2000);
      if (!placeId) {
        const created = await createPlace({
          name: drawName.trim(),
          country: null,
          admin1: null,
          lng: startLng,
          lat: startLat,
          is_trail: true,
          saved: true,
        });
        placeId = created.id;
      }
      await createManualActivity({
        name: drawName.trim(),
        type: drawType,
        placeId,
        polyline: encoded,
        distance: drawDist,
        lat: startLat,
        lng: startLng,
        date: new Date().toISOString(),
      });
      const targetId = placeId;
      exitDraw();
      const rows = await fetchPlaces();
      setPlaces(rows);
      navigate(`/place/${targetId}/routes`);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'Could not save trail');
    }
    setDrawBusy(false);
  }

  async function handleAddAt(lng: number, lat: number, presetName?: string) {
    setAddMode(false);
    setBanner('Adding that place…');
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
      pendingRef.current.add(created.id); // remove on close if left empty
      setBanner(null);
      navigate(`/place/${created.id}`);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'Could not create place');
    }
  }

  // Close the card; if it was a placeholder pin left with no info, delete it.
  async function handleCloseCard(id: string | undefined) {
    navigate('/');
    if (!id || !pendingRef.current.has(id)) return;
    pendingRef.current.delete(id);
    const p = placesRef.current.find((x) => x.id === id);
    if (!p) return;
    const looksEmpty =
      !p.cover_photo_id &&
      p.rating == null &&
      !p.review &&
      (p.categories?.length ?? 0) === 0 &&
      (p.visit_count ?? 0) === 0;
    if (!looksEmpty) return;
    const vis = await fetchVisits(id).catch(() => []);
    if (vis.length > 0) return; // a visit was logged — keep it
    await deletePlace(id).catch(() => undefined);
    setPlaces((prev) => prev.filter((x) => x.id !== id));
  }

  // Search a location and drop a card there (auto-removes on close if left empty).
  async function handleSearchPick(r: SearchResult) {
    try {
      const created = await createPlace({
        name: r.name,
        country: r.country,
        admin1: r.admin1,
        address: r.address,
        lng: r.lng,
        lat: r.lat,
      });
      setPlaces((prev) => [...prev, created]);
      pendingRef.current.add(created.id);
      setBanner(null);
      mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: 12 });
      navigate(`/place/${created.id}`);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'Could not add place');
    }
  }

  // Add photos: geotagged ones auto-place by GPS; photos WITHOUT a location get
  // a fresh card (placed at the current map center) so you can set the spot.
  async function handleAddPhotos(files: FileList | File[]) {
    setBanner('Uploading photos…');
    let added = 0;
    let geoPlaceId: string | null = null; // place the (first) geotagged photo landed on
    const skips: Record<string, number> = {};

    // Read GPS for all files first, then upload the geotagged ones in parallel (4×).
    const withGps = await mapPool(Array.from(files), async (f) => ({ f, gps: await readGps(f) }), 6);
    const geo = withGps.filter(
      (x): x is { f: File; gps: { lat: number; lng: number } } => !!x && !!x.gps,
    );
    const noLoc = withGps.filter((x) => x && !x.gps).map((x) => x!.f);

    const results = await mapPool(geo, ({ f, gps }) => uploadPhoto(f, { lat: gps.lat, lng: gps.lng }), 4);
    results.forEach((r) => {
      if (!r) skips.error = (skips.error ?? 0) + 1;
      else if (r.ok) {
        added++;
        if (!geoPlaceId && r.place_id) geoPlaceId = r.place_id;
      } else if (r.skipped) skips[r.skipped] = (skips[r.skipped] ?? 0) + 1;
    });

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
    } else if (geoPlaceId) {
      // Geotagged photo(s) auto-placed — open the card so the location/name/tags
      // can be adjusted just like any other place.
      setBanner(
        added > 1 ? `Added ${added} photos. Review the location and details here.` : null,
      );
      navigate(`/place/${geoPlaceId}`);
    } else if (added > 0) {
      setBanner(`Added ${added} photo${added > 1 ? 's' : ''} to the map.`);
    } else {
      // Nothing added — say exactly why so it's never a silent failure.
      const labels: Record<string, string> = {
        duplicate: 'already on the map',
        deleted: 'previously deleted (can’t be re-added)',
        error: 'upload error',
        undecodable: 'couldn’t read the image',
      };
      const why = Object.entries(skips)
        .map(([k, n]) => `${n} ${labels[k] ?? k}`)
        .join(', ');
      setBanner(why ? `No photos added — ${why}.` : 'No photos added.');
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
    try {
      const created = await createPlace({
        name: geo.name,
        country: geo.country,
        admin1: geo.admin1,
        address: geo.address,
        lng: geo.lng,
        lat: geo.lat,
      });
      setPlaces((prev) => [...prev, created]);
      pendingRef.current.add(created.id);
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
    pendingRef.current.delete(updated.id); // it's been edited — no longer a throwaway
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
    <div className={`map-root${selectedId ? ' card-open' : ''}`}>
      <div ref={containerRef} className="map-canvas" />

      <OnThisDay />

      <SearchPalette places={places} />

      {canEdit && (
        <button
          className="add-trail-btn"
          onClick={() => {
            setDrawMode(true);
            setBanner(null);
          }}
        >
          Add Trail on Map
        </button>
      )}

      <PersonFilter
        people={filterPeople}
        value={personFilter}
        onChange={setPersonFilter}
        meId={profile?.id}
      />

      <StatsBar places={places} onFilterCategory={setFilterCat} personFilter={personFilter} />

      <div className="map-top-row">
        {canEdit && (
          <div className="add-wrap">
            <button className="add-btn" onClick={() => setAddMenuOpen((v) => !v)}>
              + Add
            </button>
            {addMenuOpen && (
              <div className="add-menu">
                {/* Activity → every tag (with its icon). Pick one → a card opens
                    already tagged with it. */}
                <button onClick={() => setActivitySub((v) => !v)}>Activity</button>
                {activitySub && (
                  <div className="add-submenu">
                    <input
                      className="activity-filter"
                      placeholder="Search…"
                      autoFocus
                      value={activityFilter}
                      onChange={(e) => setActivityFilter(e.target.value)}
                    />
                    {[...CATEGORIES]
                      .sort((a, b) => {
                        const q = activityFilter.trim().toLowerCase();
                        if (!q) return 0;
                        const am = a.label.toLowerCase().startsWith(q) ? 0 : 1;
                        const bm = b.label.toLowerCase().startsWith(q) ? 0 : 1;
                        return am - bm;
                      })
                      .filter(
                        (c) =>
                          !activityFilter.trim() ||
                          c.label.toLowerCase().includes(activityFilter.trim().toLowerCase()),
                      )
                      .map((c) => (
                        <button key={c.slug} onClick={() => void addTagged(c.slug)}>
                          {c.label}
                        </button>
                      ))}
                  </div>
                )}
                <button onClick={() => void addTagged('trip')}>Trip</button>
                <button
                  onClick={() => {
                    setAddMenuOpen(false);
                    navigate('/bucket');
                  }}
                >
                  Bucket List
                </button>
                <button
                  onClick={() => {
                    if (canGooglePhotos) {
                      setPhotoSub((v) => !v);
                    } else {
                      setAddMenuOpen(false);
                      addFileRef.current?.click();
                    }
                  }}
                >
                  Photo
                </button>
                {canGooglePhotos && photoSub && (
                  <div className="add-submenu">
                    <button
                      onClick={() => {
                        setPhotoSub(false);
                        setAddMenuOpen(false);
                        addFileRef.current?.click();
                      }}
                    >
                      Files
                    </button>
                    <button onClick={() => void importGooglePhotos()}>Google Photos</button>
                  </div>
                )}
              </div>
            )}
            <input
              ref={addFileRef}
              type="file"
              accept="image/jpeg,image/heic,image/heif"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files && e.target.files.length) handleAddPhotos(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        )}
        <MapSearch
          onPick={handleSearchPick}
          getProximity={() => {
            const c = mapRef.current?.getCenter();
            return c ? [c.lng, c.lat] : undefined;
          }}
        />
      </div>

      {!selectedPlace && !addMode && !drawMode && <MemoryBanner />}

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

      {drawMode && (
        <div className="draw-bar">
          <div className="draw-bar-row">
            <input
              autoFocus
              placeholder="Trail name (e.g. W&OD — Leesburg segment)"
              value={drawName}
              onChange={(e) => setDrawName(e.target.value)}
            />
            <select value={drawType} onChange={(e) => setDrawType(e.target.value)}>
              <option value="Hike">🥾 Hiking</option>
              <option value="Walk">🚶 Walking</option>
              <option value="Run">🏃 Running</option>
            </select>
          </div>
          <div className="draw-bar-row">
            <span className="add-hint">
              Tap the map to add points · {drawCount} point{drawCount === 1 ? '' : 's'}
              {drawDist > 0 ? ` · ${(drawDist / 1609.344).toFixed(2)} mi` : ''}
            </span>
            <div className="spacer" style={{ flex: 1 }} />
            <button disabled={drawCount === 0} onClick={undoDrawPoint}>
              Undo
            </button>
            <button onClick={exitDraw}>Cancel</button>
            <button
              className="primary"
              disabled={drawBusy || drawCount < 2 || !drawName.trim()}
              onClick={() => void saveDrawnTrail()}
            >
              {drawBusy ? 'Saving…' : 'Save trail'}
            </button>
          </div>
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

      <UnassignedTray key={trayNonce} places={places} onChanged={() => setTrayNonce((n) => n + 1)} />

      {selectedPlace && (
        <PlacePanel
          place={selectedPlace}
          allPlaces={places}
          onClose={() => void handleCloseCard(selectedPlace.id)}
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
