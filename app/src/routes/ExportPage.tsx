// Export & backup — one screen, and three different things that are no longer
// pretending to be one.
//
// WHY THIS EXISTS. §3e Step 7. Two screens offered an "export" and both overstated it:
//
//   Data health : "Download everything you can take with you."   → 162 places.
//   Settings    : "Download all 162 places"                       → the same three buttons.
//
// 567 activities, 552 visits, 178 photos, 619 pieces of visit evidence, 17,128 pings
// and every journal entry were not in it. The Data health sentence is the one that
// mattered: it told her the record was safe on her own disk when almost none of it was,
// and a backup you believe in and do not have is worse than no backup at all.
//
// So each card here says what it contains AND what it does not, and the archive shows
// its own table of contents — real row counts, fetched before anything is downloaded —
// rather than a promise.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchPlaces } from '../lib/data';
import {
  buildArchive,
  downloadArchive,
  exportActivitiesCsv,
  exportActivitiesGpx,
  exportCsv,
  exportGpx,
  exportKml,
  fetchArchiveManifest,
  fetchArchiveSection,
  type ArchiveSection,
  type ExportActivity,
} from '../lib/exports';
import type { Place } from '../lib/types';

/** Sections a person reads as one thing, in the order the screen tells the story.
 *  Everything not named here still goes in the archive and still appears in the
 *  table of contents — this only decides what is worth a line of its own. */
const HEADLINE = new Set(['places', 'visits', 'activities', 'photos', 'entries', 'location_pings']);

const fmt = (n: number) => n.toLocaleString();

