/**
 * Markets that sell commodities, from Spansh's station search: what the Commodities tab's Search
 * page shows, and what its Plan page plans over; and markets that buy them, for its Sell page
 * (the same, asking for `demand` where buying asks for `supply`). Each item in `marketplace` is one commodity a
 * station must stock, and Spansh wants all of them (checked against the live site). A
 * result row carries the station's whole market, so a station found for one
 * commodity also says what it has of the others.
 */

import type {
  CommoditySearchRequest,
  CommoditySellRequest,
  MarketBid,
  MarketFilters,
  MarketOffer,
  MarketPlace,
  MarketStation,
  SellStation,
} from '../../shared/commodities';
import { commodityKey, journalCommodityName } from '../../shared/commodities';
import { CARRIER_TYPE } from '../carriers/alert';
import { field, type SpanshClient } from '../spansh/client';
import { asArray, largestPad } from '../spansh/compact';
import type { Reference } from '../spansh/reference';

/** They take deliveries; nothing is bought there. */
const CONSTRUCTION = new Set(['Planetary Construction Depot', 'Space Construction Depot']);
const PLANETARY = new Set([
  'Planetary Outpost',
  'Planetary Port',
  'Settlement',
  'Surface Settlement',
]);
/** For when Spansh's own list can't be had. */
const FALLBACK_TYPES = [
  'Asteroid base',
  'Coriolis Starport',
  'Dodec Starport',
  CARRIER_TYPE,
  'Mega ship',
  'Ocellus Starport',
  'Orbis Starport',
  'Outpost',
  'Planetary Outpost',
  'Planetary Port',
  'Settlement',
  'Surface Settlement',
];
const DAY_MS = 24 * 60 * 60_000;

export type { Reference } from '../spansh/reference';

/** Every station type Spansh knows, from its field values. */
export async function stationTypes(client: SpanshClient, signal?: AbortSignal): Promise<string[]> {
  try {
    const values = field(await client.fieldValues('stations', 'type', signal), 'values');
    const types = asArray(values).filter((value): value is string => typeof value === 'string');
    return types.length > 0 ? types : FALLBACK_TYPES;
  } catch {
    return FALLBACK_TYPES;
  }
}

/** Every commodity name Spansh's markets use. */
export async function commodityNames(
  client: SpanshClient,
  signal?: AbortSignal,
): Promise<string[]> {
  const values = field(
    field(await client.fieldValues('stations', 'marketplace', signal), 'values'),
    'commodity',
  );
  return asArray(values)
    .filter((value): value is string => typeof value === 'string')
    .toSorted((a, b) => a.localeCompare(b));
}

/** Which markets a search covers; the planner splits `minimise` into two searches. */
export type MarketScope = 'all' | 'orbital' | 'planetary';

export function scopeOf(filters: Pick<MarketFilters, 'planetary'>): MarketScope {
  return filters.planetary === 'no' ? 'orbital' : 'all';
}

/** The body of one search for markets selling `commodities`. */
export function searchBody(options: {
  commodities: readonly string[];
  filters: MarketFilters;
  types: readonly string[];
  reference: Reference;
  /** One for every commodity, or each its own. */
  minSupply: number | readonly number[];
  sortBy: 'distance' | 'price';
  size: number;
  page: number;
  now: number;
  /** Unset: as `filters.planetary` says. */
  scope?: MarketScope;
}): Record<string, unknown> {
  const first = options.commodities[0];
  return {
    filters: {
      marketplace: options.commodities.map((commodity, index) => ({
        commodity: { value: [commodity] },
        supply: { comparison: '>=', value: minimumOf(options.minSupply, index) },
      })),
      ...placeFilters(options),
    },
    sort:
      options.sortBy === 'price' && first !== undefined
        ? [
            { market_buy_price: [{ name: first, direction: 'asc' }] },
            { distance: { direction: 'asc' } },
          ]
        : [{ distance: { direction: 'asc' } }],
    size: options.size,
    page: options.page,
    ...options.reference,
  };
}

