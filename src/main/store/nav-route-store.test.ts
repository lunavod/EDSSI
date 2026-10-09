import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RouteSystem } from '../../shared/nav-routes';
import { openDatabase } from './database';
import { NavRouteStore } from './nav-route-store';

const sol: RouteSystem = {
  StarSystem: 'Sol',
  SystemAddress: 10477373803,
  StarPos: [0, 0, 0],
  StarClass: 'G',
};
const alpha: RouteSystem = {
  StarSystem: 'Alpha Centauri',
  SystemAddress: 1458376315610,
  StarPos: [3.03125, -0.09375, 3.15625],
  StarClass: 'G',
};
const barnard: RouteSystem = {
  StarSystem: "Barnard's Star",
  SystemAddress: 10477373802,
  StarPos: [-3.03125, 1.375, 4.9375],
  StarClass: 'M',
};

describe('NavRouteStore', () => {
  let db: DatabaseSync;
  let store: NavRouteStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new NavRouteStore(db);
  });

  afterEach(() => db.close());

  it('records a plotted route, then its systems from NavRoute.json', () => {
    const plotted = store.recordRoute('2026-09-10T10:00:00Z');
    expect(plotted).toEqual({ id: expect.any(Number), plottedAt: '2026-09-10T10:00:00Z' });

    const filled = store.recordRoute('2026-09-10T10:00:00Z', [sol, alpha, barnard]);
    expect(filled).toEqual({ ...plotted, systems: [sol, alpha, barnard] });

    // Seen again on the next start: nothing new.
    expect(store.recordRoute('2026-09-10T10:00:00Z', [sol, alpha, barnard])).toBeUndefined();
    expect(store.recordRoute('2026-09-10T10:00:00Z')).toBeUndefined();
    expect(store.routesSince(undefined)).toEqual([filled]);
  });

  it('accepts the systems before the journal line', () => {
    const route = store.recordRoute('2026-09-10T10:00:00Z', [sol, alpha]);
    expect(route?.systems).toEqual([sol, alpha]);
    expect(store.recordRoute('2026-09-10T10:00:00Z')).toBeUndefined();
  });

  it('clears the latest route plotted by then, once', () => {
    expect(store.recordCleared('2026-09-10T09:00:00Z')).toBeUndefined(); // Nothing plotted yet.
    store.recordRoute('2026-09-10T10:00:00Z', [sol, alpha]);
    const second = store.recordRoute('2026-09-10T11:00:00Z', [alpha, barnard]);

    expect(store.recordCleared('2026-09-10T11:05:00Z')).toEqual({
      ...second,
      clearedAt: '2026-09-10T11:05:00Z',
    });
    // The journal line and NavRoute.json both report the same clear.
    expect(store.recordCleared('2026-09-10T11:05:00Z')).toBeUndefined();
    expect(store.routesSince(undefined)[0]?.clearedAt).toBe('2026-09-10T11:05:00Z');
  });

  it('leaves a route plotted at the moment of a clear that must come after it', () => {
    store.recordRoute('2026-09-10T10:00:00Z', [sol, alpha]);
    const second = store.recordRoute('2026-09-10T11:00:00Z', [alpha, barnard]);
    expect(store.recordCleared('2026-09-10T11:00:00Z', { plottedBefore: true })).toMatchObject({
      plottedAt: '2026-09-10T10:00:00Z',
      clearedAt: '2026-09-10T11:00:00Z',
    });
    expect(store.routesSince(undefined)).toEqual([second]);
  });

  it('lists the route in effect at a time and every route plotted after it', () => {
    store.recordRoute('2026-09-10T10:00:00Z');
    store.recordRoute('2026-09-10T11:00:00Z');
    store.recordRoute('2026-09-10T12:00:00Z');

    const plottedAt = (since: string | undefined) =>
      store.routesSince(since).map((route) => route.plottedAt);
    expect(plottedAt('2026-09-10T11:30:00Z')).toEqual([
      '2026-09-10T11:00:00Z',
      '2026-09-10T12:00:00Z',
    ]);
    expect(plottedAt('2026-09-10T11:00:00Z')).toEqual([
      '2026-09-10T11:00:00Z',
      '2026-09-10T12:00:00Z',
    ]);
    expect(plottedAt('2026-09-10T09:00:00Z')).toEqual([
      '2026-09-10T10:00:00Z',
      '2026-09-10T11:00:00Z',
      '2026-09-10T12:00:00Z',
    ]);
    expect(plottedAt(undefined)).toEqual(['2026-09-10T12:00:00Z']);
  });

  it('keeps 64-bit system addresses intact', () => {
    const far: RouteSystem = { ...barnard, SystemAddress: 2n ** 60n + 1n };
    const route = store.recordRoute('2026-09-10T10:00:00Z', [sol, far]);
    expect(route?.systems?.map((system) => system.SystemAddress)).toEqual([
      10477373803,
      2n ** 60n + 1n,
    ]);
  });

  it('keeps nothing of a route with a malformed system', () => {
    const broken = { StarSystem: 'Nowhere', SystemAddress: 1 } as RouteSystem;
    expect(() => store.recordRoute('2026-09-10T10:00:00Z', [sol, broken])).toThrow();
    expect(store.routesSince(undefined)).toEqual([]);
  });
});
