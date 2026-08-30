// The one piece of invite-code logic that lives in the browser: how a code is SHOWN.
//
// Everything that decides anything — unknown, expired, revoked, already used — is in
// the database (0287), because only the database can tell those apart and each needs
// different words. The browser's whole job is to group ten characters so a person can
// read them down a phone line, and to never let that grouping reach the server: the
// dashes are decoration, and `normalize_invite_code` throws them away again.
import { describe, expect, it } from 'vitest';
import { formatInviteCode } from './inviteCodes';

describe('formatInviteCode', () => {
  it('groups a ten-character code into two fives', () => {
    expect(formatInviteCode('K4W2M8XPJ3')).toBe('K4W2M-8XPJ3');
  });

  it('upper-cases and trims what it was handed', () => {
    expect(formatInviteCode('  k4w2m8xpj3 ')).toBe('K4W2M-8XPJ3');
  });

  it('leaves anything that is not ten characters alone rather than mis-grouping it', () => {
    // A half-typed code must not acquire a dash in the middle of nowhere, and a code
    // from some future length must not be silently truncated into a wrong-looking one.
    expect(formatInviteCode('K4W2M')).toBe('K4W2M');
    expect(formatInviteCode('K4W2M8XPJ34')).toBe('K4W2M8XPJ34');
    expect(formatInviteCode('')).toBe('');
  });

  it('is idempotent — formatting an already-formatted code changes nothing', () => {
    // The list re-renders on every load; a second pass must not produce K4W2M--8XPJ3.
    const once = formatInviteCode('K4W2M8XPJ3');
    expect(formatInviteCode(once)).toBe(once);
  });
});