/** The body of one search for markets buying `commodities`; by price, the best first. */
export function sellBody(options: {
  commodities: readonly string[];
  filters: MarketFilters;
  types: readonly string[];
  reference: Reference;
  /** One for every commodity, or each its own. */
  minDemand: number | readonly number[];
  sortBy: 'distance' | 'price';
  size: number;
  page: number;
  now: number;
  /** Unset: as `filters.planetary` says. */
  scope?: MarketScope;
}): Record<string, unknown> {
  const first = options.commodities[0];
  return {
    filters: {
      marketplace: options.commodities.map((commodity, index) => ({
        commodity: { value: [commodity] },
        demand: { comparison: '>=', value: minimumOf(options.minDemand, index) },
      })),
      ...placeFilters(options),
    },
    sort:
      options.sortBy === 'price' && first !== undefined
        ? [
            { market_sell_price: [{ name: first, direction: 'desc' }] },
            { distance: { direction: 'asc' } },
          ]
        : [{ distance: { direction: 'asc' } }],
    size: options.size,
    page: options.page,
    ...options.reference,
  };
}

/** The `index`th commodity's minimum: at least 1, as Spansh counts 0 as none in stock. */
function minimumOf(minimum: number | readonly number[], index: number): number {
  const value = typeof minimum === 'number' ? minimum : minimum[index];
  return Math.max(1, Math.floor(Number(value) || 0));
}

/** Which stations count, whether their markets are searched for buying or selling. */
function placeFilters(options: {
  filters: MarketFilters;
  types: readonly string[];
  now: number;
  scope?: MarketScope;
}): Record<string, unknown> {
  const { filters } = options;
  const scope = options.scope ?? scopeOf(filters);
  const types = options.types.filter(
    (type) =>
      !CONSTRUCTION.has(type) &&
      (filters.carriers || type !== CARRIER_TYPE) &&
      (scope === 'all' || (scope === 'planetary') === PLANETARY.has(type)),
  );
  const built: Record<string, unknown> = {
    distance: { min: 0, max: filters.maxDistanceLy },
    type: { value: types },
  };
  if (filters.pad === 'large') built['has_large_pad'] = { value: true };
  if (filters.maxArrivalLs > 0) {
    built['distance_to_arrival'] = { comparison: '<=', value: filters.maxArrivalLs };
  }
  if (filters.maxAgeDays > 0) {
    built['market_updated_at'] = {
      comparison: '<=>',
      value: [
        new Date(options.now - filters.maxAgeDays * DAY_MS).toISOString(),
        new Date(options.now).toISOString(),
      ],
    };
  }
  return built;
}

/**
 * The stations in a page of results that suit the filters, each with its offers of `wanted`. A
 * medium pad and a carrier's docking access are checked here, as Spansh can't ask for them.
 */
export function readStations(
  result: unknown,
  wanted: readonly string[],
  filters: Pick<MarketFilters, 'pad'>,
): { stations: MarketStation[]; total: number } {
  const keys = new Set(wanted.map(commodityKey));
  return readPlaces(result, filters, (row, place) => ({ ...place, offers: readOffers(row, keys) }));
}

/** As `readStations`, with what each station pays for `wanted` and how much it wants. */
export function readSellStations(
  result: unknown,
  wanted: readonly string[],
  filters: Pick<MarketFilters, 'pad'>,
): { stations: SellStation[]; total: number } {
  const keys = new Set(wanted.map(commodityKey));
  return readPlaces(result, filters, (row, place) => ({ ...place, bids: readBids(row, keys) }));
}

function readPlaces<T extends MarketPlace>(
  result: unknown,
  filters: Pick<MarketFilters, 'pad'>,
  read: (row: unknown, place: MarketPlace) => T,
): { stations: T[]; total: number } {
  const stations: T[] = [];
  for (const row of asArray(field(result, 'results'))) {
    const place = readPlace(row);
    if (!place) continue;
    if (filters.pad === 'medium' && place.pad === 'S') continue;
    if (filters.pad === 'large' && place.pad !== 'L') continue;
    if (place.carrier && field(row, 'carrier_docking_access') !== 'All') continue;
    stations.push(read(row, place));
  }
  const total = Number(field(result, 'count'));
  return { stations, total: Number.isFinite(total) ? total : stations.length };
}

