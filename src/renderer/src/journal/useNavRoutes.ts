import { useEffect, useState } from 'react';

import { type PlottedRoute, upsertRoute } from '../../../shared/nav-routes';
import { useEdssi } from '../api/context';

/** Routes that may apply to the session being shown, oldest first, kept up to date. */
export function useNavRoutes(): readonly PlottedRoute[] {
  const edssi = useEdssi();
  const [routes, setRoutes] = useState<readonly PlottedRoute[]>([]);

  useEffect(() => {
    let active = true;
    // Subscribe first so nothing falls between the two; merging makes the overlap harmless.
    const unsubscribe = edssi.navRoutes.onChange((route) => {
      setRoutes((current) => upsertRoute(current, route));
    });
    edssi.navRoutes.getRecent().then(
      (recent) => {
        if (active) setRoutes((current) => recent.reduce(upsertRoute, current));
      },
      (error: unknown) => console.error('[routes] failed to load', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [edssi]);

  return routes;
}
