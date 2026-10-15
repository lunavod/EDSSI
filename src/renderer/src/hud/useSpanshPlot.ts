import { useEffect, useState } from 'react';

import type { SpanshPlotState } from '../../../shared/spansh-plot';
import { useEdssi } from '../api/context';

/** The Spansh page's plot under way and the last route it plotted. */
export function useSpanshPlot(): SpanshPlotState | undefined {
  const edssi = useEdssi();
  const [state, setState] = useState<SpanshPlotState>();

  useEffect(() => {
    let active = true;
    let changed = false;
    // Subscribe first; a change that lands before the answer is newer than it.
    const unsubscribe = edssi.spanshPlot.onChange((next) => {
      changed = true;
      setState(next);
    });
    edssi.spanshPlot.get().then(
      (current) => {
        if (active && !changed) setState(current);
      },
      (error: unknown) => console.error('[spansh-plot] failed to load', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [edssi]);

  return state;
}
