// Where you stand with one person, and the action that fits it — the RULES, with no
// database in them.
//
// docs/STATE.md §CONNECTING TO SOMEONE:
//
//   | Add    | MUTUAL  — both sides agree | they see what you share with the people you added |
//   | Follow | ONE-WAY — no approval      | they see only what you made public                |
//
// The verb is **add**. Nothing in this file, in connectionsApi.ts, or in the two screens
// that use them says the other word — and connections.test.ts fails the build if it ever
// appears in a label, a hint or a sentence produced here.
//
// SPLIT FROM `connectionsApi.ts` ON PURPOSE, the same way `participants.ts` is split from
// `memoryPeople.ts`: `lib/supabase.ts` throws at import time without the client env, so a
// module that imports it cannot be unit-tested at all. These rules are the part worth
// testing — which button a row offers is exactly the thing a screen gets wrong — so they
// live where a test can reach them.

/** One row of `my_connections()`. */
export interface ConnectionRow {
  profile_id: string;
  display_name: string | null;
  relation: string;
  status: string;
  direction: string;
  since: string | null;
}

/**
 * Where you stand with one person.
 *
 * `add` and `follow` are deliberately separate fields rather than one state: they are two
 * different relationships that may both be true, which is why the database gives them two
 * tables (0284). Collapsing them here would rebuild in the client exactly the shape that
 * migration refused.
 */
export type AddState = 'none' | 'incoming' | 'outgoing' | 'mutual';

export interface Relationship {
  add: AddState;
  /** You follow them. One-way, no approval. */
  followingThem: boolean;
  /** They follow you. Shown, never acted on — their follow is not yours to undo. */
  followsYou: boolean;
  /** You blocked them. A block by THEM is invisible by design and cannot appear here. */
  blocked: boolean;
}

export const NO_RELATIONSHIP: Relationship = {
  add: 'none',
  followingThem: false,
  followsYou: false,
  blocked: false,
};

export type ActionKey =
  | 'add'
  | 'accept'
  | 'decline'
  | 'remove'
  | 'cancel'
  | 'follow'
  | 'unfollow'
  | 'block'
  | 'unblock';

export interface ConnectionAction {
  key: ActionKey;
  label: string;
  /** One line saying what pressing it does, for `title` and for screen readers. */
  hint: string;
  /** `primary` is the one thing this row is mainly for; `quiet` is everything else. */
  tone: 'primary' | 'quiet';
}

const ACTION: Record<ActionKey, Omit<ConnectionAction, 'tone'>> = {
  add: { key: 'add', label: 'Add', hint: 'Ask them — an add is mutual, so they decide too' },
  accept: { key: 'accept', label: 'Accept', hint: 'They asked to add you. Say yes' },
  decline: { key: 'decline', label: 'Decline', hint: 'They asked to add you. Say no' },
  remove: { key: 'remove', label: 'Remove', hint: 'Undo the add. Either side can, at any time' },
  cancel: { key: 'cancel', label: 'Cancel', hint: 'Take back the request you sent' },
  follow: { key: 'follow', label: 'Follow', hint: 'One-way. You see only what they made public' },
  unfollow: { key: 'unfollow', label: 'Unfollow', hint: 'Stop following. They are not told' },
  block: {
    key: 'block',
    label: 'Block',
    hint: 'Neither of you can reach the other. It also removes the add and any follows',
  },
  unblock: {
    key: 'unblock',
    label: 'Unblock',
    hint: 'Lift the block. Nothing it removed comes back — ask again if you want to',
  },
};

const withTone = (key: ActionKey, tone: 'primary' | 'quiet'): ConnectionAction => ({
  ...ACTION[key],
  tone,
});

/**
 * The actions that FIT where you stand — not every action, greyed out.
 *
 * A row offering `Accept` to somebody who never asked is a row that has to be read twice,
 * so the shape of the answer follows the relationship. Pure, so the rule is unit-testable
 * without a database.
 */
export function actionsFor(rel: Relationship): ConnectionAction[] {
  // A block is the whole answer. Nothing else can be true across one — the RPCs refuse,
  // and offering Follow beside Unblock would be offering something that cannot happen.
  if (rel.blocked) return [withTone('unblock', 'primary')];

  const out: ConnectionAction[] = [];
  if (rel.add === 'incoming') {
    out.push(withTone('accept', 'primary'), withTone('decline', 'quiet'));
  } else if (rel.add === 'outgoing') {
    out.push(withTone('cancel', 'quiet'));
  } else if (rel.add === 'mutual') {
    out.push(withTone('remove', 'quiet'));
  } else {
    out.push(withTone('add', 'primary'));
  }

  out.push(withTone(rel.followingThem ? 'unfollow' : 'follow', 'quiet'));
  out.push(withTone('block', 'quiet'));
  return out;
}

