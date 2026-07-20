import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchOnThisDay, photosEnabled, type OnThisDayItem } from '../lib/photos';
import AuthedImg from './AuthedImg';

/** A small, dismissible "On this day, N years ago" card in the map's bottom-left.
 *  Renders nothing when there's no memory for today, or once dismissed. */
export default function OnThisDay() {
  const [items, setItems] = useState<OnThisDayItem[] | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('otd-dismissed') === new Date().toDateString();
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!photosEnabled()) return;
    let active = true;
    fetchOnThisDay()
      .then((r) => active && setItems(r))
      .catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, []);

  if (dismissed || !items || items.length === 0) return null;

  const top = items[0];
  const yearsAgo = new Date().getFullYear() - new Date(top.taken_at).getFullYear();
  const kicker =
    yearsAgo > 0 ? `On this day, ${yearsAgo} year${yearsAgo > 1 ? 's' : ''} ago` : 'On this day';

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem('otd-dismissed', new Date().toDateString());
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="on-this-day">
      <Link className="otd-main" to={`/place/${top.place_id}/day/${top.taken_at.slice(0, 10)}`}>
        <AuthedImg photoId={top.photo_id} size="thumb" className="otd-thumb" />
        <div className="otd-text">
          <div className="otd-kicker">{kicker}</div>
          <div className="otd-place">
            {top.place_name}
            {items.length > 1 ? ` · +${items.length - 1} more` : ''}
          </div>
        </div>
      </Link>
      <button className="otd-close" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
