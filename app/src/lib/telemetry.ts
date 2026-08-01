// Privacy-safe telemetry (Prompt 8). DEFAULT: local-only structured diagnostics you
// can export manually — NOTHING leaves the device. A network sink exists but is
// disabled and inert until explicitly configured AND consented, so no diagnostic can
// reach a remote endpoint by default.
//
// Every payload is REDACTED before it's stored or (potentially, later) exported:
// tokens, signed URLs, media/R2 keys, emails, profile ids (uuids), coordinates,
// notes/captions/reviews/bodies. The redactor is the privacy boundary and is unit
// tested.

export type DiagLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagEvent {
  t: number; // epoch ms
  level: DiagLevel;
  event: string;
  data?: Record<string, unknown>;
}

// --- Redaction --------------------------------------------------------------
const REDACT_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'apikey',
  'api_key',
  'authorization',
  'password',
  'secret',
  'url', // signed URLs / any URL may carry a token or key
  'signed_url',
  'action_link',
  'r2_key',
  'key',
  'thumb_key',
  'poster_key',
  'email',
  'note',
  'body',
  'caption',
  'review',
  'title',
  'lat',
  'lng',
  'latitude',
  'longitude',
  'coordinates',
  'geom',
]);

const JWT_RE = /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g;
const SB_KEY_RE = /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const LONGHEX_RE = /\b[0-9a-f]{32,}\b/gi; // sha256 / hashes / raw keys
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Scrub sensitive substrings from a free string. */
export function redactString(s: string): string {
  return s
    .replace(JWT_RE, '[jwt]')
    .replace(SB_KEY_RE, '[sb_key]')
    .replace(EMAIL_RE, '[email]')
    .replace(UUID_RE, '[id]')
    .replace(LONGHEX_RE, '[hex]');
}

/** Deep-redact a value: sensitive KEYS are dropped entirely; strings are scrubbed. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(k.toLowerCase())) {
        out[k] = '[redacted]';
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return '[unserializable]';
}

// --- Local diagnostics buffer -----------------------------------------------
const MAX_EVENTS = 500;
const buffer: DiagEvent[] = [];

export function diag(level: DiagLevel, event: string, data?: Record<string, unknown>): void {
  const e: DiagEvent = {
    t: Date.now(),
    level,
    event: redactString(event),
    ...(data ? { data: redact(data) as Record<string, unknown> } : {}),
  };
  buffer.push(e);
  if (buffer.length > MAX_EVENTS) buffer.shift();
  // A remote sink runs ONLY when explicitly enabled + consented (default: never).
  if (sink.enabled) void sink.send(e);
}

/** The current local diagnostics, for manual export (already redacted). */
export function exportDiagnostics(): DiagEvent[] {
  return buffer.slice();
}

export function clearDiagnostics(): void {
  buffer.length = 0;
}

// --- Optional, disabled-by-default network sink -----------------------------
// An OTLP/Sentry-compatible adapter for a FUTURE self-hosted endpoint. It is inert
// until enableRemoteTelemetry() is called with an explicit endpoint AND consent —
// there is no default endpoint, so nothing can be transmitted out of the box.
interface Sink {
  enabled: boolean;
  endpoint: string | null;
  send: (e: DiagEvent) => Promise<void>;
}

const sink: Sink = {
  enabled: false,
  endpoint: null,
  async send(e: DiagEvent) {
    if (!this.enabled || !this.endpoint) return; // fail closed
    // Only redacted events ever reach here (diag() redacts before buffering).
    await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(e),
    }).catch(() => undefined);
  },
};

/** Opt in to a remote diagnostics endpoint. Requires BOTH an endpoint and explicit
 *  consent=true; otherwise stays local-only. No-op unless called by the app. */
export function enableRemoteTelemetry(endpoint: string, consent: boolean): boolean {
  if (!consent || !endpoint) return false;
  sink.endpoint = endpoint;
  sink.enabled = true;
  return true;
}

export function disableRemoteTelemetry(): void {
  sink.enabled = false;
  sink.endpoint = null;
}
