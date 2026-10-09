import { describe, expect, it } from 'vitest';

import type { RouteResult } from './client';
import {
  compactRoute,
  compactStationResult,
  compactSystem,
  daysAgo,
  describeRoute,
  listValues,
  ROUTE_WINDOW,
} from './compact';

/** Cut-down answers from each plotter, shaped as Spansh sent them. */
function route(result: unknown, parameters: Record<string, unknown> = {}): RouteResult {
  return { job: 'J', status: 'ok', parameters, result };
}

describe('compactRoute', () => {
  it('reads a neutron route', () => {
    const { kind, summary, rows } = compactRoute(
      route({
        source_system: 'Sol',
        destination_system: 'Colonia',
        distance: 22000.47,
        total_jumps: 48,
        system_jumps: [
          { system: 'Sol', jumps: 0, neutron_star: false, distance_left: 22000.47 },
          { system: 'PSR J1752-2806', jumps: 6, neutron_star: true, distance_left: 21629.2 },
        ],
      }),
    );
    expect(kind).toBe('neutron');
    expect(summary).toMatchObject({ distance_ly: 22000, total_jumps: 48, neutron_boosts: 1 });
    expect(rows[1]).toEqual({ system: 'PSR J1752-2806', jumps: 6, neutron: true, left_ly: 21629 });
  });

  it('tells a tourist route from a neutron one', () => {
    expect(
      compactRoute(
        route({
          destination_systems: ['A'],
          system_jumps: [{ system: 'A', jumps: 2, distance: 4.4 }],
        }),
      ).kind,
    ).toBe('tourist');
  });

  it('counts refuels and neutrons on an exact route', () => {
    const { kind, summary } = compactRoute(
      route({
        jumps: [
          { name: 'Sol', distance: 0, must_refuel: false, has_neutron: false, fuel_in_tank: 128 },
          { name: 'G 166-21', distance: 75.8, must_refuel: true, is_scoopable: true },
          { name: 'Lalande 25224', distance: 72.4, must_refuel: false, has_neutron: true },
        ],
      }),
    );
    expect(kind).toBe('galaxy');
    expect(summary).toEqual({
      jumps: 2,
      distance_ly: 148,
      refuels: 1,
      neutron_boosts: 1,
      injections: 0,
    });
  });

  it('adds up the tritium of a carrier route', () => {
    const { kind, summary, rows } = compactRoute(
      route({
        jumps: [
          {
            name: 'Sol',
            distance: 0,
            fuel_used: 0,
            must_restock: 1,
            restock_amount: 3154,
            tritium_in_market: 2154,
          },
          {
            name: 'Far',
            distance: 499.8,
            fuel_used: 75,
            must_restock: 0,
            has_icy_ring: true,
            tritium_in_market: 2004,
          },
        ],
      }),
    );
    expect(kind).toBe('fleet carrier');
    expect(summary).toEqual({ carrier_jumps: 1, tritium_t: 75, restocks: 1 });
    expect(rows[0]).toMatchObject({ restock_t: 3154 });
    expect(rows[1]).toMatchObject({ icy_ring: true, restock_t: undefined });
  });

  it('values exobiology by species and a road to riches by mapping', () => {
    const body = {
      name: 'Saktsak AB 2 f',
      subtype: 'Rocky body',
      distance_to_arrival: 2126.2,
      estimated_mapping_value: 2221,
      landmark_value: 35275300,
      landmarks: [{ subtype: 'Tussock Stigmasis', value: 19010800 }],
    };
    const exobiology = compactRoute(route([{ name: 'Saktsak', jumps: 1, bodies: [body] }]));
    expect(exobiology.kind).toBe('exobiology');
    expect(exobiology.summary).toEqual({ total_jumps: 1, total_value_cr: 35275300 });

    const riches = compactRoute(
      route([{ name: 'Saktsak', jumps: 1, bodies: [body] }], { use_mapping_value: '1' }),
    );
    expect(riches.kind).toBe('road to riches');
    expect(riches.summary).toEqual({ total_jumps: 1, total_value_cr: 2221 });
  });

  it('lists what to buy on each trade hop', () => {
    const { kind, summary, rows } = compactRoute(
      route([
        {
          source: { station: 'Galileo', system: 'Sol' },
          destination: { station: 'Broglie Terminal', system: '61 Cygni' },
          distance: 11.37,
          commodities: [
            {
              name: 'Silver',
              amount: 100,
              total_profit: 587400,
              source_commodity: { buy_price: 34426 },
              destination_commodity: { sell_price: 40300 },
            },
          ],
          total_profit: 587400,
          cumulative_profit: 587400,
        },
      ]),
    );
    expect(kind).toBe('trade');
    expect(summary).toEqual({ total_profit_cr: 587400 });
    expect(rows[0]).toMatchObject({
      from: 'Galileo, Sol',
      to: 'Broglie Terminal, 61 Cygni',
      buy: [{ commodity: 'Silver', tonnes: 100, buy_cr: 34426, sell_cr: 40300 }],
    });
  });
});

