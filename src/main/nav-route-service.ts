import { ipcMain } from 'electron';

import { IpcChannel } from '../shared/api';
import { activeRoute, type PlottedRoute, type RouteEdsmCheck } from '../shared/nav-routes';
import { broadcast } from './broadcast';
import type { EdsmClient } from './edsm';
import type { JournalReader } from './journal';
import { checkRouteOnEdsm } from './route-edsm';
import type { NavRouteStore } from './store/nav-route-store';

/**
 * Records every route the player plots. The journal only notes that a route was plotted or
 * cleared; the systems are in NavRoute.json, which the game overwrites with each new route and
 * empties when the route is cleared, so it's recorded whenever it changes. A route abandoned by
 * targeting a system off it is dropped without a word, and left behind in NavRoute.json; the
 * target is the only sign of it.
 *
 * Each route being followed is also looked up on EDSM, to say how many of its systems nobody has
 * reported there.
 */
export interface NavRouteService {
  /** Routes that may apply to this session, oldest first. */
  recent(): PlottedRoute[];
  /** Call once `reader` has replayed the journals: routes from then on are plotted live. */
  markLive(): void;
}

export function startNavRouteService(
  reader: JournalReader,
  store: NavRouteStore,
  options: {
    edsm?: Pick<EdsmClient, 'knownSystems'>;
    /** A route plotted live has been looked up on EDSM. */
    onChecked?: (route: PlottedRoute) => void;
  } = {},
): NavRouteService {
  let sessionStart: string | undefined;
  let live = false;
  /** Only kept in memory: after a restart the route being followed is simply looked up again. */
  const checks = new Map<number, RouteEdsmCheck>();

  const withCheck = (route: PlottedRoute): PlottedRoute => {
    const edsm = checks.get(route.id);
    return edsm ? { ...route, edsm } : route;
  };
  const recent = (): PlottedRoute[] => store.routesSince(sessionStart).map(withCheck);

  /** Tells every window about a route the store learned something new about. */
  const announce = (route: PlottedRoute | undefined): void => {
    if (!route) return;
    broadcast(IpcChannel.NavRouteChanged, withCheck(route));
    if (live) check(route, true);
  };

  function check(route: PlottedRoute, speak: boolean): void {
    const { edsm } = options;
    const systems = route.systems;
    if (!edsm || !systems || route.clearedAt !== undefined || checks.has(route.id)) return;
    const update = (result: RouteEdsmCheck): PlottedRoute => {
      checks.set(route.id, result);
      const updated = { ...route, edsm: result };
      broadcast(IpcChannel.NavRouteChanged, updated);
      return updated;
    };
    update({ status: 'checking' });
    checkRouteOnEdsm(edsm, systems)
      .then((result) => {
        const updated = update(result);
        // A route replaced or cleared while EDSM was answering is no longer worth a word.
        if (speak && activeRoute(recent())?.id === route.id) options.onChecked?.(updated);
      })
      .catch((error: unknown) => {
        console.warn('[nav-route] EDSM lookup failed', error);
        update({ status: 'failed' });
      });
  }

  reader.onAny((event) => {
    // Part 1's header starts a new game session (as in journal-service.ts).
    if (sessionStart === undefined || (event.event === 'Fileheader' && event.part === 1)) {
      sessionStart = event.timestamp;
    }
  });
  reader.on('NavRoute', (event) => announce(store.recordRoute(event.timestamp, event.Route)));
  reader.on('NavRouteClear', (event) => announce(store.recordCleared(event.timestamp)));
  // While a route is plotted every target says how many jumps are left on it. One that doesn't
  // was picked off the route, and the game has dropped the route without a NavRouteClear.
  reader.on('FSDTarget', (event) => {
    if (event.RemainingJumpsInRoute !== undefined) return;
    announce(store.recordCleared(event.timestamp, { plottedBefore: true }));
  });
  reader.onCompanion('NavRoute', (event) =>
    announce(
      event.Route?.length
        ? store.recordRoute(event.timestamp, event.Route)
        : store.recordCleared(event.timestamp),
    ),
  );

  ipcMain.handle(IpcChannel.NavRoutesRecent, recent);
  return {
    recent,
    markLive() {
      live = true;
      // Plotted before EDSSI started: shown on the panel, but not news.
      const route = activeRoute(recent());
      if (route) check(route, false);
    },
  };
}
