import { describe, expect, it } from 'vitest';

import type { CsvRouteState } from '../../shared/csv-route';
import type { PlottedRoute, RouteSystem } from '../../shared/nav-routes';
import { buildFilters } from './filters';
import { padFor, readSellStops, routeDestination, sellStopFilters } from './sell-stop';

const NOW = Date.parse('2026-09-26T12:00:00Z');

function system(name: string, x: number, address = x): RouteSystem {
  return { StarSystem: name, SystemAddress: address, StarPos: [x, 0, 0], StarClass: 'K' };
}

function csv(names: string[], position?: number): CsvRouteState {
  return {
    route: {
      fileName: 'route.csv',
      loadedAt: '2026-09-26T10:00:00Z',
      columns: [],
      systems: names.map((name) => ({ name, values: [] })),
    },
    position,
    here: position !== undefined,
  };
}

describe('padFor', () => {
  it('knows the large and small ships, and takes the rest for medium', () => {
    expect(padFor('Anaconda')).toBe('large');
    expect(padFor('type9_military')).toBe('large');
    expect(padFor('DiamondBackXL')).toBe('small');
    expect(padFor('krait_mkii')).toBe('medium');
    expect(padFor('some_new_ship')).toBe('medium');
    expect(padFor(undefined)).toBeUndefined();
  });
});

describe('routeDestination', () => {
  const plotted: PlottedRoute = {
    id: 1,
    plottedAt: '2026-09-26T11:00:00Z',
    systems: [system('A', 0), system('Mid', 50), system('Far', 100)],
  };

  it('takes the plotted route, with its coordinates', () => {
    expect(routeDestination([plotted], undefined)).toEqual({
      source: 'plotted',
      names: ['Far'],
      coords: { x: 100, y: 0, z: 0 },
    });
  });

  it('ignores a route the game has dropped', () => {
    expect(routeDestination([{ ...plotted, clearedAt: '2026-09-26T11:30:00Z' }], undefined)).toBe(
      undefined,
    );
  });

  it("takes the CSV route's end, and the systems before it down to the commander", () => {
    expect(routeDestination([], csv(['A', 'B', 'C', 'D'], 1))).toEqual({
      source: 'csv',
      names: ['D', 'C'],
    });
    expect(routeDestination([], csv(['A', 'B']))).toEqual({ source: 'csv', names: ['B', 'A'] });
  });

  it('prefers the CSV route when the plot only reaches its next system', () => {
    const stretch: PlottedRoute = {
      id: 2,
      plottedAt: '2026-09-26T11:00:00Z',
      systems: [system('B', 10), system('Between', 15), system('C', 20)],
    };
    expect(routeDestination([stretch], csv(['A', 'B', 'C', 'D'], 1))?.names[0]).toBe('D');
    expect(routeDestination([plotted], csv(['A', 'B', 'C', 'D'], 1))?.names[0]).toBe('Far');
  });
});

describe('sellStopFilters', () => {
  const options = { services: ['Repair'], pad: 'large' as const, carrierMaxAgeDays: 60, now: NOW };
  const types = ['Coriolis Starport', 'Drake-Class Carrier', 'Outpost'];

  it('asks for carriers open to all and reported lately', () => {
    expect(sellStopFilters('carriers', types, options)).toEqual([
      { field: 'services', parts: [{ field: 'name', values: ['Vista Genomics'] }] },
      { field: 'services', parts: [{ field: 'name', values: ['Repair'] }] },
      { field: 'type', values: ['Drake-Class Carrier'] },
      { field: 'carrier_docking_access', values: ['All'] },
      { field: 'updated_at', min: '2026-07-28T12:00:00.000Z', max: '2026-09-26T12:00:00.000Z' },
    ]);
  });

  it('asks for any other station, with a large pad for a large ship', () => {
    const filters = sellStopFilters('stations', types, options);
    expect(filters.slice(2)).toEqual([
      { field: 'type', values: ['Coriolis Starport', 'Outpost'] },
      { field: 'has_large_pad', is: true },
    ]);
  });

  it("builds into Spansh's shapes", () => {
    const fields = [
      { field: 'services', type: 'combined', subfields: { name: { type: 'group' } } },
      { field: 'type', type: 'group' },
      { field: 'carrier_docking_access', type: 'group' },
      { field: 'updated_at', type: 'timestamp' },
      { field: 'has_large_pad', type: 'boolean' },
    ];
    expect(buildFilters(sellStopFilters('carriers', types, options), fields)).toMatchObject({
      services: [{ name: { value: ['Vista Genomics'] } }, { name: { value: ['Repair'] } }],
      carrier_docking_access: { value: ['All'] },
      updated_at: { comparison: '<=>' },
    });
  });
});

/** A station row as Spansh returns it, cut down, on the x axis. */
function row(name: string, x: number, extra: Record<string, unknown> = {}) {
  return {
    name,
    type: 'Coriolis Starport',
    system_name: `${name} system`,
    distance: Math.abs(x),
    system_x: x,
    system_y: 0,
    system_z: 0,
    large_pads: 4,
    medium_pads: 4,
    ...extra,
  };
}

describe('readSellStops', () => {
  const here = { x: 0, y: 0, z: 0 };
  const destination = { x: 1000, y: 0, z: 0 };

  it('drops stops no nearer the destination, but never one in this system', () => {
    const result = {
      results: [row('Here', 0.1), row('Behind', -40), row('Ahead', 60), row('Overshot', 2000)],
    };
    const read = readSellStops(result, here, destination, undefined);
    expect(read.stops.map((stop) => nameOf(stop.row))).toEqual(['Here', 'Ahead']);
    expect(read.stops[1]?.toDestinationLy).toBe(940);
    expect(read.behind).toBe(2);
  });

  it('keeps everything without a route', () => {
    const read = readSellStops({ results: [row('Behind', -40)] }, here, undefined, undefined);
    expect(read.stops).toHaveLength(1);
    expect(read.behind).toBe(0);
  });

  it('checks the pad and the carrier access', () => {
    const result = {
      results: [
        row('Small only', 10, { large_pads: 0, medium_pads: 0, small_pads: 2 }),
        row('Medium', 20, { large_pads: 0 }),
        row('Private', 30, { type: 'Drake-Class Carrier', carrier_docking_access: 'Friends' }),
        row('Open', 40, { type: 'Drake-Class Carrier', carrier_docking_access: 'All' }),
      ],
    };
    const names = (pad: 'small' | 'medium' | 'large') =>
      readSellStops(result, here, destination, pad).stops.map((stop) => nameOf(stop.row));
    expect(names('small')).toEqual(['Small only', 'Medium', 'Open']);
    expect(names('medium')).toEqual(['Medium', 'Open']);
    expect(names('large')).toEqual(['Open']);
  });

  it('skips rows it cannot place', () => {
    expect(readSellStops({ results: [{ name: 'x' }] }, here, destination, undefined).stops).toEqual(
      [],
    );
    expect(readSellStops({ error: 'x' }, here, destination, undefined).stops).toEqual([]);
  });
});

function nameOf(record: unknown): unknown {
  return typeof record === 'object' && record !== null ? Reflect.get(record, 'name') : undefined;
}
