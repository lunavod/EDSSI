import { useEffect, useState } from 'react';

import type { UpdateState } from '../../../shared/updates';
import { useEdssi } from '../api/context';

/** What the updater is doing, kept current. */
export function useUpdates(): UpdateState | undefined {
  const edssi = useEdssi();
  const [state, setState] = useState<UpdateState>();
  useEffect(() => {
    let live = false;
    const stop = edssi.updates.onChange((next) => {
      live = true;
      setState(next);
    });
    // A change that arrived first is newer than the answer.
    void edssi.updates.getState().then((first) => {
      if (!live) setState(first);
    });
    return stop;
  }, [edssi]);
  return state;
}
