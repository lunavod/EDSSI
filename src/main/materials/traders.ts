/**
 * Stations with a material trader, from Spansh's station search (`material_trader` is Raw,
 * Manufactured or Encoded): the Materials tab's Traders page. Carriers have no trader, so nothing
 * here asks about docking access.
 */

import {
  TRADED_CATEGORIES,
  type TradedCategory,
  type TraderSearchRequest,
  type TraderStation,
} from '../../shared/crafting';
import { field, type SpanshClient } from '../spansh/client';
import { asArray, largestPad } from '../spansh/compact';
import type { Reference } from '../spansh/reference';

export function isTradedCategory(value: unknown): value is TradedCategory {
  return TRADED_CATEGORIES.some((category) => category === value);
}

/** Stations per page. */
export const TRADER_PAGE_SIZE = 25;

export function traderSearchBody(
  request: TraderSearchRequest,
  reference: Reference,
): Record<string, unknown> {
  const types = request.types.length > 0 ? request.types : [...TRADED_CATEGORIES];
  const filters: Record<string, unknown> = {
    material_trader: { value: types },
    distance: { min: 0, max: request.maxDistanceLy },
  };
  if (request.pad === 'large') filters['has_large_pad'] = { value: true };
  if (request.maxArrivalLs > 0) {
    filters['distance_to_arrival'] = { comparison: '<=', value: request.maxArrivalLs };
  }
  if (!request.planetary) filters['is_planetary'] = { value: false };
  return {
    filters,
    sort: [{ distance: { direction: 'asc' } }],
    size: TRADER_PAGE_SIZE,
    page: request.page,
    ...reference,
  };
}

/** The stations in a page of results; a medium pad is checked here, as Spansh can't ask for it. */
export function readTraders(
  result: unknown,
  pad: TraderSearchRequest['pad'],
): { stations: TraderStation[]; total: number } {
  const stations: TraderStation[] = [];
  for (const row of asArray(field(result, 'results'))) {
    const station = readTrader(row);
    if (!station || (pad === 'medium' && station.pad === 'S')) continue;
    stations.push(station);
  }
  const total = Number(field(result, 'count'));
  return { stations, total: Number.isFinite(total) ? total : stations.length };
}

function readTrader(row: unknown): TraderStation | undefined {
  const name = field(row, 'name');
  const system = field(row, 'system_name');
  const distance = Number(field(row, 'distance'));
  const trader = field(row, 'material_trader');
  if (
    typeof name !== 'string' ||
    typeof system !== 'string' ||
    !Number.isFinite(distance) ||
    !isTradedCategory(trader)
  ) {
    return undefined;
  }
  const type = field(row, 'type');
  const marketId = field(row, 'market_id') ?? field(row, 'id');
  const arrival = Number(field(row, 'distance_to_arrival'));
  const updated = field(row, 'updated_at');
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
    planetary: field(row, 'is_planetary') === true,
    trader,
    ...(typeof updated === 'string' && { updatedAt: updated }),
  };
}

/** One page of stations with the traders asked for, nearest first. */
export async function searchTraders(
  client: SpanshClient,
  request: TraderSearchRequest,
  reference: Reference,
  signal?: AbortSignal,
): Promise<{ stations: TraderStation[]; total: number }> {
  const result = await client.search('stations', traderSearchBody(request, reference), signal);
  return readTraders(result, request.pad);
}
