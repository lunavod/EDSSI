import { useEffect, useState } from 'react';

import type { UpdateState } from '../../../shared/updates';

/** What the updater is doing, kept current. */
export function useUpdates(): UpdateState | undefined {
  const [state, setState] = useState<UpdateState>();
  useEffect(() => {
    let live = false;
    const stop = window.edssi.updates.onChange((next) => {
      live = true;
      setState(next);
    });
    // A change that arrived first is newer than the answer.
    void window.edssi.updates.getState().then((first) => {
      if (!live) setState(first);
    });
    return stop;
  }, []);
  return state;
}
