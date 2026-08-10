// Google-encoded polyline decoding.
//
// Every suggestion the route scorer makes rests on these numbers being right, and a
// silent bug here would poison all of them at once — a route decoded slightly wrong
// samples the wrong ground and confidently names the wrong park. So this lives on
// its own, has no dependencies, and is unit-tested against known values.
//
// Deliberately NO Deno APIs in this file: the test runner is vitest (there is no
// local Deno), and it can only cover code that is plain TypeScript.

export type LatLng = [number, number];

/**
 * Decode a Google-encoded polyline into [lat, lng] pairs.
 *
 * Strava's `summary_polyline` is precision 5. The algorithm: each coordinate is a
 * zig-zag-encoded delta, split into 5-bit chunks, each chunk offset by 63, with the
 * 0x20 bit set on every chunk except the last.
 *
 * Malformed input yields the points decoded so far rather than throwing — a bad
 * polyline should cost us one suggestion, not the whole batch.
 */
export function decodePolyline(encoded: string | null | undefined, precision = 5): LatLng[] {
  const s = encoded ?? '';
  const factor = Math.pow(10, precision);
  const out: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;

  while (i < s.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    // latitude delta
    do {
      if (i >= s.length) return out; // truncated input: keep what we have
      byte = s.charCodeAt(i++) - 63;
      if (byte < 0) return out;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;

    // longitude delta
    do {
      if (i >= s.length) return out;
      byte = s.charCodeAt(i++) - 63;
      if (byte < 0) return out;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    out.push([lat / factor, lng / factor]);
  }

  return out;
}
