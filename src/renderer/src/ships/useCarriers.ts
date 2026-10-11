import { useEffect, useState } from 'react';

import { type CarriersSnapshot, isNewerCarriersSnapshot } from '../../../shared/carriers';
import { useEdssi } from '../api/context';

/** The commander's carriers, from the main process, kept up to date. */
export function useCarriers(): CarriersSnapshot | undefined {
  const edssi = useEdssi();
  const [snapshot, setSnapshot] = useState<CarriersSnapshot>();

  useEffect(() => {
    let active = true;
    const offer = (next: CarriersSnapshot) =>
      setSnapshot((current) => (isNewerCarriersSnapshot(current, next) ? next : current));
    // Subscribe first so nothing falls between the two; versions sort out the overlap.
    const unsubscribe = edssi.carriers.onChange(offer);
    edssi.carriers.getSnapshot().then(
      (next) => {
        if (active) offer(next);
      },
      (error: unknown) => console.error('[carriers] failed to load', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [edssi]);

  return snapshot;
}