function readOffers(row: unknown, wanted: ReadonlySet<string>): MarketOffer[] {
  return asArray(field(row, 'market')).flatMap((entry) => {
    const commodity = field(entry, 'commodity');
    const buyPrice = Number(field(entry, 'buy_price'));
    const supply = Number(field(entry, 'supply'));
    if (typeof commodity !== 'string' || !wanted.has(commodityKey(commodity))) return [];
    if (!(supply > 0) || !(buyPrice > 0)) return [];
    return [{ commodity, buyPrice, supply }];
  });
}

function readBids(row: unknown, wanted: ReadonlySet<string>): MarketBid[] {
  return asArray(field(row, 'market')).flatMap((entry) => {
    const commodity = field(entry, 'commodity');
    const sellPrice = Number(field(entry, 'sell_price'));
    const demand = Number(field(entry, 'demand'));
    if (typeof commodity !== 'string' || !wanted.has(commodityKey(commodity))) return [];
    if (!(demand > 0) || !(sellPrice > 0)) return [];
    return [{ commodity, sellPrice, demand }];
  });
}

function readPlace(row: unknown): MarketPlace | undefined {
  const name = field(row, 'name');
  const system = field(row, 'system_name');
  const distance = Number(field(row, 'distance'));
  const marketId = field(row, 'market_id') ?? field(row, 'id');
  if (typeof name !== 'string' || typeof system !== 'string' || !Number.isFinite(distance)) {
    return undefined;
  }
  const type = field(row, 'type');
  const [x, y, z] = ['system_x', 'system_y', 'system_z'].map((key) => field(row, key));
  const arrival = Number(field(row, 'distance_to_arrival'));
  const updated = field(row, 'market_updated_at');
  const pad = largestPad(row);
  return {
    marketId:
      typeof marketId === 'number' || typeof marketId === 'bigint' || typeof marketId === 'string'
        ? String(marketId)
        : `${system}/${name}`,
    name,
    type: typeof type === 'string' ? type : '',
    system,
    distanceLy: distance,
    ...(Number.isFinite(arrival) && { arrivalLs: arrival }),
    ...((pad === 'S' || pad === 'M' || pad === 'L') && { pad }),
    planetary:
      field(row, 'is_planetary') === true || (typeof type === 'string' && PLANETARY.has(type)),
    carrier: type === CARRIER_TYPE,
    ...(typeof x === 'number' &&
      typeof y === 'number' &&
      typeof z === 'number' && { coords: [x, y, z] as [number, number, number] }),
    ...(typeof updated === 'string' && { marketUpdatedAt: updated }),
  };
}

/** Within this of the reference is its own system; Spansh ignores a distance of 0. */
const SAME_SYSTEM_LY = 0.01;

/**
 * The markets in one system stocking any of `commodities`. One `marketplace` item naming several
 * commodities asks for any of them.
 */
export function systemMarketsBody(options: {
  commodities: readonly string[];
  types: readonly string[];
  reference: Reference;
}): Record<string, unknown> {
  return {
    filters: {
      marketplace: [
        { commodity: { value: [...options.commodities] }, supply: { comparison: '>=', value: 1 } },
      ],
      distance: { min: 0, max: SAME_SYSTEM_LY },
      type: { value: options.types.filter((type) => !CONSTRUCTION.has(type)) },
    },
    sort: [{ distance: { direction: 'asc' } }],
    size: 100,
    page: 0,
    ...options.reference,
  };
}

/** The markets in `system` that sell any of `commodities`, from Spansh. */
export async function systemMarkets(
  client: SpanshClient,
  system: string,
  commodities: readonly string[],
  reference: Reference,
  signal?: AbortSignal,
): Promise<MarketStation[]> {
  const types = await stationTypes(client, signal);
  const result = await client.search(
    'stations',
    systemMarketsBody({ commodities, types, reference }),
    signal,
  );
  return readStations(result, commodities, { pad: 'any' }).stations.filter(
    (station) => station.system.toLowerCase() === system.toLowerCase() && station.offers.length > 0,
  );
}

