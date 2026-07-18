// Server-side resize via Photon (WASM, runs in Workers). Re-encoding to JPEG
// drops all EXIF — which is exactly how we strip GPS from the stored file
// (business rule #4). Coordinates live only in the DB.

import { PhotonImage, resize, SamplingFilter } from '@cf-wasm/photon';

export interface Rendered {
  bytes: Uint8Array;
  width: number;
  height: number;
}

function scaleToEdge(w: number, h: number, maxEdge: number): [number, number] {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return [w, h];
  const s = maxEdge / longest;
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

/** Produce a web-size (≤ maxEdge) and thumbnail (≤ thumbEdge) JPEG from the
 *  original bytes. Throws if the bytes aren't a decodable image. */
export function renderVariants(
  original: Uint8Array,
  maxEdge: number,
  thumbEdge: number,
): { web: Rendered; thumb: Rendered } {
  const img = PhotonImage.new_from_byteslice(original);
  try {
    const w = img.get_width();
    const h = img.get_height();

    const [ww, wh] = scaleToEdge(w, h, maxEdge);
    const webImg = ww === w && wh === h ? img : resize(img, ww, wh, SamplingFilter.Lanczos3);
    const web: Rendered = { bytes: webImg.get_bytes_jpeg(82), width: ww, height: wh };

    const [tw, th] = scaleToEdge(w, h, thumbEdge);
    const thumbImg = resize(img, tw, th, SamplingFilter.Lanczos3);
    const thumb: Rendered = { bytes: thumbImg.get_bytes_jpeg(78), width: tw, height: th };

    if (webImg !== img) webImg.free();
    thumbImg.free();
    return { web, thumb };
  } finally {
    img.free();
  }
}
