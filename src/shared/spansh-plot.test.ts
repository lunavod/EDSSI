import { describe, expect, it } from 'vitest';

import { scoopableAt } from './csv-route';
import { spanshPlotTitle, spanshResultsUrl, spanshToCsvRoute } from './spansh-plot';

const AT = '2026-10-16T12:00:00.000Z';

describe('spanshToCsvRoute', () => {
  it("reads the galaxy plotter's jumps under Spansh's CSV columns", () => {
    const { route, summary } = spanshToCsvRoute(
      'galaxy',
      [
        {
          jumps: [
            { name: 'Sol', distance: 0, fuel_in_tank: 32, fuel_used: 0, x: 0, y: 0, z: 0 },
            {
              name: 'G 166-21',
              distance: 40.123,
              fuel_in_tank: 32,
              fuel_used: 2.5,
              must_refuel: true,
              is_scoopable: true,
              x: 1,
              y: 2,
              z: 3,
            },
            {
              name: 'Lalande 25224',
              distance: 30,
              fuel_in_tank: 29,
              fuel_used: 3,
              has_neutron: true,
              must_inject: 1,
            },
          ],
        },
      ],
      'Sol → Lalande 25224 · galaxy',
      AT,
    );
    expect(route.columns).toEqual([
      'Distance',
      'Distance Remaining',
      'Fuel Left',
      'Fuel Used',
      'Refuel',
      'Neutron Star',
      'Inject',
    ]);
    expect(route.systems.map((system) => system.values)).toEqual([
      ['0', '70.12', '32', '0', 'No', 'No', 'No'],
      ['40.12', '30', '32', '2.5', 'Yes', 'No', 'No'],
      ['30', '0', '29', '3', 'No', 'Yes', 'Yes'],
    ]);
    expect(route.systems[1]?.coords).toEqual([1, 2, 3]);
    expect(route.systems[2]?.coords).toBeUndefined();
    // The route tab reads Refuel: Yes as a scoopable star.
    expect(scoopableAt(route, 1)).toBe(true);
    expect(summary).toEqual({
      jumps: 2,
      stops: 3,
      distance: expect.closeTo(70.123),
      supercharged: 1,
      refuels: 1,
      injections: 1,
    });
  });

  it('joins the legs of a galaxy route with stops on the way', () => {
    const leg = (from: string, to: string) => ({
      jumps: [
        { name: from, distance: 0 },
        { name: to, distance: 10 },
      ],
    });
    const { route, summary } = spanshToCsvRoute('galaxy', [leg('A', 'B'), leg('B', 'C')], 't', AT);
    expect(route.systems.map((system) => system.name)).toEqual(['A', 'B', 'C']);
    expect(route.systems.map((system) => system.values[1])).toEqual(['20', '10', '0']);
    expect(summary.jumps).toBe(2);
  });

  it("counts a neutron route's jumps between its waypoints", () => {
    const { route, summary } = spanshToCsvRoute(
      'neutron',
      [
        {
          system_jumps: [
            { system: 'Sol', distance_jumped: 0, jumps: 0, neutron_star: false, x: 0, y: 0, z: 0 },
            { system: 'Neutron', distance_jumped: 180, jumps: 4, neutron_star: true },
            { system: 'End', distance_jumped: 200.5, jumps: 2, neutron_star: false },
          ],
        },
      ],
      't',
      AT,
    );
    expect(route.columns).toEqual(['Distance', 'Distance Remaining', 'Neutron Star', 'Jumps']);
    expect(route.systems.map((system) => system.values)).toEqual([
      ['0', '380.5', 'No', '0'],
      ['180', '200.5', 'Yes', '4'],
      ['200.5', '0', 'No', '2'],
    ]);
    expect(summary).toEqual({ jumps: 6, stops: 3, distance: 380.5, supercharged: 1 });
  });

  it("reads a carrier route's tritium and restocks", () => {
    const { route, summary } = spanshToCsvRoute(
      'carrier',
      [
        {
          jumps: [
            {
              name: 'Sol',
              distance: 0,
              fuel_in_tank: 25,
              fuel_used: 0,
              tritium_in_market: 0,
              must_restock: 1,
              restock_amount: 25,
            },
            {
              name: 'HIP 21991',
              distance: 159.74,
              fuel_in_tank: 0,
              fuel_used: 25,
              tritium_in_market: 0,
              is_system_pristine: true,
              must_restock: 0,
              restock_amount: 0,
            },
          ],
        },
      ],
      't',
      AT,
    );
    expect(route.systems[1]?.values).toEqual(['159.74', '0', '0', '0', '25', 'No', 'Yes', '0']);
    expect(summary).toEqual({ jumps: 1, stops: 2, distance: 159.74, tritium: 25, restocks: 1 });
  });

  it("throws on an answer that isn't the plotter's", () => {
    expect(() => spanshToCsvRoute('galaxy', [{ system_jumps: [] }], 't', AT)).toThrow(
      /lists no systems/,
    );
  });
});

describe('spanshPlotTitle', () => {
  it('names the current system for an empty From', () => {
    expect(
      spanshPlotTitle(
        { kind: 'neutron', from: '', to: 'Colonia', via: ['Sagittarius A*'], efficiency: 60 },
        'Sol',
      ),
    ).toBe('Sol → Sagittarius A* → Colonia · neutron');
  });
});

describe('spanshResultsUrl', () => {
  it("links each plotter's own results page", () => {
    expect(spanshResultsUrl('galaxy', 'J')).toBe('https://spansh.co.uk/exact-plotter/results/J');
    expect(spanshResultsUrl('neutron', 'J')).toBe('https://spansh.co.uk/plotter/results/J');
    expect(spanshResultsUrl('carrier', 'J')).toBe('https://spansh.co.uk/fleet-carrier/results/J');
  });
});
