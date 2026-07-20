import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchOnThisDay, type Memory } from '../lib/memories';

// Dismiss for the rest of the day (per browser).
function dismissedKey() {
  const d = new Date();
  return `aon-memory-dismissed-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** "On this day" card on the map: places visited on today's date in past years. */
export default function MemoryBanner() {
  const [mems, setMems] = useState<Memory[]>([]);
  const [hidden, setHidden] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (localStorage.getItem(dismissedKey())) return;
    void fetchOnThisDay().then((m) => {
      if (m.length > 0) {
        setMems(m);
        setHidden(false);
      }
    });
  }, []);

  if (hidden || mems.length === 0) return null;

  const primary = mems[0];
  const extra = mems.length - 1;
  const yrs = (n: number) => (n === 1 ? '1 year ago' : `${n} years ago`);

  return (
    <div className="memory-banner">
      <button
        className="memory-main"
        onClick={() => navigate(`/place/${primary.placeId}`)}
        title="Open this place"
      >
        <span className="memory-spark">✨</span>
        <span>
          <b>{yrs(primary.yearsAgo)} today</b> you were in <b>{primary.placeName}</b>
          {primary.admin1 ? `, ${primary.admin1}` : ''}
          {extra > 0 ? ` · +${extra} more memor${extra === 1 ? 'y' : 'ies'}` : ''}
        </span>
      </button>
      <button
        className="memory-x"
        aria-label="Dismiss"
        onClick={() => {
          localStorage.setItem(dismissedKey(), '1');
          setHidden(true);
        }}
      >
        ×
      </button>
    </div>
  );
}
