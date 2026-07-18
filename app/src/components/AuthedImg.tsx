import { useEffect, useState } from 'react';
import { fetchPhotoObjectUrl } from '../lib/photos';

interface Props {
  photoId: string;
  size: 'full' | 'thumb';
  alt?: string;
  className?: string;
  onClick?: () => void;
}

/** Loads a private photo by fetching bytes with the session bearer and showing
 *  the resulting object URL. Revokes the URL on unmount / id change. */
export default function AuthedImg({ photoId, size, alt = '', className, onClick }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let created: string | null = null;
    setUrl(null);
    setFailed(false);
    fetchPhotoObjectUrl(photoId, size)
      .then((u) => {
        if (!active) {
          URL.revokeObjectURL(u);
          return;
        }
        created = u;
        setUrl(u);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [photoId, size]);

  if (failed) return <div className={`img-fallback ${className ?? ''}`}>⚠️</div>;
  if (!url) return <div className={`img-skeleton ${className ?? ''}`} />;
  return <img src={url} alt={alt} className={className} onClick={onClick} loading="lazy" />;
}
