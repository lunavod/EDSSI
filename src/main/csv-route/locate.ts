import type { Coords, CsvRouteSystem, Located } from '../../shared/csv-route';

/**
 * Where the named systems are and what their stars are, keyed by name in lower case. Undefined
 * when it isn't set up to answer; rejects when it failed to.
 */
export type SystemLocator = (names: readonly string[]) => Promise<Map<string, Located> | undefined>;

/**
 * Where a CSV route's systems are and what their stars are, keyed by name in lower case. Each
 * locator is asked in turn about every system, and the first to answer is taken whole; EDSM, which
 * knows only where players have been and says nothing of stars here, only when none does.
 */
export async function locateSystems(
  systems: readonly CsvRouteSystem[],
  sources: {
    locators: readonly SystemLocator[];
    edsm: (names: readonly string[]) => Promise<Map<string, Coords>>;
  },
): Promise<Map<string, Located>> {
  for (const locator of sources.locators) {
    try {
      const found = await locator(systems.map((system) => system.name));
      if (found) return found;
    } catch (error) {
      console.error('[csv-route] could not look the route up; asking the next source', error);
    }
  }
  const found = new Map<string, Located>();
  const unplaced = systems.filter((system) => !system.coords).map((system) => system.name);
  if (unplaced.length === 0) return found;
  for (const [name, coords] of await sources.edsm(unplaced)) found.set(name, { coords });
  return found;
}
