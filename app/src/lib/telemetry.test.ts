import { describe, expect, it, beforeEach } from 'vitest';
import { redact, redactString, diag, exportDiagnostics, clearDiagnostics } from './telemetry';

describe('redactString', () => {
  it('scrubs JWTs, sb_ keys, emails, uuids, and long hex', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEFghiJKLmno';
    expect(redactString(`token=${jwt}`)).not.toContain('eyJ');
    expect(redactString('sb_secret_abcDEF1234567890')).toBe('[sb_key]');
    expect(redactString('reach me at erica@example.com now')).toContain('[email]');
    expect(redactString('id 3c7c467b-2526-4414-8da4-e79402424444 here')).toContain('[id]');
    expect(redactString('sha ' + 'a'.repeat(64))).toContain('[hex]');
  });
});

describe('redact (deep)', () => {
  it('drops sensitive keys entirely and scrubs nested strings', () => {
    const out = redact({
      ok: true,
      count: 3,
      email: 'erica@example.com',
      note: 'a private memory',
      lat: 38.9,
      lng: -77.0,
      url: 'https://x/y?token=eyJabc.def.ghi',
      nested: { access_token: 'secret', caption: 'photo caption', fine: 'hello' },
    }) as Record<string, unknown>;
    expect(out.ok).toBe(true);
    expect(out.count).toBe(3);
    expect(out.email).toBe('[redacted]');
    expect(out.note).toBe('[redacted]');
    expect(out.lat).toBe('[redacted]');
    expect(out.lng).toBe('[redacted]');
    expect(out.url).toBe('[redacted]');
    const nested = out.nested as Record<string, unknown>;
    expect(nested.access_token).toBe('[redacted]');
    expect(nested.caption).toBe('[redacted]');
    expect(nested.fine).toBe('hello');
  });
});

describe('diag / local buffer', () => {
  beforeEach(() => clearDiagnostics());
  it('stores redacted events locally and never emits by default', () => {
    diag('info', 'upload_done', { placeId: '3c7c467b-2526-4414-8da4-e79402424444', count: 2 });
    const events = exportDiagnostics();
    expect(events).toHaveLength(1);
    expect(events[0].level).toBe('info');
    expect(events[0].event).toBe('upload_done');
    // placeId is a uuid → redacted inside the string scrub / it's under a non-listed
    // key so the uuid value is scrubbed to [id] by the string path only if a string;
    // here it's a string uuid value, scrubbed:
    expect(JSON.stringify(events[0])).not.toContain('3c7c467b');
  });
});
