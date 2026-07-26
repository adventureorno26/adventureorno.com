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
  updatePlace,
  deletePlace,
  fetchFog,
  fetchMapPeople,
  fetchMapProjection,
  fetchPings,
  fetchPlaceIdsForView,
  fetchPlaces,
  fetchVisits,
  triggerGeocode,
  type MapPerson,
} from '../lib/data';
import { fetchPhotoObjectUrl, mapPool, readGps } from '../lib/photos';
import { fetchVideoCovers, fetchVideoPosterUrl } from '../lib/videos';
import { enqueueUpload } from '../lib/uploadQueue';
import NewPlaceDraft from '../components/NewPlaceDraft';
import { googlePhotosEnabled, pickFromGooglePhotos } from '../lib/googlePhotos';
import {
  createManualActivity,
  fetchActivityLines,
  fetchPlaceCounts,
  type PlaceCount,
} from '../lib/strava';
import { haversineMeters } from '../lib/geo';
import {
  CATEGORIES,
  categoryColor,
  effectiveCategories,
  isContainerSlug,
  primaryCategory,
} from '../lib/categories';
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

type MapLayer = 'fog' | 'heat' | 'none';

// A world-covering polygon with the revealed areas punched out as holes — the fog
// is everything NOT revealed. Each revealed polygon's exterior ring becomes a hole.
function inverseFog(mp: GeoJSON.MultiPolygon | null): GeoJSON.Feature<GeoJSON.Polygon> {
  const world = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];
  const holes = (mp?.coordinates ?? []).map((poly) => poly[0]);
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [world, ...holes] },
  };
}

// place_id → a video id (with a poster) to use as the marker when there's no
// cover photo. Populated by the map from fetchVideoCovers().
const coverVideoByPlace = new Map<string, string>();

// A place's marker image id: its cover photo (`ph-<id>`), a trailhead's photo,
// else — if it has a video with a poster — that video's poster (`vid-<id>`),
// else '' (a plain pin). Every marker still = a real photo/video frame.
function coverIcon(p: Place, all: Place[]): string {
  if (p.cover_photo_id) return `ph-${p.cover_photo_id}`;
  if (p.is_trail) {
    const th = all.find((x) => (x.part_of ?? []).includes(p.id) && x.cover_photo_id);
    if (th?.cover_photo_id) return `ph-${th.cover_photo_id}`;
  }
  const vid = coverVideoByPlace.get(p.id);
  if (vid) return `vid-${vid}`;
  return '';
}

