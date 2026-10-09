import type { Coords } from '../shared/csv-route';
import type { Counts, SystemExternalInfo } from '../shared/edsm';
import { parseJournalJson } from './journal/parse';

export const EDSM_BASE_URL = 'https://www.edsm.net';
export const USER_AGENT = 'EDSSI (https://github.com/lunavod/EDSSI)';
/** Traffic changes through the day, but not from one jump to the next. */
const FRESH_MS = 15 * 60_000;
const RETRY_MS = 60_000;
/** Names per request when asking about many systems; keeps the URL a sensible length. */
const SYSTEMS_PER_REQUEST = 50;

interface CacheEntry {
  at: number;
  failed: boolean;
  info: Promise<SystemExternalInfo>;
}

export interface EdsmClientOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

/** Reads system traffic, ship losses, stations and primary star from EDSM's public API. */
export class EdsmClient {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #cache = new Map<string, CacheEntry>();

  constructor(options: EdsmClientOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  /** Cached for a while, shared by concurrent callers, and never rejects. */
  system(name: string): Promise<SystemExternalInfo> {
    const key = name.toLowerCase();
    const cached = this.#cache.get(key);
    if (cached && this.#now() - cached.at < (cached.failed ? RETRY_MS : FRESH_MS)) {
      return cached.info;
    }
    const entry: CacheEntry = {
      at: this.#now(),
      failed: false,
      info: this.#load(name).catch((error: unknown) => {
        console.error('[edsm]', error);
        entry.failed = true;
        return { name, status: 'unavailable' as const };
      }),
    };
    this.#cache.set(key, entry);
    return entry.info;
  }

  /**
   * Which of `names` EDSM knows, as the id64s it has for them (digits, to match either kind of
   * `SystemAddress`). One request per few dozen names, so a whole route is cheap; rejects if EDSM
   * can't be reached.
   */
  async knownSystems(names: readonly string[], signal?: AbortSignal): Promise<Set<string>> {
    const known = new Set<string>();
    for (let start = 0; start < names.length; start += SYSTEMS_PER_REQUEST) {
      const query = names
        .slice(start, start + SYSTEMS_PER_REQUEST)
        .map((name) => `systemName[]=${encodeURIComponent(name)}`)
        .join('&');
      // EDSM answers a list of the systems it knows, and `[]` or `{}` when it knows none.
      const systems = await this.#get(`/api-v1/systems?${query}&showId=1`, signal);
      if (!Array.isArray(systems)) continue;
      for (const system of systems as unknown[]) {
        const id64 = field(system, 'id64');
        if (typeof id64 === 'number' || typeof id64 === 'bigint') known.add(String(id64));
      }
    }
    return known;
  }

  /**
   * Where each of `names` is that EDSM knows, keyed by the name in lower case. One request per few
   * dozen names; rejects if EDSM can't be reached.
   */
  async coordinates(names: readonly string[], signal?: AbortSignal): Promise<Map<string, Coords>> {
    const found = new Map<string, Coords>();
    for (let start = 0; start < names.length; start += SYSTEMS_PER_REQUEST) {
      const query = names
        .slice(start, start + SYSTEMS_PER_REQUEST)
        .map((name) => `systemName[]=${encodeURIComponent(name)}`)
        .join('&');
      const systems = await this.#get(`/api-v1/systems?${query}&showCoordinates=1`, signal);
      if (!Array.isArray(systems)) continue;
      for (const system of systems as unknown[]) {
        const name = field(system, 'name');
        const coords = field(system, 'coords');
        const [x, y, z] = ['x', 'y', 'z'].map((axis) => field(coords, axis));
        if (
          typeof name === 'string' &&
          typeof x === 'number' &&
          typeof y === 'number' &&
          typeof z === 'number'
        ) {
          found.set(name.toLowerCase(), [x, y, z]);
        }
      }
    }
    return found;
  }

  async #load(name: string): Promise<SystemExternalInfo> {
    const query = `systemName=${encodeURIComponent(name)}`;
    const [traffic, deaths, stations, system] = await Promise.all([
      this.#get(`/api-system-v1/traffic?${query}`),
      this.#get(`/api-system-v1/deaths?${query}`),
      this.#get(`/api-system-v1/stations?${query}`),
      this.#get(`/api-v1/system?${query}&showPrimaryStar=1`),
    ]);
    const trafficCounts = counts(field(traffic, 'traffic'));
    const star = field(system, 'primaryStar');
    // EDSM answers `{}` (or `[]`) for systems it doesn't know.
    if (!trafficCounts && !star) return { name, status: 'unknown' };

    const starType = field(star, 'type');
    return {
      name: typeof field(system, 'name') === 'string' ? String(field(system, 'name')) : name,
      status: 'ok',
      traffic: trafficCounts,
      deaths: counts(field(deaths, 'deaths')),
      primaryStar:
        typeof starType === 'string'
          ? { type: starType, scoopable: field(star, 'isScoopable') === true }
          : undefined,
      closestStarport: closestStarport(field(stations, 'stations')),
    };
  }

  async #get(path: string, signal?: AbortSignal): Promise<unknown> {
    const response = await this.#fetch(`${EDSM_BASE_URL}${path}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal,
    });
    if (!response.ok) throw new Error(`EDSM answered ${response.status} for ${path}`);
    // Parsed as the journal is, so an id64 past 2^53 isn't rounded into another system's.
    return parseJournalJson(await response.text());
  }
}

/** A property of a JSON object, or undefined if `value` isn't one. */
function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined;
}

function counts(value: unknown): Counts | undefined {
  const day = field(value, 'day');
  const week = field(value, 'week');
  const total = field(value, 'total');
  return typeof day === 'number' && typeof week === 'number' && typeof total === 'number'
    ? { day, week, total }
    : undefined;
}

function closestStarport(stations: unknown): SystemExternalInfo['closestStarport'] {
  if (!Array.isArray(stations)) return undefined;
  let closest: SystemExternalInfo['closestStarport'];
  for (const station of stations as unknown[]) {
    const name = field(station, 'name');
    const type = field(station, 'type');
    const distance = field(station, 'distanceToArrival');
    // Fleet carriers come and go.
    if (typeof name !== 'string' || typeof type !== 'string' || typeof distance !== 'number')
      continue;
    if (type === 'Fleet Carrier') continue;
    if (!closest || distance < closest.distanceLs) closest = { name, type, distanceLs: distance };
  }
  return closest;
}