export default function ExportPage() {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [manifest, setManifest] = useState<ArchiveSection[] | null | undefined>(undefined);
  const [activities, setActivities] = useState<ExportActivity[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; now: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetchPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]));
    fetchArchiveManifest()
      .then(setManifest)
      .catch(() => setManifest(null));
  }, []);

  const nPlaces = (places ?? []).filter((p) => p.saved && !p.bucket && p.name.trim()).length;
  const row = (s: string) => manifest?.find((m) => m.section === s)?.rows ?? 0;
  const totalRows = (manifest ?? []).reduce((a, m) => a + m.rows, 0);
  const withRoute = activities?.filter((a) => a.summary_polyline).length ?? null;

  /** The activities export needs the rows themselves, which is the same query the
   *  archive uses — fetched once, on first use, rather than on page load. */
  async function withActivities(then: (rows: ExportActivity[]) => void) {
    setError(null);
    if (activities) return then(activities);
    setBusy('activities');
    try {
      const rows = (await fetchArchiveSection('activities')) as ExportActivity[];
      setActivities(rows);
      then(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the activities.');
    } finally {
      setBusy(null);
    }
  }

  async function archive() {
    setError(null);
    setBusy('archive');
    try {
      const json = await buildArchive((done, total, now) => setProgress({ done, total, now }));
      downloadArchive(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the archive.');
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const shown = showAll
    ? (manifest ?? [])
    : (manifest ?? []).filter((m) => HEADLINE.has(m.section));

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Link className="back-bar" to="/settings">
        <span>Settings</span>
      </Link>
      <h1>Export &amp; backup</h1>
      <p className="label" style={{ marginTop: -6 }}>
        Three different things. The first two are for opening somewhere else; the third is the copy
        you keep.
      </p>

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger, #c0392b)' }}>
          <b>That didn’t work</b>
          <p className="label" style={{ margin: '6px 0 0' }}>
            {error}
          </p>
        </div>
      )}

      {/* ---- 1. Places ------------------------------------------------------ */}
      <h2 style={{ marginTop: 24 }}>The places</h2>
      <div className="card">
        <p className="label" style={{ margin: '0 0 10px' }}>
          {places ? fmt(nPlaces) : '…'} places — name, coordinates, city, categories, rating, first
          and last visit. CSV opens in a spreadsheet; GPX and KML open in a map or Google Earth.
        </p>
        <p className="label" style={{ margin: '0 0 10px' }}>
          <b>Not</b> the visits to them, the photos, or the outings — those are below.
        </p>
        <div className="btn-row">
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

      {/* ---- 2. Activities -------------------------------------------------- */}
      <h2 style={{ marginTop: 24 }}>The outings</h2>
      <div className="card">
        <p className="label" style={{ margin: '0 0 10px' }}>
          {manifest ? fmt(row('activities')) : '…'} outings — date, name, type, miles, moving and
          elapsed time, climb, where it was, who recorded it, and where it came from. GPX writes one
          track per outing that has a route
          {withRoute != null && activities
            ? ` (${fmt(withRoute)} of ${fmt(activities.length)})`
            : ''}
          ; the rest are in the CSV.
        </p>
        <p className="label" style={{ margin: '0 0 10px' }}>
          This is <b>what you can see</b>. An outing whose owner hasn’t chosen to share it isn’t
          here, and exporting doesn’t go around that.
        </p>
        <div className="btn-row">
          <button
            disabled={busy !== null}
            onClick={() => withActivities((rows) => exportActivitiesCsv(rows))}
          >
            {busy === 'activities' ? 'Loading…' : 'CSV'}
          </button>
          <button
            disabled={busy !== null}
            onClick={() => withActivities((rows) => exportActivitiesGpx(rows))}
          >
            {busy === 'activities' ? 'Loading…' : 'GPX'}
          </button>
        </div>
      </div>

      {/* ---- 3. Everything --------------------------------------------------- */}
      <h2 style={{ marginTop: 24 }}>Everything</h2>
      <div className="card">
        <p className="label" style={{ margin: '0 0 10px' }}>
          One JSON file with {manifest ? fmt(totalRows) : '…'} rows across{' '}
          {manifest ? manifest.length : '…'} sections. This is the whole record, not a summary of
          it.
        </p>

        {manifest === undefined ? (
          <p className="label">Reading what’s here…</p>
        ) : manifest === null ? (
          <p className="label">Couldn’t read the contents.</p>
        ) : (
          <>
            <div className="ex-toc">
              {shown.map((m) => (
                <div key={m.section} className="ex-toc-row">
                  <b>{fmt(m.rows)}</b>
                  <span>
                    {m.section.replace(/_/g, ' ')}
                    <span className="label"> — {m.note}</span>
                  </span>
                </div>
              ))}
            </div>
            <button className="link-btn" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show the main sections only' : `Show all ${manifest.length} sections`}
            </button>
          </>
        )}

        <p className="label" style={{ margin: '12px 0 6px' }}>
          <b>Four things are deliberately not in it:</b>
        </p>
        <ul className="label ex-absent">
          <li>
            <b>The photo and video files.</b> This holds their dates, places, file names and hashes
            — the images themselves stay in storage. That’s what the nightly off-site backup is for.
          </li>
          <li>
            <b>Sign-in credentials.</b> Strava, Google and device tokens are left out on purpose;
            restoring them would restore someone’s ability to act as you. They come back by signing
            in again.
          </li>
          <li>
            <b>Anything you can’t see in the app.</b> An outing its owner hasn’t shared isn’t here.
          </li>
          <li>
            <b>Machine proposals and logs.</b> Pending suggestions, job runs, health checks — all
            re-derivable, and none of it is a record of anywhere anyone went.
          </li>
        </ul>

        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={busy !== null || !manifest} onClick={archive}>
            {busy === 'archive' ? 'Building…' : 'Build the archive'}
          </button>
        </div>
        {progress && (
          <p className="label" style={{ margin: '8px 0 0' }}>
            {progress.now
              ? `${progress.now.replace(/_/g, ' ')} — ${progress.done + 1} of ${progress.total}`
              : 'Writing the file…'}
          </p>
        )}
      </div>

      {/* ---- 4. The other copy ---------------------------------------------- */}
      <h2 style={{ marginTop: 24 }}>The copy you don’t have to make</h2>
      <div className="card">
        <p className="label" style={{ margin: 0 }}>
          Separately from all of this, the database is dumped every night at 03:17 Eastern,
          encrypted before it leaves the server, and uploaded off-site — photo and video files
          included. A separate job restores the newest one into a throwaway database and checks
          every row count, because a backup nobody has restored is a guess.
        </p>
        <p className="label" style={{ margin: '10px 0 0' }}>
          That copy survives losing this laptop. The archive above is the copy you hold yourself, in
          a format that doesn’t need this app to read.
        </p>
      </div>
    </div>
  );
}
