import { useEffect, useState } from 'react';

import type { SystemExternalInfo } from '../../../shared/edsm';
import { useEdssi } from '../api/context';

/** What EDSM knows about a system; undefined until it answers (the main process caches it). */
export function useSystemInfo(name: string | undefined): SystemExternalInfo | undefined {
  const edssi = useEdssi();
  const [answer, setAnswer] = useState<{ name: string; info: SystemExternalInfo }>();

  useEffect(() => {
    let active = true;
    if (name) {
      edssi.edsm.getSystem(name).then(
        (info) => {
          if (active) setAnswer({ name, info });
        },
        (error: unknown) => console.error('[edsm] lookup failed', error),
      );
    }
    return () => {
      active = false;
    };
  }, [edssi, name]);

  // An answer about the previous system is no answer about this one.
  return answer !== undefined && answer.name === name ? answer.info : undefined;
}
