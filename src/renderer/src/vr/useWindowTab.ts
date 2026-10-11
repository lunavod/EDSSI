import { useEffect, useState } from 'react';

import type { TabId } from '../../../shared/ui';
import { useEdssi } from '../api/context';

/** The tab the window on the desk is showing, kept up to date as it changes. */
export function useWindowTab(): TabId {
  const edssi = useEdssi();
  const [tab, setTab] = useState<TabId>('mission');

  useEffect(() => {
    let active = true;
    let changed = false;
    // Subscribe first; a change that lands before the answer is newer than it.
    const unsubscribe = edssi.ui.onTabChange((next) => {
      changed = true;
      setTab(next);
    });
    edssi.ui.getTab().then(
      (current) => {
        if (active && !changed) setTab(current);
      },
      (error: unknown) => console.error('[vr] failed to read the window tab', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [edssi]);

  return tab;
}
