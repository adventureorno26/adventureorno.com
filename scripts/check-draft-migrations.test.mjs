// The two prose-reading rules, pinned. The network half is exercised by running the
// script; these are the parts that decide whether a file is LYING, and a false positive
// here would block every legitimate draft branch.
import { describe, expect, it } from 'vitest';
import { claimsUnapplied, versionOf, headerVersion } from './check-draft-migrations.mjs';

describe('claimsUnapplied', () => {
  it('catches the exact sentence 0290 shipped with', () => {
    expect(
      claimsUnapplied(
        '-- 0290 — the readers say which space they are reading.\n--\n' +
          '-- DRAFT — REHEARSED, NOT APPLIED. Nothing in this file has been run against production\n' +
          '-- outside a transaction that was rolled back.\n',
      ),
    ).toBe(true);
  });

  it('catches DO NOT APPLY', () => {
    expect(claimsUnapplied('-- 0291 — something.\n-- DRAFT — DO NOT MERGE / DO NOT APPLY\n')).toBe(
      true,
    );
  });

  it('does NOT fire on the word draft used in ordinary prose', () => {
    // The failure mode that would make this check useless: firing on any mention.
    expect(
      claimsUnapplied(
        '-- 0250 — a real migration.\n-- This supersedes the draft approach we discussed,\n' +
          '-- which applied the constraint before the backfill.\n',
      ),
    ).toBe(false);
  });

  it('a plain APPLIED TO PRODUCTION beats a quoted draft sentence', () => {
    // THE REGRESSION THIS PINS: the first version of the check fired on its own fix.
    // House style says a corrected line records what it used to say, so the old sentence
    // stays in the header as a quote — and it must not be read as a live claim.
    expect(
      claimsUnapplied(
        '-- 0290 — the readers say which space they are reading.\n--\n' +
          '-- APPLIED TO PRODUCTION. Corrected 2026-08-30 — this header said the opposite.\n--\n' +
          '-- IT USED TO SAY: "DRAFT — REHEARSED, NOT APPLIED. Nothing in this file has been\n' +
          '-- run against production outside a transaction that was rolled back."\n',
      ),
    ).toBe(false);
  });

  it('does not read past the header into the body', () => {
    const body = '-- 0251 — fine.\n' + '--\n'.repeat(60) + '-- DO NOT APPLY (a note in the body)\n';
    expect(claimsUnapplied(body)).toBe(false);
  });
});

describe('versionOf', () => {
  it('reads the number off the filename', () => {
    expect(versionOf('0289_a_space_is_the_boundary_and_it_says_so.sql')).toBe('0289');
    expect(versionOf('0001_init.sql')).toBe('0001');
  });
  it('returns null when there is no number to read', () => {
    expect(versionOf('README.sql')).toBeNull();
  });
});

describe('headerVersion', () => {
  it('reads the number the file calls itself on line one', () => {
    expect(headerVersion('-- 0287 — a space is the boundary, and every rule says so.\n')).toBe(
      '0287',
    );
  });
  it('is null when line one does not open with a number', () => {
    expect(headerVersion('-- a space is the boundary.\n-- 0287 later on\n')).toBeNull();
  });
  it('pins the real mismatch: file 0289, header 0287', () => {
    const file = '0289_a_space_is_the_boundary_and_it_says_so.sql';
    const sql = '-- 0287 — a space is the boundary, and every rule says so out loud.\n';
    expect(headerVersion(sql)).not.toBe(versionOf(file));
  });
});
