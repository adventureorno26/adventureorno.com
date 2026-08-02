// HTTP-boundary input validation (Prompt 3). Pure functions, no Worker/WASM deps,
// so they're unit-testable in isolation.

// A coordinate is acceptable when absent, or finite AND within earthly range.
// Rejecting NaN / out-of-range stops a malformed request from storing a junk
// location or mis-placing a photo.
export function coordOk(v: number | null, min: number, max: number): boolean {
  return v == null || (Number.isFinite(v) && v >= min && v <= max);
}

// Magic-bytes check: a JPEG starts FF D8 FF. The manual upload path stores the
// client-rendered bytes DIRECTLY (no server decode), so without this an attacker
// could store arbitrary bytes (or a PNG, banned by rule #5) as a "photo". The
// raw/Shortcut path is already gated because it must decode successfully.
export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// A taken-at is only kept when it parses to a real, sane date; otherwise it's
// dropped (fall back to EXIF) rather than stored as a bogus timestamp.
export function sanitizeTakenAt(s: string | null): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const year = new Date(t).getUTCFullYear();
  if (year < 1970 || year > 2100) return null;
  return s;
}
