import { useEffect, useState } from 'react';

import { type PlottedRoute, upsertRoute } from '../../../shared/nav-routes';

/** Routes that may apply to the session being shown, oldest first, kept up to date. */
export function useNavRoutes(): readonly PlottedRoute[] {
  const [routes, setRoutes] = useState<readonly PlottedRoute[]>([]);

  useEffect(() => {
    let active = true;
    // Subscribe first so nothing falls between the two; merging makes the overlap harmless.
    const unsubscribe = window.edssi.navRoutes.onChange((route) => {
      setRoutes((current) => upsertRoute(current, route));
    });
    window.edssi.navRoutes.getRecent().then(
      (recent) => {
        if (active) setRoutes((current) => recent.reduce(upsertRoute, current));
      },
      (error: unknown) => console.error('[routes] failed to load', error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return routes;
}
