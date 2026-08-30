import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { importPoints, parseTimeline, runClusteringNow } from '../lib/timeline';
import { triggerGeocode } from '../lib/data';

export default function ImportTimeline() {
  const { profile } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (profile && profile.role !== 'owner') return <Navigate to="/settings/integrations" replace />;

  async function handleFile(file: File) {
    setBusy(true);
    setStatus('Reading file…');
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const all = parseTimeline(json);
      if (all.length === 0) {
        setStatus(
          'No location points found in that file. Is it a Timeline/Location History export?',
        );
        setBusy(false);
        return;
      }
      // Only the last 7 months (points with no timestamp are kept).
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 7);
      const points = all.filter((p) => !p.time || new Date(p.time) >= cutoff);
      if (points.length === 0) {
        setStatus(`Found ${all.length} points but none within the last 7 months.`);
        setBusy(false);
        return;
      }
      setStatus(
        `Found ${all.length.toLocaleString()} points; importing ${points.length.toLocaleString()} from the last 7 months…`,
      );
      const saved = await importPoints(points, (sent, total, saved) => {
        setStatus(
          `Uploading ${sent.toLocaleString()}/${total.toLocaleString()} — ${saved.toLocaleString()} stored (home-zone points skipped)…`,
        );
      });
      setStatus(`Imported ${saved.toLocaleString()} points. Clustering into places…`);
      const c = await runClusteringNow();
      setStatus(
        `Clustered: ${c.clusters_created} new places, ${c.clusters_attached} attached. Naming…`,
      );
      const g = await triggerGeocode();
      setStatus(
        `Done — ${saved.toLocaleString()} points imported, ${c.clusters_created} new places created, ${g.named} named. Check the map.`,
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Import failed');
    }
    setBusy(false);
  }

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 20px' }}>
      <Link className="back-bar" to="/settings/integrations">
        <span>Settings</span>
      </Link>
      <h1>Import Google Timeline</h1>
      <p style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
        Optional. If you had Google Maps Timeline / Location History, export it (Google Takeout →
        Location History, or Google Maps app → Settings → Your Timeline → Export) and drop the JSON
        here. Points are clustered into places. If you never used Google Timeline, skip this —
        photos + Strava already cover the year.
      </p>

      <div className="card" style={{ marginTop: 16 }}>
        <label>Timeline JSON file</label>
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
        {status && (
          <div className="banner" style={{ marginTop: 10 }}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
}
