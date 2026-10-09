/**
 * The Plan page: finds markets for everything still missing from the shopping list, then works
 * out ways to buy it (`planPurchases`). Spansh can't be asked which stations stock the most of a
 * list, so for each commodity it is asked for the nearest markets with stock and the cheapest, plus
 * the ones stocking all of it; each result carries the station's whole market, so the big markets
 * that sell most of the list turn up in many of the searches and the plan can buy there in bulk.
 * The Sell page's plan (`planSelling`) is the same, asking for markets that buy instead.
 */

import {
  asOffering,
  commodityKey,
  type MarketStation,
  planPurchases,
  type PlanRequest,
  type ShoppingNeed,
  type ShoppingPlan,
} from '../../shared/commodities';
import type { SpanshClient } from '../spansh/client';
import {
  type MarketScope,
  readSellStations,
  readStations,
  type Reference,
  scopeOf,
  searchBody,
  sellBody,
  stationTypes,
} from './market-search';

/** Stations per search. A row carries its whole market and outfitting (~40 kB), so not many. */
const PAGE_SIZE = 25;
/** Searches in flight at once. */
const CONCURRENCY = 4;

type Planned = Promise<{ plans: ShoppingPlan[]; stations: number }>;

export function planShopping(
  client: SpanshClient,
  needs: readonly ShoppingNeed[],
  request: PlanRequest,
  reference: Reference,
  options: { now: number; signal?: AbortSignal },
): Planned {
  return planMarkets('buy', client, needs, request, reference, options);
}

/**
 * Ways to sell `needs` across the markets that buy them: each plan's purchases are sales and its
 * cost what they bring in (see `planSales`).
 */
export function planSelling(
  client: SpanshClient,
  needs: readonly ShoppingNeed[],
  request: PlanRequest,
  reference: Reference,
  options: { now: number; signal?: AbortSignal },
): Planned {
  return planMarkets('sell', client, needs, request, reference, options);
}

async function planMarkets(
  side: 'buy' | 'sell',
  client: SpanshClient,
  needs: readonly ShoppingNeed[],
  request: PlanRequest,
  reference: Reference,
  options: { now: number; signal?: AbortSignal },
): Planned {
  if (needs.length === 0) return { plans: [], stations: 0 };
  const types = await stationTypes(client, options.signal);
  const wanted = needs.map((need) => need.commodity);
  const found = new Map<string, MarketStation>();

  const gather = async (commodities: readonly string[], scope: MarketScope): Promise<void> => {
    const searches: { commodities: string[]; sortBy: 'distance' | 'price' }[] = commodities.flatMap(
      (commodity) => [
        { commodities: [commodity], sortBy: 'distance' as const },
        { commodities: [commodity], sortBy: 'price' as const },
      ],
    );
    if (commodities.length > 1) {
      searches.unshift({ commodities: [...commodities], sortBy: 'distance' });
    }
    let failures = 0;
    let lastError: unknown;
    await eachLimited(searches, CONCURRENCY, async (search) => {
      const common = {
        ...search,
        filters: request,
        types,
        reference,
        size: PAGE_SIZE,
        page: 0,
        now: options.now,
        scope,
      };
      const body =
        side === 'buy'
          ? searchBody({ ...common, minSupply: 1 })
          : sellBody({ ...common, minDemand: 1 });
      try {
        const result = await client.search('stations', body, options.signal);
        const stations =
          side === 'buy'
            ? readStations(result, wanted, request).stations
            : readSellStations(result, wanted, request).stations.map(asOffering);
        for (const station of stations) found.set(station.marketId, station);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        failures++;
        lastError = error;
      }
    });
    // Some searches failing leaves a plan worth having; all of them failing is Spansh being down.
    if (failures === searches.length) throw lastError;
  };

  const minimise = request.planetary === 'minimise';
  // Minimising planetary markets: orbital ones first, then planetary ones only for what the
  // orbital ones found don't stock enough of.
  await gather(wanted, minimise ? 'orbital' : scopeOf(request));
  if (minimise) {
    const lacking = shortAt([...found.values()], needs);
    if (lacking.length > 0) await gather(lacking, 'planetary');
  }
  const stations = [...found.values()];
  return {
    plans: planPurchases(needs, stations, {
      minimisePlanetary: minimise,
      highest: side === 'sell',
    }),
    stations: stations.length,
  };
}

/** The commodities `stations` don't stock enough of between them. */
export function shortAt(
  stations: readonly MarketStation[],
  needs: readonly ShoppingNeed[],
): string[] {
  const stock = new Map<string, number>();
  for (const station of stations) {
    for (const offer of station.offers) {
      const key = commodityKey(offer.commodity);
      stock.set(key, (stock.get(key) ?? 0) + offer.supply);
    }
  }
  return needs
    .filter((need) => (stock.get(commodityKey(need.commodity)) ?? 0) < need.quantity)
    .map((need) => need.commodity);
}

async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
