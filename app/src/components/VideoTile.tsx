import { useEffect, useState } from 'react';
import { fetchVideoPosterUrl } from '../lib/videos';

/** A gallery tile for a video: its poster frame with a ▶ overlay. */
export default function VideoTile({ id, onClick }: { id: string; onClick: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let made: string | null = null;
    fetchVideoPosterUrl(id)
      .then((u) => {
        if (!active) {
          URL.revokeObjectURL(u);
          return;
        }
        made = u;
        setUrl(u);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id]);

  return (
    <button className="thumb video-thumb" onClick={onClick} title="Play video">
      {url ? (
        <img src={url} alt="" />
      ) : (
        <div className={failed ? 'img-fallback' : 'img-skeleton'} />
      )}
      <span className="video-play">▶</span>
    </button>
  );
}
