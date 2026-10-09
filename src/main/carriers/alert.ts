/**
 * The nearby carrier alert, less the wiring: what to ask Spansh after a jump, what its answer
 * holds, and which carriers are worth a word. Spansh knows a carrier only from the last player
 * whose tools reported it to EDDN, so every carrier comes with how long ago that was.
 */

import type { CarrierAlertSettings } from '../../shared/settings';
import { type Coords, field } from '../spansh/client';

export const CARRIER_TYPE = 'Drake-Class Carrier';
/**
 * Enough for any real cluster of carriers, with room for the private ones that are dropped; the
 * alert names only the nearest.
 */
const CARRIER_RESULTS = 50;
const DAY_MS = 24 * 60 * 60_000;

export interface NearbyCarrier {
  marketId: string;
  /** The callsign, e.g. `T4B-BHB`. */
  callsign: string;
  /** The name its owner gave it, if Spansh has one. */
  name?: string;
  system: string;
  distanceLy: number;
  /** When Spansh last heard of it, as an ISO timestamp. */
  updatedAt?: string;
  /** `All`, `Friends`, `Squadron`, `Squadron Friends` or `None`, when known. */
  dockingAccess?: string;
  services: string[];
}

/** Carriers within `rangeLy` of `coords` that someone reported in the last `maxAgeDays`. */
export function carrierSearch(
  coords: Coords,
  rangeLy: number,
  maxAgeDays: number,
  now = Date.now(),
): Record<string, unknown> {
  return {
    filters: {
      type: { value: [CARRIER_TYPE] },
      distance: { min: '0', max: String(rangeLy) },
      updated_at: {
        value: [new Date(now - maxAgeDays * DAY_MS).toISOString(), new Date(now).toISOString()],
        comparison: '<=>',
      },
    },
    sort: [{ distance: { direction: 'asc' } }],
    size: CARRIER_RESULTS,
    page: 0,
    reference_coords: coords,
  };
}

/**
 * The one nearest station with repairs that isn't a carrier, if any is within `rangeLy`: a sign of
 * populated space, where a carrier is nothing to remark on. `types` is Spansh's list of station
 * types, so a type it adds later still counts.
 */
export function repairStationSearch(
  coords: Coords,
  rangeLy: number,
  types: readonly string[],
): Record<string, unknown> {
  return {
    filters: {
      type: { value: types.filter((type) => !/carrier/i.test(type)) },
      services: [{ name: 'Repair' }],
      distance: { min: '0', max: String(rangeLy) },
    },
    sort: [{ distance: { direction: 'asc' } }],
    size: 1,
    page: 0,
    reference_coords: coords,
  };
}

/** The carriers in a search result. Spansh's answer isn't checked, so anything odd is skipped. */
export function readCarriers(result: unknown): NearbyCarrier[] {
  const rows = field(result, 'results');
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown): NearbyCarrier[] => {
    const id = field(row, 'market_id');
    const marketId =
      typeof id === 'number' || typeof id === 'bigint' || typeof id === 'string'
        ? String(id)
        : undefined;
    const callsign = field(row, 'name');
    const system = field(row, 'system_name');
    const distance = Number(field(row, 'distance'));
    if (marketId === undefined || typeof callsign !== 'string' || typeof system !== 'string') {
      return [];
    }
    if (field(row, 'type') !== CARRIER_TYPE || !Number.isFinite(distance)) return [];
    const services = field(row, 'services');
    return [
      {
        marketId,
        callsign,
        name: optionalText(field(row, 'carrier_name')),
        system,
        distanceLy: distance,
        updatedAt: optionalText(field(row, 'updated_at')),
        dockingAccess: optionalText(field(row, 'carrier_docking_access')),
        services: Array.isArray(services)
          ? services.flatMap((service: unknown) => {
              const name = typeof service === 'string' ? service : field(service, 'name');
              return typeof name === 'string' ? [name] : [];
            })
          : [],
      },
    ];
  });
}

