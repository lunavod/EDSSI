import type { JournalEvent } from '../../../shared/journal';
import {
  isScoopableClass,
  type PlottedRoute,
  type RouteProgress,
  type RouteSystem,
  routeLengthLy,
  routeProgress,
} from '../../../shared/nav-routes';
import { formatNumber } from './format';

/** The route an event is about: the one a NavRoute line announced, or the one a jump or target was on. */
export function routeContext(
  event: JournalEvent,
  routes: readonly PlottedRoute[],
): RouteProgress | undefined {
  switch (event.event) {
    case 'NavRoute': {
      const route = routes.find((candidate) => candidate.plottedAt === event.timestamp);
      return route && { route };
    }
    case 'FSDJump':
    case 'FSDTarget':
      return routeProgress(routes, event.timestamp, event.SystemAddress);
    default:
      return undefined;
  }
}

/** Route context for an event's one-line summary, e.g. "12 jumps to Colonia · 540 ly" or "jump 4 of 12". */
export function routeNote(
  event: JournalEvent,
  routes: readonly PlottedRoute[],
): string | undefined {
  if (event.event !== 'NavRoute' && event.event !== 'FSDJump') return undefined;
  const context = routeContext(event, routes);
  const systems = context?.route.systems;
  if (!context || !systems) return undefined;
  return event.event === 'NavRoute'
    ? describeRoute(systems)
    : describePosition(systems, context.position);
}

/** "12 jumps to Colonia · 540 ly" */
export function describeRoute(systems: readonly RouteSystem[]): string {
  const jumps = systems.length - 1;
  const destination = systems.at(-1)?.StarSystem ?? 'unknown system';
  const length = formatNumber(routeLengthLy(systems), 1);
  return `${jumps} ${jumps === 1 ? 'jump' : 'jumps'} to ${destination} · ${length} ly`;
}

/** Where a system sits on a route: "jump 4 of 12", or "off route". */
export function describePosition(
  systems: readonly RouteSystem[],
  position: number | undefined,
): string {
  if (position === undefined) return 'off route';
  if (position === 0) return 'start of route';
  return `jump ${position} of ${systems.length - 1}`;
}

/** What a star on a route is good for: fuel, or an FSD boost. */
export function starNote(starClass: string): string | undefined {
  if (isScoopableClass(starClass)) return 'scoopable';
  if (starClass === 'N') return 'neutron star';
  if (starClass.startsWith('D')) return 'white dwarf';
  return undefined;
}
