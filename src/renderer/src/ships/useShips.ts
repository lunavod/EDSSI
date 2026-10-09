import { useEffect, useState } from 'react';

import { isNewerShipsSnapshot, type ShipsSnapshot } from '../../../shared/ships';

/** Every ship the commander owns, slot by slot, from the main process, kept up to date. */
export function useShips(): ShipsSnapshot | undefined {
  const [snapshot, setSnapshot] = useState<ShipsSnapshot>();

  useEffect(() => {
    let active = true;
    const offer = (next: ShipsSnapshot) =>
      setSnapshot((current) => (isNewerShipsSnapshot(current, next) ? next : current));
    // Subscribe first so nothing falls between the two; versions sort out the overlap.
    const unsubscribe = window.edssi.ships.onChange(offer);
    window.edssi.ships.getSnapshot().then(
      (next) => {
        if (active) offer(next);
      },
      (error: unknown) => console.error('[ships] failed to load', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return snapshot;
}