/** How many jumps of the given range cover the distance, at least one. */
export function jumpsFor(distanceLy: number, jumpRangeLy: number): number {
  return Math.max(1, Math.ceil(distanceLy / jumpRangeLy));
}

/** How far to look: the configured jumps of the ship's range. */
export function searchRange(settings: CarrierAlertSettings, jumpRangeLy: number): number {
  return Math.round(settings.jumps * jumpRangeLy);
}

/**
 * Remembers which carriers the commander has been told about, and where they were, so each is
 * named once. A carrier that has moved since is new again.
 */
export class CarrierAlerts {
  readonly #told = new Map<string, string>();

  /**
   * The carriers worth telling about, nearest first, marking them as told. Only those anyone may
   * dock at: one open to friends or a squadron is no use to a stranger. A carrier whose access
   * Spansh doesn't know is kept, as most out in the black are open.
   */
  select(carriers: readonly NearbyCarrier[]): NearbyCarrier[] {
    const fresh = carriers.filter(
      (carrier) =>
        (carrier.dockingAccess === undefined || carrier.dockingAccess.toLowerCase() === 'all') &&
        this.#told.get(carrier.marketId) !== carrier.system,
    );
    for (const carrier of fresh) this.#told.set(carrier.marketId, carrier.system);
    return fresh.toSorted((a, b) => a.distanceLy - b.distanceLy);
  }
}

/** Services a far-off commander cares about, as they are said aloud. */
const SPOKEN_SERVICES: [string, string][] = [
  ['Repair', 'repair'],
  ['Refuel', 'refuel'],
  ['Restock', 'rearm'],
  ['Shipyard', 'shipyard'],
  ['Outfitting', 'outfitting'],
  ['Universal Cartographics', 'cartographics'],
  ['Vista Genomics', 'Vista Genomics'],
];

/**
 * One line for the carriers: the nearest in full, the rest as a count. "Carrier DSSA Distant
 * Worlds in Beagle Point, 120 light years, 2 jumps: repair, refuel, rearm. Last reported
 * yesterday. 2 more carriers in range." The callsign (X2J-19Z) is only read out if asked for: a
 * string of letters says little, and an unnamed carrier is just "a carrier".
 */
export function alertLine(
  carriers: readonly NearbyCarrier[],
  jumpRangeLy: number,
  here: string | undefined,
  options: { sayCallsign?: boolean; now?: number } = {},
): string | undefined {
  const { sayCallsign = false, now = Date.now() } = options;
  const [nearest, ...rest] = carriers;
  if (!nearest) return undefined;
  const callsign = sayCallsign ? nearest.callsign : undefined;
  const label = [nearest.name, callsign].filter(Boolean).join(', ');
  const name = label ? `Carrier ${label}` : 'A carrier';
  const where =
    here !== undefined && nearest.system.toLowerCase() === here.toLowerCase()
      ? 'in this system'
      : `in ${nearest.system}, ${lightYears(nearest.distanceLy)}, ${plural(jumpsFor(nearest.distanceLy, jumpRangeLy), 'jump')}`;
  const offered = SPOKEN_SERVICES.filter(([service]) => nearest.services.includes(service)).map(
    ([, spoken]) => spoken,
  );
  const seen = nearest.updatedAt ? ` Last reported ${ago(nearest.updatedAt, now)}.` : '';
  const more = rest.length > 0 ? ` ${plural(rest.length, 'more carrier')} in range.` : '';
  return `${name} ${where}${offered.length > 0 ? `: ${offered.join(', ')}` : ''}.${seen}${more}`;
}

function lightYears(distance: number): string {
  return `${distance < 10 ? distance.toFixed(1) : Math.round(distance)} light years`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** "within the hour", "5 hours ago", "yesterday", "12 days ago". */
export function ago(timestamp: string, now = Date.now()): string {
  const hours = Math.floor((now - Date.parse(timestamp)) / (60 * 60_000));
  if (!Number.isFinite(hours) || hours < 1) return 'within the hour';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
