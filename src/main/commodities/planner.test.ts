import { describe, expect, it } from 'vitest';

import { DEFAULT_MARKET_FILTERS } from '../../shared/commodities';
import type { SpanshClient } from '../spansh/client';
import { planShopping } from './planner';

/** A Spansh that answers each search with the stations stocking what it asks for. */
function fakeClient(
  markets: { name: string; distance: number; market: [string, number, number][] }[],
  fail = false,
) {
  const bodies: Record<string, unknown>[] = [];
  const client = {
    fieldValues: () => Promise.resolve({ values: ['Coriolis Starport'] }),
    search: (_kind: string, body: Record<string, unknown>) => {
      bodies.push(body);
      if (fail) return Promise.reject(new Error('Spansh is down'));
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- built by searchBody
      const items = (body['filters'] as { marketplace: { commodity: { value: string[] } }[] })
        .marketplace;
      const wanted = items.map((item) => item.commodity.value[0]);
      const results = markets
        .filter((market) =>
          wanted.every((name) => market.market.some(([commodity]) => commodity === name)),
        )
        .map((market) => ({
          name: market.name,
          system_name: `${market.name} system`,
          market_id: market.name,
          distance: market.distance,
          type: 'Coriolis Starport',
          has_large_pad: true,
          market: market.market.map(([commodity, buy_price, supply]) => ({
            commodity,
            buy_price,
            supply,
          })),
        }));
      return Promise.resolve({ count: results.length, results });
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the two calls the planner makes
  return { client: client as unknown as SpanshClient, bodies };
}

describe('planShopping', () => {
  const needs = [
    { commodity: 'Steel', quantity: 100 },
    { commodity: 'Water', quantity: 20 },
  ];

  it('searches each commodity nearest and cheapest, and all of them together', async () => {
    const { client, bodies } = fakeClient([
      {
        name: 'Hub',
        distance: 30,
        market: [
          ['Steel', 50, 500],
          ['Water', 5, 500],
        ],
      },
      { name: 'Mill', distance: 5, market: [['Steel', 40, 500]] },
    ]);
    const { plans, stations } = await planShopping(
      client,
      needs,
      DEFAULT_MARKET_FILTERS,
      { reference_system: 'Sol' },
      { now: 0 },
    );
    expect(bodies).toHaveLength(5);
    expect(stations).toBe(2);
    expect(plans[0]?.stops.map((stop) => stop.station.name)).toEqual(['Hub']);
    expect(plans.find((plan) => plan.kind === 'cheapest' || plan.cheapest)?.cost).toBe(
      100 * 40 + 20 * 5,
    );
  });

  it('minimising planetary markets, searches planets only for what orbital markets lack', async () => {
    const { client, bodies } = fakeClient([
      { name: 'Mill', distance: 5, market: [['Steel', 40, 500]] },
    ]);
    await planShopping(
      client,
      needs,
      { ...DEFAULT_MARKET_FILTERS, planetary: 'minimise' },
      { reference_system: 'Sol' },
      { now: 0 },
    );
    const commodities = (body: Record<string, unknown>) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- built by searchBody
      (body['filters'] as { marketplace: { commodity: { value: string[] } }[] }).marketplace.map(
        (item) => item.commodity.value[0],
      );
    // Five orbital searches, then Water (which Mill lacks) nearest and cheapest on planets.
    expect(bodies).toHaveLength(7);
    expect(bodies.slice(5).map(commodities)).toEqual([['Water'], ['Water']]);
  });

  it('fails only when every search does', async () => {
    const { client } = fakeClient([], true);
    await expect(
      planShopping(client, needs, DEFAULT_MARKET_FILTERS, { reference_system: 'Sol' }, { now: 0 }),
    ).rejects.toThrow(/down/);
  });
});