/**
 * The last market opened in the game, from its Market.json (which it keeps after undocking):
 * fresher than anything Spansh has. Its items are named like `$steel_name;`.
 */
export function localMarket(
  market: {
    MarketID?: unknown;
    StationName?: unknown;
    StationType?: unknown;
    StarSystem?: unknown;
    timestamp?: unknown;
    Items?: unknown;
  },
  wanted: readonly string[],
): MarketStation | undefined {
  const { StationName: name, StarSystem: system, StationType: type } = market;
  if (typeof name !== 'string' || typeof system !== 'string' || !Array.isArray(market.Items)) {
    return undefined;
  }
  const keys = new Set(wanted.map(commodityKey));
  const offers: MarketOffer[] = market.Items.flatMap((item: unknown) => {
    const symbol = field(item, 'Name');
    const localised = field(item, 'Name_Localised');
    const buyPrice = Number(field(item, 'BuyPrice'));
    const supply = Number(field(item, 'Stock'));
    if (typeof symbol !== 'string' || !(buyPrice > 0) || !(supply > 0)) return [];
    const commodity = journalCommodityName(
      symbol.replace(/^\$/, '').replace(/_name;$/i, ''),
      typeof localised === 'string' ? localised : undefined,
    );
    return keys.has(commodityKey(commodity)) ? [{ commodity, buyPrice, supply }] : [];
  });
  const id = market.MarketID;
  return {
    marketId: typeof id === 'number' || typeof id === 'bigint' ? String(id) : `${system}/${name}`,
    name,
    type: typeof type === 'string' ? type : '',
    system,
    distanceLy: 0,
    planetary: false,
    carrier: type === 'FleetCarrier',
    ...(typeof market.timestamp === 'string' && { marketUpdatedAt: market.timestamp }),
    offers,
  };
}

/**
 * Spansh's markets with the one read from the game in their place: its offers and age from the game,
 * the rest (pad, type, arrival) from Spansh when it knows the station.
 */
export function withLocalMarket(
  stations: readonly MarketStation[],
  local: MarketStation | undefined,
): MarketStation[] {
  if (!local) return [...stations];
  const known = stations.find((station) => station.marketId === local.marketId);
  const merged = known
    ? { ...known, offers: local.offers, marketUpdatedAt: local.marketUpdatedAt }
    : local;
  const rest = stations.filter((station) => station.marketId !== local.marketId);
  return merged.offers.length > 0 ? [merged, ...rest] : rest;
}

/** One page of the Search page's results. */
export async function searchMarkets(
  client: SpanshClient,
  request: CommoditySearchRequest,
  reference: Reference,
  options: { now: number; size: number; signal?: AbortSignal },
): Promise<{ stations: MarketStation[]; total: number }> {
  const types = await stationTypes(client, options.signal);
  const body = searchBody({
    commodities: request.commodities,
    filters: request,
    types,
    reference,
    minSupply: request.minimums,
    sortBy: request.sort,
    size: options.size,
    page: request.page,
    now: options.now,
  });
  return readStations(
    await client.search('stations', body, options.signal),
    request.commodities,
    request,
  );
}

/** One page of the Sell page's results. */
export async function searchSellMarkets(
  client: SpanshClient,
  request: CommoditySellRequest,
  reference: Reference,
  options: { now: number; size: number; signal?: AbortSignal },
): Promise<{ stations: SellStation[]; total: number }> {
  const types = await stationTypes(client, options.signal);
  const body = sellBody({
    commodities: request.commodities,
    filters: request,
    types,
    reference,
    minDemand: request.minimums,
    sortBy: request.sort,
    size: options.size,
    page: request.page,
    now: options.now,
  });
  return readSellStations(
    await client.search('stations', body, options.signal),
    request.commodities,
    request,
  );
}
