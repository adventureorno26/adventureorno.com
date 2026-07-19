import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchVideoObjectUrl } from '../lib/videos';
import type { Video } from '../lib/types';

function fmtDate(v: Video): string {
  if (!v.taken_at) return '';
  const d = new Date(v.taken_at);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Full-screen video player (portal). Fetches the private bytes with the session
 *  bearer, plays them, and offers a download. */
export default function VideoPlayer({ video, onClose }: { video: Video; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let active = true;
    let made: string | null = null;
    fetchVideoObjectUrl(video.id)
      .then((u) => {
        if (!active) {
          URL.revokeObjectURL(u);
          return;
        }
        made = u;
        setUrl(u);
      })
      .catch(() => active && setErr(true));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      active = false;
      window.removeEventListener('keydown', onKey);
      if (made) URL.revokeObjectURL(made);
    };
  }, [video.id, onClose]);

  return createPortal(
    <div className="lightbox" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} title="Close">
        ×
      </button>
      {err ? (
        <div style={{ color: '#fff' }}>Couldn’t load this video.</div>
      ) : url ? (
        <video
          className="lightbox-img"
          src={url}
          controls
          autoPlay
          playsInline
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div style={{ color: '#fff' }}>Loading…</div>
      )}
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox-date">{fmtDate(video)}</span>
        {url && (
          <a className="lightbox-dl" href={url} download={`adventure-${video.id.slice(0, 8)}.mp4`}>
            ⤓ Download
          </a>
        )}
      </div>
    </div>,
    document.body,
  );
}
