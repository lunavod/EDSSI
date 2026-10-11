import { useEffect, useState } from 'react';

import { type HistorySnapshot, isNewerSnapshot } from '../../../shared/history';
import { useEdssi } from '../api/context';

/** The ledger and current system survey from the main process, kept up to date. */
export function useHistory(): HistorySnapshot | undefined {
  const edssi = useEdssi();
  const [snapshot, setSnapshot] = useState<HistorySnapshot>();

  useEffect(() => {
    let active = true;
    const offer = (next: HistorySnapshot) =>
      setSnapshot((current) => (isNewerSnapshot(current, next) ? next : current));
    // Subscribe first so nothing falls between the two; versions sort out the overlap.
    const unsubscribe = edssi.history.onChange(offer);
    edssi.history.getSnapshot().then(
      (next) => {
        if (active) offer(next);
      },
      (error: unknown) => console.error('[history] failed to load', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [edssi]);

  return snapshot;
}