/** What the row says about the relationship itself, above the buttons. */
export function relationshipSentence(rel: Relationship): string {
  if (rel.blocked) return 'Blocked. Neither of you can reach the other.';
  const parts: string[] = [];
  if (rel.add === 'mutual') parts.push('Added — mutual, and either side can undo it');
  else if (rel.add === 'outgoing') parts.push('You asked to add them; waiting on their answer');
  else if (rel.add === 'incoming') parts.push('They asked to add you');
  if (rel.followingThem) parts.push('you follow them');
  if (rel.followsYou) parts.push('they follow you');
  if (parts.length === 0) return 'Not connected.';
  const [head, ...rest] = parts;
  return `${[head, ...rest].join(' · ')}.`;
}

/**
 * Every relationship this account has, keyed by the other person's id.
 *
 * One pass over `my_connections()`, which already returns adds, follows and blocks in one
 * shape — so a screen makes ONE round trip rather than three and cannot show a half-loaded
 * mixture of them.
 */
export function relationshipsFrom(rows: ConnectionRow[]): Map<string, Relationship> {
  const map = new Map<string, Relationship>();
  const at = (id: string): Relationship => {
    const found = map.get(id);
    if (found) return found;
    const fresh = { ...NO_RELATIONSHIP };
    map.set(id, fresh);
    return fresh;
  };

  for (const r of rows) {
    if (!r?.profile_id) continue;
    const rel = at(r.profile_id);
    if (r.relation === 'block') {
      rel.blocked = true;
    } else if (r.relation === 'follow') {
      if (r.direction === 'outgoing') rel.followingThem = true;
      else rel.followsYou = true;
    } else if (r.relation === 'add') {
      // `mutual` only ever means accepted; pending carries the direction that says who is
      // owed an answer.
      if (r.status === 'accepted') rel.add = 'mutual';
      else if (r.direction === 'incoming') rel.add = 'incoming';
      else if (r.direction === 'outgoing') rel.add = 'outgoing';
    }
  }

  // A block removed the add and both follows in the database (0284's trigger), so a row
  // saying otherwise would be stale. Say the block and nothing else.
  for (const rel of map.values()) {
    if (rel.blocked) {
      rel.add = 'none';
      rel.followingThem = false;
      rel.followsYou = false;
    }
  }
  return map;
}

export function relationshipOf(
  map: Map<string, Relationship>,
  profileId: string | null | undefined,
): Relationship {
  return (profileId && map.get(profileId)) || NO_RELATIONSHIP;
}

type ActionRpc =
  | 'request_add'
  | 'accept_add'
  | 'decline_add'
  | 'remove_add'
  | 'follow_profile'
  | 'unfollow_profile'
  | 'block_profile'
  | 'unblock_profile';

const RPC_FOR: Record<ActionKey, ActionRpc> = {
  add: 'request_add',
  accept: 'accept_add',
  decline: 'decline_add',
  // Removing an accepted add and cancelling one you sent are the SAME call — there is one
  // row for the pair and either side deletes it (0284).
  remove: 'remove_add',
  cancel: 'remove_add',
  follow: 'follow_profile',
  unfollow: 'unfollow_profile',
  block: 'block_profile',
  unblock: 'unblock_profile',
};

export function rpcFor(key: ActionKey): ActionRpc {
  return RPC_FOR[key];
}

/** What to say once it worked. Present tense, and never more than it did. */
const DONE: Record<ActionKey, string> = {
  add: 'Asked. They decide too — an add is mutual.',
  accept: 'Added.',
  decline: 'Declined.',
  remove: 'Removed.',
  cancel: 'Request taken back.',
  follow: 'Following. You see only what they make public.',
  unfollow: 'Not following any more.',
  block: 'Blocked. The add and any follows were removed too.',
  unblock: 'Unblocked. Nothing it removed came back.',
};

export function doneSaying(key: ActionKey): string {
  return DONE[key];
}

/** What was being attempted, for whyItFailed()'s first argument — no full stop. */
const TRIED: Record<ActionKey, string> = {
  add: 'Couldn’t ask to add them',
  accept: 'Couldn’t accept that',
  decline: 'Couldn’t decline that',
  remove: 'Couldn’t remove that',
  cancel: 'Couldn’t take that request back',
  follow: 'Couldn’t follow them',
  unfollow: 'Couldn’t unfollow them',
  block: 'Couldn’t block them',
  unblock: 'Couldn’t unblock them',
};

export function triedSaying(key: ActionKey): string {
  return TRIED[key];
}
