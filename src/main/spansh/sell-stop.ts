/**
 * "Find the next sell stop": the nearest station or open carrier with Vista Genomics that doesn't
 * undo the commander's progress. While a route is being flown, a stop only counts if it is nearer
 * the route's destination than the commander is now. Spansh measures from one point only, so its
 * results come nearest the commander first and the ones behind are dropped here.
 */

import type { CsvRouteState } from '../../shared/csv-route';
import { plottedAlongCsv } from '../../shared/followed-route';
import { activeRoute, type PlottedRoute } from '../../shared/nav-routes';
import { CARRIER_TYPE } from '../carriers/alert';
import { type Coords, field } from './client';
import { asArray, largestPad, text } from './compact';
import type { Filter } from './filters';

export const SELL_SERVICE = 'Vista Genomics';
/** A carrier nobody has reported for longer than this may well have gone. */
export const CARRIER_MAX_AGE_DAYS = 60;
/** Stops in the commander's own system are never "behind", whatever the rounding. */
const HERE_LY = 1;
const DAY_MS = 24 * 60 * 60_000;

export type PadSize = 'small' | 'medium' | 'large';

/**
 * The large ships, by the journal's `Ship` name; they need a large pad. Anything not named as small
 * is taken for medium, so a ship added later can't be sent to an outpost it doesn't fit.
 */
const LARGE_SHIPS = new Set([
  'anaconda',
  'belugaliner',
  'cutter',
  'empire_trader',
  'explorer_nx',
  'federation_corvette',
  'orca',
  'panthermkii',
  'type7',
  'type9',
  'type9_military',
]);
const SMALL_SHIPS = new Set([
  'adder',
  'cobramkiii',
  'cobramkiv',
  'cobramkv',
  'diamondback',
  'diamondbackxl',
  'dolphin',
  'eagle',
  'empire_courier',
  'empire_eagle',
  'hauler',
  'sidewinder',
  'viper',
  'viper_mkiv',
  'vulture',
]);

/** The pad a ship needs, from the journal's `Ship` name. */
export function padFor(ship: string | undefined): PadSize | undefined {
  if (ship === undefined) return undefined;
  const name = ship.toLowerCase();
  if (LARGE_SHIPS.has(name)) return 'large';
  return SMALL_SHIPS.has(name) ? 'small' : 'medium';
}

/** Where the route being flown ends. */
export interface RouteDestination {
  source: 'plotted' | 'csv';
  /** The destination first, then the systems before it, for when Spansh doesn't know the last. */
  names: string[];
  /** A plotted route carries its systems' coordinates. */
  coords?: Coords;
}

/**
 * The end of the route being flown: the CSV route's when the game's plot is a stretch of it (the
 * plot only reaches its next waypoint), else the plotted route's, else a loaded CSV route's. The
 * CSV route counts even while the commander is off it, since it still says where they're going.
 */
export function routeDestination(
  routes: readonly PlottedRoute[],
  csv: CsvRouteState | undefined,
): RouteDestination | undefined {
  const plotted = activeRoute(routes);
  const csvSystems = csv?.route?.systems;
  const alongCsv = plotted && plottedAlongCsv(plotted, csv) !== undefined;
  if (plotted?.systems?.length && !alongCsv) {
    const last = plotted.systems.at(-1)!;
    const [x, y, z] = last.StarPos;
    return { source: 'plotted', names: [last.StarSystem], coords: { x, y, z } };
  }
  if (!csvSystems?.length) return undefined;
  // Nothing before where the commander has got to is worth measuring against.
  const from = csv?.position === undefined ? 0 : csv.position + 1;
  return {
    source: 'csv',
    names: csvSystems
      .slice(from)
      .map((system) => system.name)
      .toReversed(),
  };
}

export interface SellStopOptions {
  /** Services wanted besides Vista Genomics, as Spansh spells them. */
  services: readonly string[];
  pad?: PadSize;
  carrierMaxAgeDays: number;
  now: number;
}

/**
 * The filters for one of the two searches: carriers (open to all, reported lately) or everything
 * else. They are searched apart so stale and private carriers don't crowd out the pages.
 */
export function sellStopFilters(
  group: 'carriers' | 'stations',
  stationTypes: readonly string[],
  options: SellStopOptions,
): Filter[] {
  const filters: Filter[] = [SELL_SERVICE, ...options.services].map((service) => ({
    field: 'services',
    parts: [{ field: 'name', values: [service] }],
  }));
  if (group === 'carriers') {
    filters.push(
      { field: 'type', values: [CARRIER_TYPE] },
      { field: 'carrier_docking_access', values: ['All'] },
      {
        field: 'updated_at',
        min: new Date(options.now - options.carrierMaxAgeDays * DAY_MS).toISOString(),
        max: new Date(options.now).toISOString(),
      },
    );
  } else {
    filters.push({ field: 'type', values: stationTypes.filter((type) => type !== CARRIER_TYPE) });
    if (options.pad === 'large') filters.push({ field: 'has_large_pad', is: true });
  }
  return filters;
}

/** One stop worth telling about, before it is cut down for the model. */
export interface SellStop {
  row: unknown;
  distanceLy: number;
  /** From its system to the route's destination; undefined without a route. */
  toDestinationLy?: number;
}

/**
 * The usable stops in a page of Spansh results, and how many were dropped for lying behind. With
 * `destination`, a stop must be nearer it than `here` is. A medium ship's pad is checked here, as
 * Spansh can only ask for a large one.
 */
export function readSellStops(
  result: unknown,
  here: Coords,
  destination: Coords | undefined,
  pad: PadSize | undefined,
): { stops: SellStop[]; behind: number } {
  const left = destination && lightYears(here, destination);
  const stops: SellStop[] = [];
  let behind = 0;
  for (const row of asArray(field(result, 'results'))) {
    const at = systemCoords(row);
    const distance = Number(field(row, 'distance'));
    if (!at || !Number.isFinite(distance) || !fits(row, pad)) continue;
    if (field(row, 'type') === CARRIER_TYPE && field(row, 'carrier_docking_access') !== 'All') {
      continue;
    }
    const toDestination = destination && lightYears(at, destination);
    if (
      toDestination !== undefined &&
      left !== undefined &&
      toDestination >= left &&
      lightYears(at, here) > HERE_LY
    ) {
      behind++;
      continue;
    }
    stops.push({ row, distanceLy: distance, toDestinationLy: toDestination });
  }
  return { stops, behind };
}

function fits(row: unknown, pad: PadSize | undefined): boolean {
  const largest = largestPad(row);
  if (largest === undefined || pad === undefined || pad === 'small') return true;
  return pad === 'large' ? largest === 'L' : largest !== 'S';
}

function systemCoords(row: unknown): Coords | undefined {
  const [x, y, z] = ['system_x', 'system_y', 'system_z'].map((key) => field(row, key));
  return typeof x === 'number' && typeof y === 'number' && typeof z === 'number'
    ? { x, y, z }
    : undefined;
}

/** The services a seller cares about, from a result row, as Spansh names them. */
export function notableServices(row: unknown): string[] {
  const names = new Set(
    asArray(field(row, 'services')).map((service) => text(field(service, 'name'))),
  );
  return [
    'Universal Cartographics',
    'Refuel',
    'Repair',
    'Restock',
    'Outfitting',
    'Shipyard',
    'Interstellar Factors Contact',
  ].filter((name) => names.has(name));
}

export function lightYears(a: Coords, b: Coords): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
