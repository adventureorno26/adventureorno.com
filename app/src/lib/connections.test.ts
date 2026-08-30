// The rules a connections screen must not get wrong, tested without a database.
//
// Two of them are the reason this file exists at all:
//
//   * a row must offer the action that FITS the relationship — `Accept` to somebody who
//     never asked is a button that does nothing and reads as broken;
//   * a block is the whole answer. 0284's trigger deletes the add and both follows the
//     moment a block is written, so a screen still showing "Added" beside "Unblock" would
//     be reporting a relationship the database has already ended.
//
// And the word is **add**. The last test fails the build if the other one is written into
// any label, hint or sentence this module produces.
import { describe, expect, it } from 'vitest';
import {
  NO_RELATIONSHIP,
  actionsFor,
  relationshipOf,
  relationshipSentence,
  relationshipsFrom,
  rpcFor,
  doneSaying,
  triedSaying,
  type ActionKey,
  type ConnectionRow,
  type Relationship,
} from './connections';

const rel = (over: Partial<Relationship> = {}): Relationship => ({ ...NO_RELATIONSHIP, ...over });

const row = (over: Partial<ConnectionRow>): ConnectionRow => ({
  profile_id: 'them',
  display_name: 'Them',
  relation: 'add',
  status: 'accepted',
  direction: 'mutual',
  since: '2026-08-30T00:00:00Z',
  ...over,
});

const keys = (r: Relationship): ActionKey[] => actionsFor(r).map((a) => a.key);

describe('the action that fits the relationship', () => {
  it('offers Add to a stranger, and never Accept', () => {
    expect(keys(rel())).toEqual(['add', 'follow', 'block']);
  });

  it('offers Accept and Decline only to the side that was asked', () => {
    expect(keys(rel({ add: 'incoming' }))).toEqual(['accept', 'decline', 'follow', 'block']);
    // The side that ASKED gets neither — they cannot answer their own request (0284).
    expect(keys(rel({ add: 'outgoing' }))).toEqual(['cancel', 'follow', 'block']);
    expect(keys(rel({ add: 'outgoing' }))).not.toContain('accept');
  });

  it('offers Remove once both sides have agreed', () => {
    expect(keys(rel({ add: 'mutual' }))).toEqual(['remove', 'follow', 'block']);
  });

  it('follow and unfollow are one slot, never both', () => {
    expect(keys(rel({ followingThem: true }))).toContain('unfollow');
    expect(keys(rel({ followingThem: true }))).not.toContain('follow');
  });

  it('a block is the whole answer', () => {
    expect(keys(rel({ blocked: true, add: 'mutual', followingThem: true }))).toEqual(['unblock']);
  });
});

describe('removing and cancelling are the same call', () => {
  it('because there is one row for the pair and either side deletes it', () => {
    expect(rpcFor('remove')).toBe('remove_add');
    expect(rpcFor('cancel')).toBe('remove_add');
  });

  it('every action names an RPC that 0283/0284 actually defines', () => {
    const defined = [
      'request_add',
      'accept_add',
      'decline_add',
      'remove_add',
      'follow_profile',
      'unfollow_profile',
      'block_profile',
      'unblock_profile',
    ];
    const every: ActionKey[] = [
      'add',
      'accept',
      'decline',
      'remove',
      'cancel',
      'follow',
      'unfollow',
      'block',
      'unblock',
    ];
    for (const k of every) expect(defined).toContain(rpcFor(k));
  });
});

describe('reading my_connections()', () => {
  it('keeps add and follow apart, because they are two relationships', () => {
    const map = relationshipsFrom([
      row({ relation: 'add', status: 'accepted', direction: 'mutual' }),
      row({ relation: 'follow', direction: 'outgoing' }),
      row({ relation: 'follow', profile_id: 'other', direction: 'incoming' }),
    ]);
    expect(relationshipOf(map, 'them')).toMatchObject({ add: 'mutual', followingThem: true });
    expect(relationshipOf(map, 'other')).toMatchObject({ followsYou: true, followingThem: false });
  });

  it('carries the direction of a pending add, which says who owes the answer', () => {
    const map = relationshipsFrom([
      row({ status: 'pending', direction: 'incoming' }),
      row({ profile_id: 'other', status: 'pending', direction: 'outgoing' }),
    ]);
    expect(relationshipOf(map, 'them').add).toBe('incoming');
    expect(relationshipOf(map, 'other').add).toBe('outgoing');
  });

  it('lets a block overrule anything else in the same answer', () => {
    const map = relationshipsFrom([
      row({ relation: 'add', status: 'accepted', direction: 'mutual' }),
      row({ relation: 'follow', direction: 'outgoing' }),
      row({ relation: 'block', direction: 'outgoing' }),
    ]);
    expect(relationshipOf(map, 'them')).toEqual({
      add: 'none',
      followingThem: false,
      followsYou: false,
      blocked: true,
    });
  });

  it('answers for somebody with no row at all', () => {
    expect(relationshipOf(new Map(), 'nobody')).toEqual(NO_RELATIONSHIP);
    expect(relationshipOf(new Map(), null)).toEqual(NO_RELATIONSHIP);
  });
});

describe('what it says', () => {
  it('says which way a pending add points', () => {
    expect(relationshipSentence(rel({ add: 'outgoing' }))).toContain('You asked');
    expect(relationshipSentence(rel({ add: 'incoming' }))).toContain('They asked');
    expect(relationshipSentence(rel())).toBe('Not connected.');
  });

  it('never uses the retired words, and never the other word for add', () => {
    const retired = [
      'friend',
      'just me',
      'just josh',
      'just erica',
      'together',
      // `Both`, `All` and `Anyone` as standalone words — a substring check would flag
      // "all" inside "finally", which is not the thing that was retired.
      '\\bboth\\b',
      '\\ball\\b',
      '\\banyone\\b',
    ];
    const every: ActionKey[] = [
      'add',
      'accept',
      'decline',
      'remove',
      'cancel',
      'follow',
      'unfollow',
      'block',
      'unblock',
    ];
    const words: string[] = [
      ...every.flatMap((k) => [doneSaying(k), triedSaying(k)]),
      ...actionsFor(rel()).flatMap((a) => [a.label, a.hint]),
      ...actionsFor(rel({ add: 'incoming' })).flatMap((a) => [a.label, a.hint]),
      ...actionsFor(rel({ add: 'mutual', followingThem: true })).flatMap((a) => [a.label, a.hint]),
      ...actionsFor(rel({ blocked: true })).flatMap((a) => [a.label, a.hint]),
      relationshipSentence(rel()),
      relationshipSentence(rel({ add: 'mutual', followsYou: true })),
      relationshipSentence(rel({ add: 'incoming' })),
      relationshipSentence(rel({ add: 'outgoing' })),
      relationshipSentence(rel({ blocked: true })),
    ];
    for (const w of words) {
      for (const bad of retired) {
        expect(w.toLowerCase()).not.toMatch(new RegExp(bad));
      }
    }
  });
});
