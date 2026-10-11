import { useEffect, useState } from 'react';

import { type ActivityTallies, isNewerTallies } from '../../../shared/activity';
import { useEdssi } from '../api/context';

/** This session's and this trip's tallies from the main process, kept up to date. */
export function useActivity(): ActivityTallies | undefined {
  const edssi = useEdssi();
  const [tallies, setTallies] = useState<ActivityTallies>();

  useEffect(() => {
    let active = true;
    const offer = (next: ActivityTallies) =>
      setTallies((current) => (isNewerTallies(current, next) ? next : current));
    // Subscribe first so nothing falls between the two; versions sort out the overlap.
    const unsubscribe = edssi.activity.onChange(offer);
    edssi.activity.getTallies().then(
      (next) => {
        if (active) offer(next);
      },
      (error: unknown) => console.error('[activity] failed to load', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [edssi]);

  return tallies;
}
