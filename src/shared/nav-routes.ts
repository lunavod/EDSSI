import type { NavRouteEvent } from './journal';

/** One system on a plotted route, exactly as NavRoute.json lists it. */
export type RouteSystem = NonNullable<NavRouteEvent['Route']>[number];

/**
 * A route the player plotted. The game only keeps the current one (in NavRoute.json), so EDSSI
 * records each one as it appears.
 */
export interface PlottedRoute {
  id: number;
  /** The game's timestamp for the plot; the journal's NavRoute line and NavRoute.json share it. */
  plottedAt: string;
  /** When the game dropped it: during the final jump on arrival, or when the player cleared it. */
  clearedAt?: string;
  /**
   * Start first, destination last. Missing when the route was replaced or cleared before EDSSI
   * could read NavRoute.json, e.g. because it wasn't running.
   */
  systems?: RouteSystem[];
  /** Which of its systems EDSM knows, looked up once the route is plotted. Not kept on disk. */
  edsm?: RouteEdsmCheck;
}

/** What EDSM said about a route's systems. */
export type RouteEdsmCheck =
  | { status: 'checking' | 'failed' }
  | {
      status: 'checked';
      /** Addresses (as digits, see `sameAddress`) of the systems EDSM has never heard of. */
      unknown: string[];
    };

/** Where a system sits on the route in effect at some moment. */
export interface RouteProgress {
  route: PlottedRoute;
  /** Index into `route.systems` (0 = start); missing if the system isn't on the route or the route's systems are unknown. */
  position?: number;
}

/**
 * The game clears a route during its final jump, about 12 s before the FSDJump that arrives at
 * the destination, so a jump into the destination this soon after the clear still belongs to it.
 */
const ARRIVAL_GRACE_MS = 60_000;

/**
 * The route being followed when the ship jumped to (or targeted) a system: the latest one plotted
 * by then, unless it had been cleared. `routes` must be oldest first.
 */
export function routeProgress(
  routes: readonly PlottedRoute[],
  timestamp: string,
  systemAddress: number | bigint,
): RouteProgress | undefined {
  const route = routes.findLast((candidate) => candidate.plottedAt <= timestamp);
  if (!route) return undefined;
  const index =
    route.systems?.findIndex((system) => sameAddress(system.SystemAddress, systemAddress)) ?? -1;
  const position = index >= 0 ? index : undefined;

  if (route.clearedAt !== undefined && route.clearedAt < timestamp) {
    const arriving =
      Date.parse(timestamp) - Date.parse(route.clearedAt) <= ARRIVAL_GRACE_MS &&
      (route.systems === undefined || position === route.systems.length - 1);
    if (!arriving) return undefined;
  }
  return { route, position };
}

/** Straight-line distance between two systems, in light years. */
export function distanceLy(a: RouteSystem, b: RouteSystem): number {
  const [ax, ay, az] = a.StarPos;
  const [bx, by, bz] = b.StarPos;
  return Math.hypot(ax - bx, ay - by, az - bz);
}

/** Length of a route's legs from position `from` to position `to`, in light years. */
export function routeLengthLy(
  systems: readonly RouteSystem[],
  from = 0,
  to = systems.length - 1,
): number {
  let total = 0;
  for (let index = from + 1; index <= to; index++) {
    total += distanceLy(systems[index - 1]!, systems[index]!);
  }
  return total;
}

/**
 * Adds or updates a route in an oldest-first list. What EDSSI learns about a route only grows (its
 * systems, then a clear), so merging keeps an older copy of a route from undoing a newer one.
 */
export function upsertRoute(routes: readonly PlottedRoute[], route: PlottedRoute): PlottedRoute[] {
  const existing = routes.find((candidate) => candidate.id === route.id);
  const merged: PlottedRoute = existing
    ? {
        ...route,
        clearedAt: route.clearedAt ?? existing.clearedAt,
        systems: route.systems ?? existing.systems,
        edsm: newerCheck(existing.edsm, route.edsm),
      }
    : route;
  return [...routes.filter((candidate) => candidate.id !== route.id), merged].toSorted((a, b) =>
    a.plottedAt < b.plottedAt ? -1 : a.plottedAt > b.plottedAt ? 1 : 0,
  );
}

/** A finished check outlasts a copy of the route from before it finished. */
function newerCheck(
  existing: RouteEdsmCheck | undefined,
  incoming: RouteEdsmCheck | undefined,
): RouteEdsmCheck | undefined {
  if (!incoming) return existing;
  if (incoming.status === 'checking' && existing && existing.status !== 'checking') return existing;
  return incoming;
}

/**
 * How many of `systems` EDSM doesn't know, or undefined until it has been asked (or couldn't be).
 * Pass the systems still ahead to count only those.
 */
export function unknownToEdsm(
  check: RouteEdsmCheck | undefined,
  systems: readonly RouteSystem[],
): number | undefined {
  if (check?.status !== 'checked') return undefined;
  const unknown = new Set(check.unknown);
  return systems.filter((system) => unknown.has(String(system.SystemAddress))).length;
}

/** Stars of classes O, B, A, F, G, K and M (giants included): the ones a fuel scoop works on. */
export function isScoopableClass(starClass: string): boolean {
  return /^[OBAFGKM](_|$)/.test(starClass);
}

/** The route being followed now: the latest one, unless the game has cleared it. Oldest first. */
export function activeRoute(routes: readonly PlottedRoute[]): PlottedRoute | undefined {
  const latest = routes.at(-1);
  return latest && latest.clearedAt === undefined ? latest : undefined;
}

/** Where a system sits on a route (0 = start), if it's on it. */
export function positionOf(
  route: PlottedRoute,
  systemAddress: number | bigint | undefined,
): number | undefined {
  if (systemAddress === undefined || !route.systems) return undefined;
  const index = route.systems.findIndex((system) =>
    sameAddress(system.SystemAddress, systemAddress),
  );
  return index >= 0 ? index : undefined;
}

export interface NextJump {
  system: RouteSystem;
  /** Which jump of the route it is, from 1. */
  jump: number;
  jumps: number;
}

/** The system to jump to next from `systemAddress`, unless that's off the route or its end. */
export function nextJump(
  route: PlottedRoute | undefined,
  systemAddress: number | bigint | undefined,
): NextJump | undefined {
  const systems = route?.systems;
  const position = route && positionOf(route, systemAddress);
  if (!systems || position === undefined) return undefined;
  const system = systems[position + 1];
  return system && { system, jump: position + 1, jumps: systems.length - 1 };
}

/** Addresses may be numbers or bigints (see parse.ts); compare their digits. */
function sameAddress(a: number | bigint, b: number | bigint): boolean {
  return String(a) === String(b);
}