function toFeatureCollection(places: Place[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: places.map((p) => {
      const icon = coverIcon(p, places);
      const primary = primaryCategory(p);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: {
          id: p.id,
          photo: icon ? 1 : 0,
          icon,
          color: categoryColor(primary),
          // White type indicator on no-photo pins (R=Restaurant, W=Winery, …).
          // Trails show no letter — their route line already identifies them.
          glyph:
            icon || primary === 'default' || primary === 'trail'
              ? ''
              : primary.charAt(0).toUpperCase(),
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
const videoUrlCache = new Map<string, string>();
async function videoCoverUrl(videoId: string): Promise<string> {
  const cached = videoUrlCache.get(videoId);
  if (cached) return cached;
  const url = await fetchVideoPosterUrl(videoId);
  videoUrlCache.set(videoId, url);
  return url;
}

// Render a place's cover thumbnail into a circular map icon (white ring).
async function circleIcon(photoId: string): Promise<ImageData | null> {
  return circleIconFromUrl(await coverUrl(photoId));
}
// Same, from a video poster.
async function videoCircleIcon(videoId: string): Promise<ImageData | null> {
  try {
    return circleIconFromUrl(await videoCoverUrl(videoId));
  } catch {
    return null;
  }
}
async function circleIconFromUrl(url: string): Promise<ImageData | null> {
  try {
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
    ctx.drawImage(
      img,
      (img.naturalWidth - s) / 2,
      (img.naturalHeight - s) / 2,
      s,
      s,
      4,
      4,
      S - 8,
      S - 8,
    );
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
  // Idle globe auto-rotate.
  const spinRaf = useRef(0);
  const spinning = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopSpinRef = useRef<() => void>(() => undefined);
  const scheduleIdleRef = useRef<() => void>(() => undefined);
  const selectedIdRef = useRef<string | undefined>(undefined);

  const [places, setPlaces] = useState<Place[]>([]);
  const [ready, setReady] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [searching, setSearching] = useState(false);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [mapLayer, setMapLayer] = useState<MapLayer>(
    () => (localStorage.getItem('aon_map_layer') as MapLayer) || 'none',
  );
  const fogLoaded = useRef(false);
  const pingsLoaded = useRef(false);
  // "Just me / Just Josh / Both" filter (null = both).
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [people, setPeople] = useState<MapPerson[]>([]);
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // Explicit new-place draft (map click / search) — nothing saved until Save.
  const [draft, setDraft] = useState<{ lat: number; lng: number; presetName?: string } | null>(
    null,
  );
  // Completion report after a batch upload touched several places.
  const [uploadReport, setUploadReport] = useState<{
    added: number;
    skipped: number;
    rows: { id: string; name: string; n: number }[];
  } | null>(null);
  const [activitySub, setActivitySub] = useState(false);
  const [activityFilter, setActivityFilter] = useState('');
  const [photoSub, setPhotoSub] = useState(false);
  const addFileRef = useRef<HTMLInputElement | null>(null);
  // Google Photos import is a manual upload — Erica AND Josh (editor) can use it,
  // each from their own Google account. Only the automated device ingest is Erica-only.
  const canGooglePhotos = canEdit && googlePhotosEnabled();

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
        // A trail container groups hikes/runs by mileage — flag it so its card
        // uses the trail layout.
        is_trail: tag === 'trail',
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
    // Video covers: places with a video (but no cover photo) get the video's
    // poster as their marker. Load once; re-sync if the map is already up.
    fetchVideoCovers()
      .then((m) => {
        coverVideoByPlace.clear();
        for (const [k, v] of m) coverVideoByPlace.set(k, v);
        if (mapRef.current?.getSource(SOURCE_ID)) syncSource(placesRef.current);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The two people, for the "just me" filter + attribution.
  useEffect(() => {
    void fetchMapPeople()
      .then(setPeople)
      .catch(() => undefined);
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
            coords = polyline
              .decode(l.summary_polyline)
              .map(([la, ln]) => [ln, la] as [number, number]);
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
      // v5: antialias moved here from the top-level map option (smooth globe edges).
      canvasContextAttributes: { antialias: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    map.on('load', () => {
      // Globe projection (with atmosphere) unless the owner switched to Mercator.
      void fetchMapProjection()
        .then((proj) => {
          if (proj === 'globe') map.setProjection({ type: 'globe' });
        })
        .catch(() => undefined);

      // Fog of war — two fills (soft edge + crisp core), above basemap, below all
      // routes/markers. Hidden until the Fog layer is selected.
      map.addSource('fog-soft', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('fog-crisp', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      // Insert the fog UNDER the basemap's first label (symbol) layer so city /
      // place names stay readable ON TOP of the fog — otherwise fog-of-war hides
      // every city label ("barely any cities labeled"). Falls back to on-top if
      // the style has no symbol layer.
      const firstLabelId = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
      map.addLayer(
        {
          id: 'fog-soft',
          type: 'fill',
          source: 'fog-soft',
          layout: { visibility: 'none' },
          paint: { 'fill-color': '#05070d', 'fill-opacity': 0.55 },
        },
        firstLabelId,
      );
      map.addLayer(
        {
          id: 'fog-crisp',
          type: 'fill',
          source: 'fog-crisp',
          layout: { visibility: 'none' },
          paint: { 'fill-color': '#05070d', 'fill-opacity': 0.3 },
        },
        firstLabelId,
      );

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

      // Ping-density heatmap (from pings_overview grid cells), hidden until the
      // Heat layer is selected. Weighted by each cell's count.
      map.addSource('pings', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'pings-heat',
        type: 'heatmap',
        source: 'pings',
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 300, 1],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 12, 10, 30],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 3],
          'heatmap-opacity': 0.7,
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0,
            'rgba(59,130,246,0)',
            0.3,
            'rgba(59,130,246,0.6)',
            0.6,
            'rgba(168,85,247,0.7)',
            1,
            'rgba(244,63,94,0.85)',
          ],
        },
      });
      map.addLayer({
        id: 'pings-dots',
        type: 'circle',
        source: 'pings',
        layout: { visibility: 'none' },
        minzoom: 9,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 1, 2, 300, 8],
          'circle-color': 'rgba(244,63,94,0.5)',
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 12, 0.6],
        },
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
        const isPhoto = iid?.startsWith('ph-');
        const isVideo = iid?.startsWith('vid-');
        if (!iid || (!isPhoto && !isVideo) || map.hasImage(iid)) return;
        // Reserve the id with a transparent placeholder so it doesn't refire,
        // then fill in the real circular thumbnail once it decodes.
        map.addImage(
          iid,
          { width: 100, height: 100, data: new Uint8Array(100 * 100 * 4) },
          { pixelRatio: 2 },
        );
        const build = isVideo ? videoCircleIcon(iid.slice(4)) : circleIcon(iid.slice(3));
        void build.then((data) => {
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

  // Which leaf places belong to the current person view (attribution + cutoff).
  // "Both" = only places with a post-2025-12-21 joint visit; a person = their solo
  // + joint visits. Containers (trails/trips) roll up and aren't visit-filtered.
  const [viewSet, setViewSet] = useState<Set<string> | null>(null);
  useEffect(() => {
    let active = true;
    fetchPlaceIdsForView(personFilter)
      .then((s) => active && setViewSet(s))
      .catch(() => active && setViewSet(null));
    return () => {
      active = false;
    };
  }, [personFilter, places.length]);

  // Trailheads = leaf places that belong to a trail. They're landmarks Erica
  // wants ALWAYS on the map (e.g. the Appalachian / Tuscarora / W&OD trailheads),
  // so they're exempt from the person/cutoff view filter just like the trails.
  const trailIds = new Set(places.filter((p) => p.is_trail).map((p) => p.id));
  const trailMemberIds = new Set(
    places.filter((p) => (p.part_of ?? []).some((pid) => trailIds.has(pid))).map((p) => p.id),
  );

  // Filter the map: bucket-list places are hidden unless their toggle is on;
  // visited places follow the selected activity tag and the person view.
  const visiblePlaces = places.filter((p) => {
    if (p.bucket) return false; // bucket-list places live on the bucket page, not the main map
    if (!p.saved) return false; // only saved places appear on the map
    // Leaf places must be in the current person view (attribution + cutoff).
    // Containers (trails/trips) AND trailheads are exempt so trails stay visible.
    if (!p.holds_children && !trailMemberIds.has(p.id) && viewSet && !viewSet.has(p.id))
      return false;
    return !filterCat || effectiveCategories(p).includes(filterCat);
  });

  // Show the person filter once both people exist (test/bot excluded server-side).
  const filterPeople = people;

  // Keep the source in sync once both map and data are ready (idle → syncMarkers).
  useEffect(() => {
    if (ready) syncSource(visiblePlaces);
  }, [ready, visiblePlaces, syncSource]);

  // Layers control (Fog / Heat / none): toggle the fog + heat layers and dim the
  // markers under the heatmap. Fog data is fetched lazily the first time it's on.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    localStorage.setItem('aon_map_layer', mapLayer);

    if (mapLayer === 'fog' && !fogLoaded.current) {
      fogLoaded.current = true;
      void fetchFog()
        .then(({ crisp, soft }) => {
          (map.getSource('fog-crisp') as GeoJSONSource | undefined)?.setData({
            type: 'FeatureCollection',
            features: [inverseFog(crisp)],
          });
          (map.getSource('fog-soft') as GeoJSONSource | undefined)?.setData({
            type: 'FeatureCollection',
            features: [inverseFog(soft)],
          });
        })
        .catch(() => undefined);
    }
    if (mapLayer === 'heat' && !pingsLoaded.current) {
      pingsLoaded.current = true;
      void fetchPings()
        .then((cells) => {
          (map.getSource('pings') as GeoJSONSource | undefined)?.setData({
            type: 'FeatureCollection',
            features: cells.map((c) => ({
              type: 'Feature',
              properties: { weight: c.weight },
              geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
            })),
          });
        })
        .catch(() => undefined);
    }

    const vis = (id: string, on: boolean) =>
      map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('fog-soft', mapLayer === 'fog');
    vis('fog-crisp', mapLayer === 'fog');
    vis('pings-heat', mapLayer === 'heat');
    vis('pings-dots', mapLayer === 'heat');

    const dim = mapLayer === 'heat' ? 0.2 : 1;
    const props: [string, string][] = [
      ['place-dots', 'circle-opacity'],
      ['place-glyphs', 'text-opacity'],
      ['place-photos', 'icon-opacity'],
    ];
    for (const [id, prop] of props) if (map.getLayer(id)) map.setPaintProperty(id, prop, dim);
  }, [mapLayer, ready]);

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
      // Gentle arc (curve/speed) — reads nicely on the globe.
      map.flyTo({ center: pt, zoom: Math.max(map.getZoom(), 11), curve: 1.4, speed: 0.6 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready]);

  // Idle auto-rotate: after 60s with no interaction and no open place, the globe
  // spins slowly; any pointer/touch/wheel cancels it and restarts the idle clock.
  selectedIdRef.current = selectedId;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const spinFrame = () => {
      if (!spinning.current) return;
      const c = map.getCenter();
      map.setCenter([c.lng - 0.12, c.lat]); // ~40s per rotation at 60fps
      spinRaf.current = requestAnimationFrame(spinFrame);
    };
    const startSpin = () => {
      if (spinning.current || selectedIdRef.current) return;
      spinning.current = true;
      spinFrame();
    };
    const stopSpin = () => {
      spinning.current = false;
      if (spinRaf.current) cancelAnimationFrame(spinRaf.current);
    };
    const scheduleIdle = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(startSpin, 60_000);
    };
    const onInteract = () => {
      stopSpin();
      scheduleIdle();
    };
    stopSpinRef.current = stopSpin;
    scheduleIdleRef.current = scheduleIdle;

    const canvas = map.getCanvas();
    canvas.addEventListener('mousedown', onInteract);
    canvas.addEventListener('touchstart', onInteract, { passive: true });
    canvas.addEventListener('wheel', onInteract, { passive: true });
    scheduleIdle();

    return () => {
      stopSpin();
      if (idleTimer.current) clearTimeout(idleTimer.current);
      canvas.removeEventListener('mousedown', onInteract);
      canvas.removeEventListener('touchstart', onInteract);
      canvas.removeEventListener('wheel', onInteract);
    };
  }, [ready]);

  // Opening a place cancels any spin and restarts the idle clock.
  useEffect(() => {
    if (selectedId) stopSpinRef.current();
    else scheduleIdleRef.current();
  }, [selectedId]);

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
        lineCoords = polyline
          .decode(snapped.polyline)
          .map(([la, ln]) => [ln, la] as [number, number]);
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

  // Launched from a trail card's "Add a route": close the card, enter draw mode
  // pre-named + targeted so the drawn route attaches to THIS trail on save.
  function startDrawForTrail(trailId: string, name: string) {
    drawTargetRef.current = trailId;
    setDrawName(name);
    navigate('/');
    setDrawMode(true);
  }

  // Map click / search → open an explicit DRAFT (nothing hits the DB until Save).
  function handleAddAt(lng: number, lat: number, presetName?: string) {
    setAddMode(false);
    setBanner(null);
    setDraft({ lat, lng, presetName });
  }

  // Close the card. (No throwaway cleanup — new places are explicit drafts now.)
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

  // Search a location → open the new-place draft there (nothing saved until Save).
  function handleSearchPick(r: SearchResult) {
    mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: 12 });
    setBanner(null);
    setDraft({ lat: r.lat, lng: r.lng, presetName: r.name });
  }

  // Add photos: geotagged ones auto-place by GPS; photos WITHOUT a location get
  // a fresh card (placed at the current map center) so you can set the spot.
  async function handleAddPhotos(files: FileList | File[]) {
    setBanner('Uploading photos…');
    let added = 0;
    let geoPlaceId: string | null = null; // place the (first) geotagged photo landed on
    const skips: Record<string, number> = {};
    const perPlace = new Map<string, number>(); // place_id → photos added there

    // Read GPS for all files first, then upload the geotagged ones in parallel (4×).
    const withGps = await mapPool(
      Array.from(files),
      async (f) => ({ f, gps: await readGps(f) }),
      6,
    );
    const geo = withGps.filter(
      (x): x is { f: File; gps: { lat: number; lng: number } } => !!x && !!x.gps,
    );
    const noLoc = withGps.filter((x) => x && !x.gps).map((x) => x!.f);

    // Through the global upload queue: progress + pause/retry, survives navigation.
    const results = await Promise.all(
      geo.map(({ f, gps }) => enqueueUpload(f, { lat: gps.lat, lng: gps.lng })),
    );
    results.forEach((r) => {
      if (!r) skips.error = (skips.error ?? 0) + 1;
      else if (r.ok) {
        added++;
        if (!geoPlaceId && r.place_id) geoPlaceId = r.place_id;
        if (r.place_id) perPlace.set(r.place_id, (perPlace.get(r.place_id) ?? 0) + 1);
      } else if (r.skipped) skips[r.skipped] = (skips[r.skipped] ?? 0) + 1;
    });

    // Photos with no location → upload them WITHOUT coordinates or a place. They
    // land unassigned in the Sorter inbox, to be placed by capture time — no more
    // fabricating a location at the map center.
    let inboxAdded = 0;
    if (noLoc.length > 0) {
      const res = await Promise.all(noLoc.map((f) => enqueueUpload(f, { override: true })));
      inboxAdded = res.filter((r) => r && r.ok).length;
    }

    if (added > 0) await triggerGeocode().catch(() => undefined);
    const rows = await fetchPlaces().catch(() => places);
    // Prefill a freshly geo-placed photo's card from the photo's own coordinates
    // right away (name/state/country), so the address is populated the moment the
    // card opens — not only after the server geocode. Empty fields ONLY, so an
    // existing named place the photo attached to is never overwritten.
    if (geoPlaceId && geo[0]?.gps) {
      const gp = rows.find((r) => r.id === geoPlaceId);
      if (gp && (!gp.name || gp.name === 'New place' || !gp.admin1 || !gp.country)) {
        const rev = await reverseGeocode(geo[0].gps.lng, geo[0].gps.lat).catch(() => null);
        if (rev) {
          const patch: { name?: string; admin1?: string | null; country?: string | null } = {};
          if (!gp.name || gp.name === 'New place') patch.name = rev.name;
          if (!gp.admin1) patch.admin1 = rev.admin1;
          if (!gp.country) patch.country = rev.country;
          const upd = await updatePlace(geoPlaceId, patch).catch(() => null);
          if (upd) {
            const i = rows.findIndex((r) => r.id === geoPlaceId);
            if (i >= 0) rows[i] = upd;
          }
        }
      }
    }
    setPlaces(rows);
    await fetchPlaceCounts()
      .then((c) => {
        countsRef.current = c;
        syncSource(rows);
      })
      .catch(() => undefined);
    setTrayNonce((n) => n + 1);

    // A batch that touched several places → show a completion report (which places
    // got photos + what was skipped) instead of jumping to just the first one.
    if (perPlace.size > 1) {
      const skipCount = Object.values(skips).reduce((a, b) => a + b, 0);
      const report = {
        added,
        skipped: skipCount,
        rows: [...perPlace.entries()]
          .map(([pid, n]) => ({ id: pid, name: rows.find((r) => r.id === pid)?.name ?? 'Place', n }))
          .sort((a, b) => b.n - a.n),
      };
      setUploadReport(report);
      setBanner(null);
      return;
    }

    if (geoPlaceId) {
      // Geotagged photo(s) auto-placed — open the card so the location/name/tags
      // can be adjusted just like any other place.
      setBanner(added > 1 ? `Added ${added} photos. Review the location and details here.` : null);
      navigate(`/place/${geoPlaceId}`);
    } else if (inboxAdded > 0 && added === 0) {
      // Only no-GPS photos → they're in the inbox to sort by date.
      setBanner(
        `${inboxAdded} photo${inboxAdded > 1 ? 's' : ''} had no location — added to your inbox. Sort them in Settings → Sort photos into places.`,
      );
    } else if (added > 0) {
      setBanner(
        `Added ${added} photo${added > 1 ? 's' : ''} to the map${inboxAdded ? ` · ${inboxAdded} with no location went to your inbox` : ''}.`,
      );
    } else {
      // Nothing added — say exactly why so it's never a silent failure.
      const labels: Record<string, string> = {
        duplicate: 'already on the map',
        deleted: 'previously deleted (auto-import skips it; re-upload on purpose to add it back)',
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
    setAddress('');
    setAddMode(false);
    setBanner(null);
    mapRef.current?.flyTo({ center: [geo.lng, geo.lat], zoom: 12 });
    setDraft({ lat: geo.lat, lng: geo.lng, presetName: geo.name });
    setSearching(false);
  }

  function handlePlaceChanged(updated: Place) {
    pendingRef.current.delete(updated.id); // it's been edited — no longer a throwaway
    // Upsert: update if present, else add (lets the card create new places, e.g.
    // moving a visit to a specific location).
    setPlaces((prev) =>
      prev.some((p) => p.id === updated.id)
        ? prev.map((p) => (p.id === updated.id ? updated : p))
        : [...prev, updated],
    );
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

      {uploadReport && (
        <div className="npd-overlay" role="dialog" onClick={() => setUploadReport(null)}>
          <div className="npd-card" onClick={(e) => e.stopPropagation()}>
            <div className="npd-head">
              <b>
                {uploadReport.added} photo{uploadReport.added === 1 ? '' : 's'} across{' '}
                {uploadReport.rows.length} places
              </b>
              <button className="npd-x" onClick={() => setUploadReport(null)} aria-label="Close">
                ×
              </button>
            </div>
            {uploadReport.skipped > 0 && (
              <div className="label">
                {uploadReport.skipped} skipped (duplicates / no location / errors)
              </div>
            )}
            <div className="trash-list">
              {uploadReport.rows.map((row) => (
                <div key={row.id} className="trash-row">
                  <div className="trash-main">
                    <b>{row.name}</b>
                    <span className="label">
                      {row.n} photo{row.n === 1 ? '' : 's'}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setUploadReport(null);
                      navigate(`/place/${row.id}`);
                    }}
                  >
                    Review
                  </button>
                </div>
              ))}
            </div>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button onClick={() => setUploadReport(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {draft && (
        <NewPlaceDraft
          initialLat={draft.lat}
          initialLng={draft.lng}
          presetName={draft.presetName}
          places={places}
          people={people}
          meId={profile?.id ?? null}
          onSaved={(placeId) => {
            setDraft(null);
            void fetchPlaces()
              .then(setPlaces)
              .catch(() => undefined);
            navigate(`/place/${placeId}`);
          }}
          onCancel={() => setDraft(null)}
        />
      )}

      <PersonFilter
        people={filterPeople}
        value={personFilter}
        onChange={setPersonFilter}
        meId={profile?.id}
      />

      <StatsBar places={places} onFilterCategory={setFilterCat} personFilter={personFilter} />

      <div className="layers-control">
        {(['fog', 'heat', 'none'] as const).map((l) => (
          <button
            key={l}
            className={mapLayer === l ? 'on' : ''}
            onClick={() => setMapLayer(l)}
            title={
              l === 'fog'
                ? 'Fog of war — dim everywhere we haven’t been'
                : l === 'heat'
                  ? 'Heatmap of everywhere we’ve been'
                  : 'No overlay'
            }
          >
            {l === 'fog' ? 'Fog' : l === 'heat' ? 'Heat' : 'None'}
          </button>
        ))}
      </div>

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
                          !isContainerSlug(c.slug) &&
                          (!activityFilter.trim() ||
                            c.label.toLowerCase().includes(activityFilter.trim().toLowerCase())),
                      )
                      .map((c) => (
                        <button key={c.slug} onClick={() => void addTagged(c.slug)}>
                          {c.label}
                        </button>
                      ))}
                  </div>
                )}
                <button onClick={() => void addTagged('trip')}>Trip</button>
                <button onClick={() => void addTagged('trail')}>Trail</button>
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

      <UnassignedTray
        key={trayNonce}
        places={places}
        onChanged={() => setTrayNonce((n) => n + 1)}
      />

      {selectedPlace && (
        <PlacePanel
          place={selectedPlace}
          allPlaces={places}
          onClose={() => void handleCloseCard(selectedPlace.id)}
          onPlaceChanged={handlePlaceChanged}
          onPlaceDeleted={handlePlaceDeleted}
          onMerged={handleMerged}
          onAddRoute={startDrawForTrail}
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