describe('describeRoute', () => {
  it('hands a long route over a window at a time', () => {
    const stops = Array.from({ length: 30 }, (_, index) => ({ system: `S${index}`, jumps: 1 }));
    const state = { done: true as const, route: route({ total_jumps: 30, system_jumps: stops }) };
    expect(describeRoute(state, 0)).toMatchObject({ next_offset: ROUTE_WINDOW, stops_total: 30 });
    const last = describeRoute(state, ROUTE_WINDOW) as { stops: unknown[]; next_offset?: number };
    expect(last.stops).toHaveLength(5);
    expect(last.next_offset).toBeUndefined();
  });

  it('says a route is still being plotted', () => {
    expect(describeRoute({ done: false, job: 'J', state: 'started' }, 0)).toMatchObject({
      job: 'J',
      status: 'still plotting (started)',
    });
  });
});

describe('compactStationResult', () => {
  it('shows the rows a search asked about, with their age', () => {
    const now = Date.parse('2026-09-14T12:00:00Z');
    const station = {
      name: 'Galileo',
      type: 'Ocellus Starport',
      system_name: 'Sol',
      distance: 0,
      distance_to_arrival: 500.2,
      has_large_pad: true,
      market: [
        { commodity: 'Gold', buy_price: 9000, supply: 10 },
        { commodity: 'Tritium', buy_price: 53710, supply: 533120, sell_price: 52606, demand: 1 },
      ],
      market_updated_at: new Date(now - 4 * 86_400_000).toISOString(),
    };
    const result = compactStationResult(station, [
      { field: 'marketplace', parts: [{ field: 'commodity', values: ['tritium'] }] },
    ]);
    expect(result).toMatchObject({
      name: 'Galileo',
      largest_pad: 'L',
      arrival_ls: 500,
      market: [{ commodity: 'Tritium', buy_cr: 53710, supply: 533120 }],
      modules: undefined,
    });
  });
});

describe('compactSystem', () => {
  it('leaves carriers out of the station list and counts them', () => {
    const system = compactSystem(
      {
        name: 'Colonia',
        x: 0,
        y: 0,
        z: 10,
        stations: [
          {
            name: 'Jaques Station',
            type: 'Orbis Starport',
            services: ['Refuel', 'Dock'],
            has_large_pad: true,
          },
          { name: 'X7J-00K', type: 'Drake-Class Carrier', services: [] },
        ],
        bodies: [{ name: 'Colonia 5', subtype: 'Water world', estimated_mapping_value: 1 }],
      },
      { x: 0, y: 0, z: 0 },
    );
    expect(system).toMatchObject({
      distance_from_commander_ly: 10,
      stations: [{ name: 'Jaques Station', largest_pad: 'L', services: ['Refuel'] }],
      fleet_carriers: 1,
      notable_bodies: [{ name: 'Colonia 5', type: 'Water world' }],
    });
  });
});

describe('daysAgo', () => {
  it("reads Spansh's timestamps, offset and all", () => {
    const now = Date.parse('2026-09-14T13:23:24Z');
    expect(daysAgo('2026-06-13 13:23:24+00', now)).toBe(93);
    expect(daysAgo('not a date', now)).toBeUndefined();
    expect(daysAgo(undefined, now)).toBeUndefined();
  });
});

describe('listValues', () => {
  it('lists plain values, values per part, or the names of ranges', () => {
    expect(listValues({ values: ['Raw', 'Encoded'] }, 'enc')).toEqual(['Encoded']);
    expect(listValues({ values: { name: ['Fuel Scoop', 'Sensors'] } }, 'scoop')).toEqual({
      name: ['Fuel Scoop'],
    });
    expect(listValues({ min_max: { Biological: {}, Geological: {} } }, undefined)).toEqual([
      'Biological',
      'Geological',
    ]);
  });
});
