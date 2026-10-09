import { describe, expect, it } from 'vitest';

import type { CsvRoute } from '../../../shared/csv-route';
import { bounds, gridStep, mapRoute, segments, toScene } from './route-map';

const route: CsvRoute = {
  fileName: 'r.csv',
  loadedAt: '2026-09-26T00:00:00.000Z',
  columns: [],
  systems: [
    { name: 'A', values: [], coords: [0, 0, 0] },
    { name: 'B', values: [], coords: [10, 0, 10] },
    { name: 'C', values: [] },
    { name: 'D', values: [], coords: [30, 5, 30] },
  ],
};

describe('mapRoute', () => {
  it('draws the stops, flown up to the position, z turned round', () => {
    const { stops, estimated, unplaced } = mapRoute(route, 1);
    expect([estimated, unplaced]).toEqual([1, 0]);
    expect(stops.map((stop) => [stop.name, stop.index, stop.past])).toEqual([
      ['A', 0, true],
      ['B', 1, true],
      ['C', 2, false],
      ['D', 3, false],
    ]);
    expect(stops[1]?.at).toEqual([10, 0, -10]);
  });

  it('puts a stop with no place between its neighbours, by the distance left when known', () => {
    expect(mapRoute(route, 1).stops[2]?.at).toEqual([20, 2.5, -20]);
    const measured: CsvRoute = {
      ...route,
      columns: ['Distance Remaining'],
      systems: route.systems.map((system, index) => ({
        ...system,
        values: [String([100, 80, 75, 60][index])],
      })),
    };
    expect(mapRoute(measured, 1).stops[2]?.at).toEqual([15, 1.25, -15]);
  });

  it('leaves out a stop with no placed stop on one side', () => {
    const open: CsvRoute = { ...route, systems: [...route.systems, { name: 'E', values: [] }] };
    expect(mapRoute(open, undefined).unplaced).toBe(1);
  });

  it('has flown nothing before the route is reached', () => {
    expect(mapRoute(route, undefined).stops.some((stop) => stop.past)).toBe(false);
  });
});

describe('segments', () => {
  it('colours a leg by the stop it ends at', () => {
    const legs = segments(mapRoute(route, 1).stops);
    expect(legs.map((leg) => [leg.to, leg.past])).toEqual([
      [[10, 0, -10], true],
      [[20, 2.5, -20], false],
      [[30, 5, -30], false],
    ]);
  });
});

describe('bounds', () => {
  it('finds the middle and the reach, never too small to look at', () => {
    expect(bounds([toScene([0, 0, 10]), toScene([100, 0, 10])])).toEqual({
      center: [50, 0, -10],
      radius: 50,
    });
    expect(bounds([[1, 2, 3]])?.radius).toBe(20);
    expect(bounds([])).toBeUndefined();
  });
});

describe('gridStep', () => {
  it('rounds to 1, 2 or 5 of a power of ten', () => {
    expect(gridStep(1000)).toBe(100);
    expect(gridStep(1500)).toBe(200);
    expect(gridStep(40_000)).toBe(5000);
  });
});
