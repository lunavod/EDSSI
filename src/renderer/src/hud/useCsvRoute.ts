import { useEffect, useState } from 'react';

import type { CsvRouteState } from '../../../shared/csv-route';
import { useEdssi } from '../api/context';

/** The route loaded from a CSV file and where the commander is on it, kept up to date. */
export function useCsvRoute(): CsvRouteState | undefined {
  const edssi = useEdssi();
  const [state, setState] = useState<CsvRouteState>();

  useEffect(() => {
    let active = true;
    let changed = false;
    // Subscribe first; a change that lands before the answer is newer than it.
    const unsubscribe = edssi.csvRoute.onChange((next) => {
      changed = true;
      setState(next);
    });
    edssi.csvRoute.get().then(
      (current) => {
        if (active && !changed) setState(current);
      },
      (error: unknown) => console.error('[csv-route] failed to load', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [edssi]);

  return state;
}
