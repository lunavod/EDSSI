import type { RouteEdsmCheck, RouteSystem } from '../shared/nav-routes';
import type { EdsmClient } from './edsm';

/** Asks EDSM about every system on a route. Rejects if EDSM can't be reached. */
export async function checkRouteOnEdsm(
  edsm: Pick<EdsmClient, 'knownSystems'>,
  systems: readonly RouteSystem[],
  signal?: AbortSignal,
): Promise<RouteEdsmCheck> {
  const known = await edsm.knownSystems(
    systems.map((system) => system.StarSystem),
    signal,
  );
  return {
    status: 'checked',
    unknown: systems
      .map((system) => String(system.SystemAddress))
      .filter((address) => !known.has(address)),
  };
}

/**
 * What to say about a freshly plotted route: how many of the systems it jumps to EDSM has never
 * heard of. The start is left out, since the ship is already there.
 */
export function routeEdsmCallout(
  systems: readonly RouteSystem[],
  check: RouteEdsmCheck,
): string | undefined {
  if (check.status !== 'checked') return undefined;
  const jumps = systems.slice(1);
  if (jumps.length === 0) return undefined;
  const unknown = new Set(check.unknown);
  const missing = jumps.filter((system) => unknown.has(String(system.SystemAddress))).length;
  const destinationMissing = unknown.has(String(jumps.at(-1)!.SystemAddress));

  if (jumps.length === 1) {
    return destinationMissing
      ? `Route plotted, one jump. ${jumps[0]!.StarSystem} isn't in EDSM.`
      : `Route plotted, one jump. ${jumps[0]!.StarSystem} is in EDSM.`;
  }
  const plotted = `Route plotted, ${jumps.length} jumps.`;
  if (missing === 0) return `${plotted} Every system on it is in EDSM.`;
  if (missing === jumps.length) return `${plotted} EDSM knows none of them.`;
  const destination = destinationMissing ? ', the destination among them' : '';
  return missing === 1
    ? `${plotted} One of them isn't in EDSM${destination}.`
    : `${plotted} ${missing} of them aren't in EDSM${destination}.`;
}
