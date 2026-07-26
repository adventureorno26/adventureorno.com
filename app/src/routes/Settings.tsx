import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  addCategory,
  fetchClimbingStats,
  fetchGeoCoverage,
  fetchHomeZone,
  fetchMapPeople,
  fetchPeaksBagged,
  fetchPlacePeople,
  type MapPerson,
  type Peak,
  fetchMapProjection,
  fetchPlaces,
  fetchSettingsStats,
  fetchTrackingStatus,
  setMapProjection,
  triggerGeocode,
  updateHomeZone,
  type GeoCoverage,
  type HomeZone,
  type MapProjection,
  type SettingsStats,
  type TrackingStatus,
} from '../lib/data';
import {
  setTrackingPref,
  startTracking,
  stopTracking,
  trackingPref,
  trackingSupported,
} from '../lib/tracking';
import { CATEGORIES } from '../lib/categories';
import type { Place } from '../lib/types';
import { exportCsv, exportGpx, exportKml } from '../lib/exports';
import { backfillPage, isMyStravaConnected, stravaAuthorizeUrl } from '../lib/strava';
import { importFileActivity, parseActivityFile, parseFitActivity } from '../lib/importFile';
import PeopleCard from '../components/PeopleCard';
import SharedHub from '../components/SharedHub';
import { runClusteringNow } from '../lib/timeline';
import {
  approveJoinRequest,
  denyJoinRequest,
  fetchPendingJoinRequests,
  type JoinRequest,
} from '../lib/join';

const METERS_PER_MILE = 1609.344;

const TAG_COLORS = [
  '#38bdf8',
  '#22c55e',
  '#f97316',
  '#a855f7',
  '#ec4899',
  '#eab308',
  '#06b6d4',
  '#ef4444',
];

/** Create custom tags. New tags populate everywhere tags appear (chips on place
 *  cards, the map legend, review-section headings). */
