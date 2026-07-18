import { Link } from 'react-router-dom';
import type { Place } from '../lib/types';

interface Props {
  places: Place[];
  addMode: boolean;
  onToggleAdd: () => void;
}

function uniqueCount(values: (string | null)[]): number {
  return new Set(values.filter((v): v is string => !!v && v.trim() !== '')).size;
}

export default function StatsBar({ places, addMode, onToggleAdd }: Props) {
  const countries = uniqueCount(places.map((p) => p.country));
  const states = uniqueCount(places.map((p) => p.admin1));

  return (
    <div className="stats-bar">
      <div className="stat">
        <b>{places.length}</b> <span className="label">places</span>
      </div>
      <div className="stat">
        <b>{countries}</b> <span className="label">countries</span>
      </div>
      <div className="stat">
        <b>{states}</b> <span className="label">states</span>
      </div>
      {/* Total miles — wired to Strava activities in Phase 4. TODO(Phase 4) */}
      <div className="stat" title="Total Strava miles — coming in Phase 4">
        <b>0.0</b> <span className="label">miles</span>
      </div>

      <div className="spacer" />

      <div className="actions">
        <button className={addMode ? 'primary' : ''} onClick={onToggleAdd}>
          {addMode ? 'Click map to place…' : '+ Add place'}
        </button>
        <Link to="/settings">
          <button>Settings</button>
        </Link>
      </div>
    </div>
  );
}
