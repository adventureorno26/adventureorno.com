// The buttons beside one person — whichever ones fit where you stand with them.
//
// WHAT IT WILL NOT DO: render every action and grey four of them out. `actionsFor()`
// (lib/connections) returns the set that can actually happen, so `Accept` never appears
// beside somebody who never asked and `Follow` never appears beside a block the RPCs would
// refuse anyway.
//
// EVERY FAILURE IS SAID OUT LOUD, through lib/whyItFailed. Nothing here tests
// `e instanceof Error` — that is FALSE for the PostgrestError supabase-js throws, which is
// how the repair queue came to move nothing and say nothing. The reason the database gives
// ("no such account", "that was already answered") is the reason the person is shown.
//
// AND THE STATE COMES BACK FROM THE DATABASE, not from an assumption. After a successful
// action the parent reloads `my_connections()`; this component never writes the new
// relationship locally, because "asked" and "accepted" are the same button press on a
// pending row the other side already sent (0284's request_add), and guessing which one
// happened is how a screen starts lying.
import { useState } from 'react';
import {
  actionsFor,
  doneSaying,
  triedSaying,
  type ActionKey,
  type Relationship,
} from '../lib/connections';
import { runConnectionAction } from '../lib/connectionsApi';
import { showSnack } from '../lib/snackbar';
import { whyItFailed } from '../lib/whyItFailed';

export default function ConnectionActions({
  profileId,
  rel,
  onChanged,
  size = 'row',
}: {
  profileId: string;
  rel: Relationship;
  /** Reload the connections; the answer is the database's, not this component's. */
  onChanged: () => void;
  /** `row` in a list, `page` on somebody's profile where the buttons are the main event. */
  size?: 'row' | 'page';
}) {
  const [busy, setBusy] = useState<ActionKey | null>(null);

  const run = async (key: ActionKey) => {
    if (busy) return;
    setBusy(key);
    try {
      await runConnectionAction(key, profileId);
      showSnack({ message: doneSaying(key) });
      onChanged();
    } catch (e) {
      showSnack({ message: whyItFailed(triedSaying(key), e, { online: navigator.onLine }) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`connection-actions${size === 'page' ? ' connection-actions-page' : ''}`}>
      {actionsFor(rel).map((a) => (
        <button
          key={a.key}
          type="button"
          className={a.tone === 'primary' ? 'primary' : a.key === 'block' ? 'danger' : ''}
          title={a.hint}
          aria-label={`${a.label} — ${a.hint}`}
          disabled={busy !== null}
          onClick={() => void run(a.key)}
        >
          {busy === a.key ? '…' : a.label}
        </button>
      ))}
    </div>
  );
}