function TagsCard() {
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // re-render after a tag is added

  async function submit() {
    if (!label.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      // No icon — Erica's standing rule is no icons unless asked.
      await addCategory(label.trim(), '', color);
      setLabel('');
      setColor(TAG_COLORS[0]);
      setTick((t) => t + 1);
      setMsg('Added — it now shows everywhere tags appear.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not add tag');
    }
    setBusy(false);
  }

  return (
    <div className="card">
      <b>Tags</b>
      <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 10px' }}>
        Add your own tags. A new tag appears everywhere tags do — the chips on a place, the map
        legend, and its own review section heading (e.g. “Spa Reviews”).
      </div>
      <div className="our-stats" key={tick} style={{ marginBottom: 10 }}>
        {CATEGORIES.map((c) => (
          <span key={c.slug} className="stat">
            {c.label}
          </span>
        ))}
      </div>
      <div className="btn-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          style={{ flex: '1 1 140px' }}
          placeholder="New tag name (e.g. Spa)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {TAG_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              title={c}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: c,
                border: color === c ? '2px solid var(--fg)' : '2px solid transparent',
                padding: 0,
                cursor: 'pointer',
              }}
            />
          ))}
        </span>
        <button className="primary" disabled={busy || !label.trim()} onClick={() => void submit()}>
          {busy ? 'Adding…' : 'Add tag'}
        </button>
      </div>
      {msg && (
        <div className="banner" style={{ marginTop: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}

function JoinRequestsCard() {
  const [reqs, setReqs] = useState<JoinRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    fetchPendingJoinRequests()
      .then(setReqs)
      .catch(() => setReqs([]));
  }
  useEffect(load, []);

  async function act(r: JoinRequest, action: 'viewer' | 'editor' | 'deny') {
    setBusy(r.id);
    setMsg(null);
    try {
      if (action === 'deny') await denyJoinRequest(r.id);
      else await approveJoinRequest(r.id, action);
      setMsg(
        action === 'deny'
          ? `Denied ${r.email ?? 'request'}.`
          : `Approved ${r.email ?? 'request'} as ${action === 'editor' ? 'contributor' : 'viewer'}.`,
      );
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not update request');
    }
    setBusy(null);
  }

  if (reqs === null) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;
  return (
    <div className="card">
      {reqs.length === 0 ? (
        <p style={{ color: 'var(--muted)', margin: 0 }}>No pending requests.</p>
      ) : (
        reqs.map((r) => (
          <div key={r.id} className="join-req">
            <div>
              <b>{r.display_name ?? r.email ?? 'Someone'}</b>
              {r.email && r.display_name ? <span className="muted"> · {r.email}</span> : null}
              {r.note ? (
                <div className="muted" style={{ fontSize: 13 }}>
                  “{r.note}”
                </div>
              ) : null}
            </div>
            <div className="join-req-actions">
              <button
                className="primary"
                disabled={busy === r.id}
                onClick={() => void act(r, 'editor')}
              >
                Approve · Contributor
              </button>
              <button disabled={busy === r.id} onClick={() => void act(r, 'viewer')}>
                Viewer
              </button>
              <button
                className="danger"
                disabled={busy === r.id}
                onClick={() => void act(r, 'deny')}
              >
                Deny
              </button>
            </div>
          </div>
        ))
      )}
      {msg && (
        <div className="banner" style={{ marginTop: 10 }}>
          {msg}
        </div>
      )}
    </div>
  );
}

function HomeZoneCard() {
  const [zone, setZone] = useState<HomeZone | null>(null);
  const [miles, setMiles] = useState('15');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchHomeZone()
      .then((z) => {
        setZone(z);
        setLat(String(z.lat));
        setLng(String(z.lng));
        setMiles((z.radius_m / METERS_PER_MILE).toFixed(1));
      })
      .catch(() => setMsg('Could not load home zone'));
  }, []);

  async function save() {
    setMsg(null);
    try {
      const next: HomeZone = {
        lat: Number(lat),
        lng: Number(lng),
        radius_m: Math.round(Number(miles) * METERS_PER_MILE),
      };
      await updateHomeZone(next);
      setZone(next);
      setMsg('Saved. New ingests use this immediately.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save');
    }
  }

  if (!zone) return <div className="card">Loading home zone…</div>;
  return (
    <div className="card">
      <b>Home exclusion zone</b>
      <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 8px' }}>
        A fixed spot — it does <b>not</b> follow you around. Photos and pings within this radius are
        never stored (Strava Hike/Walk/Run are the only exception). Set it once from where you live.
      </div>
      <div className="btn-row" style={{ marginTop: 0, marginBottom: 4 }}>
        <button
          onClick={() => {
            setMsg('Getting your location…');
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                setLat(pos.coords.latitude.toFixed(6));
                setLng(pos.coords.longitude.toFixed(6));
                setMsg('Filled in your current location — tap Save home zone to confirm.');
              },
              () => setMsg('Could not get your location. Allow location access and try again.'),
              { enableHighAccuracy: true },
            );
          }}
        >
          📍 Use my current location
        </button>
      </div>
      <div className="field-row">
        <div>
          <label>Center latitude</label>
          <input value={lat} onChange={(e) => setLat(e.target.value)} />
        </div>
        <div>
          <label>Center longitude</label>
          <input value={lng} onChange={(e) => setLng(e.target.value)} />
        </div>
        <div>
          <label>Radius (miles)</label>
          <input value={miles} onChange={(e) => setMiles(e.target.value)} />
        </div>
      </div>
      <div className="btn-row">
        <button className="primary" onClick={() => void save()}>
          Save home zone
        </button>
      </div>
      {msg && (
        <div className="banner" style={{ marginTop: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}

function GeocodeCard() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function name() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await triggerGeocode();
      setMsg(`Named ${r.named} of ${r.considered} pending place(s).`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    }
    setBusy(false);
  }
  async function cluster() {
    setBusy(true);
    setMsg(null);
    try {
      const c = await runClusteringNow();
      setMsg(
        `Clustered ${c.points} points → ${c.clusters_created} new, ${c.clusters_attached} attached.`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    }
    setBusy(false);
  }
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <b>Auto-created places</b>
      <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 8px' }}>
        The nightly job clusters photos + location pings into places and names them. Run it now
        after a backfill or import.
      </div>
      <div className="btn-row" style={{ marginTop: 0 }}>
        <button disabled={busy} onClick={() => void cluster()}>
          {busy ? 'Working…' : 'Cluster now'}
        </button>
        <button disabled={busy} onClick={() => void name()}>
          Name new places
        </button>
        <Link to="/settings/import">
          <button>Import Google Timeline…</button>
        </Link>
      </div>
      {msg && (
        <div className="banner" style={{ marginTop: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Our stats — same pill style as the map. National Parks lands with that feature. */
function OurStatsCard({ personId }: { personId: string | null }) {
  const [s, setS] = useState<SettingsStats | null>(null);
  useEffect(() => {
    fetchSettingsStats(personId)
      .then(setS)
      .catch(() => setS(null));
  }, [personId]);
  if (!s) return null;
  const pills = [
    { label: 'Trails Taken', value: s.trails_taken },
    { label: 'Camping', value: s.camping },
    { label: 'Dining', value: s.dining },
    { label: 'Wineries', value: s.winery },
  ];
  return (
    <div className="card">
      <details className="stats-dropdown">
        <summary>Stats</summary>
        <div className="our-stats">
          {pills.map((p) => (
            <div key={p.label} className="stat">
              <b>{p.value}</b> <span className="label">{p.label}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/** Cities & States — the geography count that used to sit in the map stats bar.
 *  Each state/country is a dropdown listing the cities (places) within it. */
function PlacesByStateCard({
  personId,
  placePeople,
}: {
  personId: string | null;
  placePeople: Map<string, Set<string>>;
}) {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [cov, setCov] = useState<GeoCoverage | null>(null);
  useEffect(() => {
    fetchPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]));
    fetchGeoCoverage(personId)
      .then(setCov)
      .catch(() => setCov(null));
  }, [personId]);
  if (!places) return null;

  // Top-level, saved, non-bucket places grouped by state (US) or country.
  const groups = new Map<string, { isState: boolean; cities: Place[] }>();
  for (const p of places) {
    if (p.bucket || !p.saved) continue;
    if (personId && !(placePeople.get(p.id)?.has(personId) ?? false)) continue;
    const isUS = (p.country ?? '').match(/^(United States|USA|US)$/i);
    const key = isUS ? (p.admin1 ?? 'United States') : (p.country ?? 'Other');
    if (!groups.has(key)) groups.set(key, { isState: Boolean(isUS), cities: [] });
    groups.get(key)!.cities.push(p);
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    if (a[1].isState !== b[1].isState) return a[1].isState ? -1 : 1;
    return a[0].localeCompare(b[0]);
  });
  // Accurate counts from the server (DC excluded from the 50, US/US-States
  // spellings normalized); fall back to the client grouping until it loads.
  const stateCount =
    cov?.us_state_count ??
    ordered.filter((g) => g[1].isState && g[0] !== 'District of Columbia').length;
  const countryCount = cov?.country_count ?? ordered.filter((g) => !g[1].isState).length;
  const statePct = Math.round((stateCount / 50) * 100);

  return (
    <div className="card">
      <details className="stats-dropdown">
        <summary>Cities and states</summary>
        <div className="our-stats" style={{ marginBottom: 10 }}>
          <div className="stat">
            <b>{stateCount}</b>{' '}
            <span className="label">of 50 states{cov?.has_dc ? ' + DC' : ''}</span>
          </div>
          <div className="stat">
            <b>{statePct}%</b> <span className="label">of the US</span>
          </div>
          <div className="stat">
            <b>{countryCount}</b> <span className="label">countries</span>
          </div>
        </div>
        <div className="us-progress" title={`${stateCount} of 50 states`}>
          <div className="us-progress-fill" style={{ width: `${statePct}%` }} />
        </div>
        {ordered.map(([label, g]) => (
          <details key={label} className="spot-cat">
            <summary>
              {label} <span className="label">· {g.cities.length}</span>
            </summary>
            <div className="visit-list">
              {g.cities
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <Link key={c.id} className="visit-row" to={`/place/${c.id}`}>
                    <span className="visit-main">{c.name}</span>
                  </Link>
                ))}
            </div>
          </details>
        ))}
      </details>
    </div>
  );
}

/** National Parks visited — counts saved places whose name reads like a national
 *  park / monument / forest, with a dropdown of which ones. */
function NationalParksCard({
  personId,
  placePeople,
}: {
  personId: string | null;
  placePeople: Map<string, Set<string>>;
}) {
  const [places, setPlaces] = useState<Place[] | null>(null);
  useEffect(() => {
    fetchPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]));
  }, []);
  if (!places) return null;

  const parks = places
    .filter(
      (p) =>
        p.saved &&
        !p.bucket &&
        (!personId || (placePeople.get(p.id)?.has(personId) ?? false)) &&
        /national (park|monument|forest|seashore|recreation area|historic)/i.test(p.name),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="card">
      <details className="stats-dropdown">
        <summary>National Parks</summary>
        <div className="our-stats" style={{ marginBottom: 10 }}>
          <div className="stat">
            <b>{parks.length}</b> <span className="label">visited</span>
          </div>
        </div>
        {parks.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>None logged yet.</p>
        ) : (
          <div className="visit-list">
            {parks.map((p) => (
              <Link key={p.id} className="visit-row" to={`/place/${p.id}`}>
                <span className="visit-main">{p.name}</span>
                {p.admin1 ? <span className="label"> · {p.admin1}</span> : null}
              </Link>
            ))}
          </div>
        )}
      </details>
    </div>
  );
}

/** Location tracking — turn on in-app tracking + show each person's last ping. */
function TrackingCard({ myId }: { myId: string }) {
  const [on, setOn] = useState(trackingPref());
  const [rows, setRows] = useState<TrackingStatus[] | null>(null);
  useEffect(() => {
    fetchTrackingStatus()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  function toggle() {
    const next = !on;
    setOn(next);
    setTrackingPref(next);
    if (next) startTracking(myId);
    else stopTracking();
  }
  const rel = (iso: string | null): string => {
    if (!iso) return 'never';
    const ms = Date.now() - new Date(iso).getTime();
    const d = Math.floor(ms / 86400000);
    if (d > 0) return `${d}d ago`;
    const h = Math.floor(ms / 3600000);
    if (h > 0) return `${h}h ago`;
    const m = Math.floor(ms / 60000);
    return m > 0 ? `${m}m ago` : 'just now';
  };
  return (
    <div className="card">
      <b>Location tracking</b>
      <p className="label" style={{ margin: '6px 0 10px' }}>
        Records your location while the app is open — powers the map fog, heatmap, and matching
        photos to places. Phones only track while the app is open (no background tracking on iPhone).
      </p>
      {trackingSupported() ? (
        <button className={on ? 'primary' : ''} onClick={toggle}>
          {on ? 'Tracking on — tap to stop' : 'Turn on tracking'}
        </button>
      ) : (
        <p className="label">This device can’t share its location.</p>
      )}
      {rows && (
        <div className="our-stats" style={{ marginTop: 10 }}>
          {rows
            .filter((r) => r.display_name !== 'Test Bot')
            .map((r) => (
              <div key={r.profile_id} className="stat">
                <b>{r.display_name ?? 'You'}</b>{' '}
                <span className="label">last {rel(r.last_ping)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/** Peaks bagged — summits reached, matched from hike GPS tracks against OSM peaks. */
function PeaksCard({ personId }: { personId: string | null }) {
  const [peaks, setPeaks] = useState<Peak[] | null>(null);
  const [climb, setClimb] = useState<{ total_ft: number; everests: number } | null>(null);
  useEffect(() => {
    fetchPeaksBagged(personId)
      .then(setPeaks)
      .catch(() => setPeaks([]));
    fetchClimbingStats(personId)
      .then(setClimb)
      .catch(() => setClimb(null));
  }, [personId]);
  if (!peaks) return null;
  return (
    <div className="card">
      <details className="stats-dropdown">
        <summary>Peaks &amp; climbing</summary>
        <div className="our-stats" style={{ marginBottom: 10 }}>
          <div className="stat">
            <b>{peaks.length}</b> <span className="label">summits</span>
          </div>
          {climb && climb.total_ft > 0 && (
            <>
              <div className="stat">
                <b>{climb.total_ft.toLocaleString()}</b> <span className="label">ft climbed</span>
              </div>
              <div className="stat">
                <b>{climb.everests}</b> <span className="label">Everests</span>
              </div>
            </>
          )}
        </div>
        {peaks.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>No summits matched yet.</p>
        ) : (
          <div className="visit-list">
            {peaks.map((p) =>
              p.place_id ? (
                <Link key={p.id} className="visit-row peak-row" to={`/place/${p.place_id}`}>
                  <span className="visit-main">{p.name}</span>
                  {p.ele_ft ? <span className="label"> · {p.ele_ft.toLocaleString()} ft</span> : null}
                </Link>
              ) : (
                <div key={p.id} className="visit-row peak-row">
                  <span className="visit-main">{p.name}</span>
                  {p.ele_ft ? <span className="label"> · {p.ele_ft.toLocaleString()} ft</span> : null}
                </div>
              ),
            )}
          </div>
        )}
      </details>
    </div>
  );
}

/** The whole Stats section with one Me / Josh / Both toggle that drives every
 *  pill (each card refetches/refilters for the selected person). */
function StatsSection() {
  const [people, setPeople] = useState<MapPerson[]>([]);
  const [placePeople, setPlacePeople] = useState<Map<string, Set<string>>>(new Map());
  const [person, setPerson] = useState<string | null>(null); // null = Both
  useEffect(() => {
    fetchMapPeople().then(setPeople).catch(() => undefined);
    fetchPlacePeople().then(setPlacePeople).catch(() => undefined);
  }, []);
  const real = people.filter((p) => p.display_name !== 'Test Bot');
  return (
    <>
      <div className="stats-toggle">
        <button className={person === null ? 'on' : ''} onClick={() => setPerson(null)} type="button">
          Both
        </button>
        {real.map((pp) => (
          <button
            key={pp.id}
            className={person === pp.id ? 'on' : ''}
            onClick={() => setPerson(pp.id)}
            type="button"
          >
            {pp.display_name ?? 'Me'}
          </button>
        ))}
      </div>
      <div className="stats-row">
        <OurStatsCard personId={person} />
        <PlacesByStateCard personId={person} placePeople={placePeople} />
        <NationalParksCard personId={person} placePeople={placePeople} />
        <PeaksCard personId={person} />
        <Link className="card stat-navcard" to="/trips">
          Trips
        </Link>
        <Link className="card stat-navcard" to="/wrapped">
          Years
        </Link>
      </div>
    </>
  );
}

/** Owner toggle: globe vs Mercator projection (falls back without a deploy). */
function ProjectionCard() {
  const [proj, setProj] = useState<MapProjection | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetchMapProjection()
      .then(setProj)
      .catch(() => setProj('globe'));
  }, []);
  async function choose(t: MapProjection) {
    if (t === proj) return;
    setBusy(true);
    try {
      await setMapProjection(t);
      setProj(t);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card">
      <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 13 }}>
        Map projection — reload the map to see the change.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          disabled={busy}
          className={proj === 'globe' ? 'primary' : ''}
          onClick={() => void choose('globe')}
        >
          Globe
        </button>
        <button
          disabled={busy}
          className={proj === 'mercator' ? 'primary' : ''}
          onClick={() => void choose('mercator')}
        >
          Flat (Mercator)
        </button>
      </div>
    </div>
  );
}

/** Export all our places as CSV / GPX / KML (generated in the browser). */
function ExportCard() {
  const [places, setPlaces] = useState<Place[] | null>(null);
  useEffect(() => {
    fetchPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]));
  }, []);
  const n = (places ?? []).filter((p) => p.saved && !p.bucket && p.name.trim()).length;
  return (
    <div className="card">
      <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 13 }}>
        Download all {n} places — CSV for spreadsheets, GPX/KML for maps &amp; Google Earth.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button disabled={!places} onClick={() => places && exportCsv(places)}>
          CSV
        </button>
        <button disabled={!places} onClick={() => places && exportGpx(places)}>
          GPX
        </button>
        <button disabled={!places} onClick={() => places && exportKml(places)}>
          KML
        </button>
      </div>
    </div>
  );
}

/** Upload Garmin (or any) GPX/TCX activity files — the Strava-limit workaround.
 *  Parses each client-side and imports it, attributed to whoever's signed in. */
function GarminImportCard() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onFiles(files: FileList) {
    setBusy(true);
    let added = 0;
    const problems: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const parsed = /\.fit$/i.test(file.name)
          ? await parseFitActivity(await file.arrayBuffer(), file.name)
          : parseActivityFile(await file.text(), file.name);
        if (!parsed) {
          problems.push(`${file.name}: no GPS track found`);
          continue;
        }
        await importFileActivity(parsed);
        added++;
      } catch (e) {
        // Surface the real reason instead of a silent "couldn't be read".
        problems.push(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
      }
      setMsg(`Imported ${added}${problems.length ? `, ${problems.length} failed` : ''}…`);
    }
    setMsg(
      `Done — ${added} activit${added === 1 ? 'y' : 'ies'} imported.` +
        (problems.length ? ` Couldn't import: ${problems.join('; ')}` : '') +
        ' Re-importing the same file is safe (duplicates are ignored).',
    );
    setBusy(false);
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <b>Import from Garmin (GPX / TCX / FIT)</b>
      <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 10px' }}>
        Strava only lets one athlete connect, so bring your Garmin activities in as files instead.
        You can upload the <b>.FIT</b> files straight from your watch/Garmin Connect, or export an
        activity as GPX/TCX (gear icon → <b>Export</b>). They're attributed to you, and importing the
        same file twice is safe.
      </div>
      <button className="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? 'Importing…' : 'Choose GPX / TCX / FIT files'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".gpx,.tcx,.fit,application/gpx+xml,application/xml,text/xml,application/octet-stream"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files && e.target.files.length) void onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {msg && (
        <div className="banner" style={{ marginTop: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}

function StravaCard({ myId, isOwner }: { myId: string; isOwner: boolean }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const clientId = import.meta.env.VITE_STRAVA_CLIENT_ID;

  useEffect(() => {
    isMyStravaConnected().then(setConnected);
    const params = new URLSearchParams(window.location.search);
    if (params.get('strava') === 'connected') setConnected(true);
  }, []);

  async function runBackfill(days: number) {
    setRunning(true);
    setProgress('Starting…');
    const before = Math.floor(Date.now() / 1000);
    const after = before - days * 86400;
    let page = 1;
    let stored = 0;
    let processed = 0;
    try {
      for (;;) {
        const r = await backfillPage(after, before, page);
        stored += r.stored;
        processed += r.processed;
        setProgress(`Page ${page}: ${processed} activities scanned, ${stored} stored…`);
        if (!r.hasMore) break;
        page++;
        await sleep(1500); // gentle pacing under the 100/15min limit
      }
      setProgress(`Done — ${stored} activities stored from the last ${days} days.`);
    } catch (e) {
      setProgress(e instanceof Error ? e.message : 'Backfill failed');
    }
    setRunning(false);
  }

  if (!clientId) {
    return (
      <div className="card">
        <b>Strava</b>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
          Set <code>VITE_STRAVA_CLIENT_ID</code> (and the server secrets) after creating the Strava
          API app — see MANUAL-SETUP §6.
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <b>Strava</b>
      {connected === null ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>Checking…</div>
      ) : connected ? (
        <>
          <div style={{ color: '#4dd07a', fontSize: 13, margin: '4px 0 10px' }}>
            ✓ Your Strava is connected. New activities import automatically.
          </div>
          {isOwner && (
            <>
              <div className="btn-row" style={{ marginTop: 0 }}>
                <button disabled={running} onClick={() => void runBackfill(3650)}>
                  {running ? 'Importing…' : 'Backfill all history (both of you)'}
                </button>
                <button disabled={running} onClick={() => void runBackfill(365)}>
                  Last 12 months
                </button>
              </div>
              {progress && (
                <div className="banner" style={{ marginTop: 8 }}>
                  {progress}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 10px' }}>
            Connect your Strava to auto-import your hikes, walks, runs, and rides. To pull in Garmin
            activities, turn on <b>Garmin Connect → Strava</b> in Garmin Connect — they'll flow in
            through Strava, no separate Garmin connection needed.
          </div>
          <a href={stravaAuthorizeUrl(clientId, myId)}>
            <button className="primary">Connect Strava</button>
          </a>
        </>
      )}
    </div>
  );
}

export default function Settings() {
  const { profile, signOut } = useAuth();

  return (
    <div
      className="settings-page"
      style={{ maxWidth: 640, margin: '40px auto', padding: '0 20px' }}
    >
      <Link className="back-bar" to="/">
        <span>Map</span>
      </Link>
      <h1>Settings</h1>
      <p style={{ color: 'var(--muted)' }}>
        Signed in as <b>{profile?.display_name ?? 'you'}</b> · role <b>{profile?.role}</b>
      </p>

      <h2 style={{ marginTop: 28 }}>Account</h2>
      <button onClick={() => void signOut()}>Sign out</button>

      <h2 style={{ marginTop: 28 }}>Stats</h2>
      <StatsSection />

      {(profile?.role === 'owner' || profile?.role === 'editor') && (
        <>
          <h2 style={{ marginTop: 28 }}>Edit all places</h2>
          <div className="card">
            <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 14 }}>
              One table for every place — rename, fix the city/state/country, retag, rate, set visit
              dates and who was there, and add photos straight from Google Photos.
            </p>
            <div className="btn-row" style={{ marginTop: 4 }}>
              <Link to="/places/edit">
                <button className="primary">Open the places table</button>
              </Link>
              <Link to="/photos/sort">
                <button>Sort photos into places</button>
              </Link>
              <Link to="/attention">
                <button>Needs attention</button>
              </Link>
              <Link to="/albums">
                <button>Smart albums</button>
              </Link>
              <Link to="/timeline">
                <button>Timeline</button>
              </Link>
              <Link to="/duplicates">
                <button>Duplicate places</button>
              </Link>
              <Link to="/trash">
                <button>Trash</button>
              </Link>
            </div>
          </div>
        </>
      )}

      {profile && (
        <>
          <h2 style={{ marginTop: 28 }}>Location tracking</h2>
          <TrackingCard myId={profile.id} />
        </>
      )}

      <h2 style={{ marginTop: 28 }}>Tags</h2>
      <TagsCard />

      <h2 style={{ marginTop: 28 }}>Export our data</h2>
      <ExportCard />

      {profile?.role === 'owner' && (
        <>
          <h2 style={{ marginTop: 28 }}>Map</h2>
          <ProjectionCard />
        </>
      )}

      <h2 style={{ marginTop: 28 }}>Shared — Erica &amp; Josh</h2>
      <SharedHub />

      {profile && (
        <>
          <h2 style={{ marginTop: 28 }}>Strava &amp; Garmin</h2>
          <StravaCard myId={profile.id} isOwner={profile.role === 'owner'} />
          <GarminImportCard />
        </>
      )}

      {profile?.role === 'owner' && (
        <>
          <h2 style={{ marginTop: 28 }}>Join requests</h2>
          <JoinRequestsCard />

          <h2 style={{ marginTop: 28 }}>People</h2>
          <PeopleCard meId={profile.id} />

          <h2 style={{ marginTop: 28 }}>Places &amp; location</h2>
          <HomeZoneCard />
          <GeocodeCard />
        </>
      )}
    </div>
  );
}
