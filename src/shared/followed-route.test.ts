import { describe, expect, it } from 'vitest';

import { type CsvRouteState, parseCsvRoute } from './csv-route';
import { followedRoute, plottedAlongCsv, routeForAssistant } from './followed-route';
import type { PlottedRoute, RouteSystem } from './nav-routes';

const system = (name: string, address: number, x: number, starClass = 'K'): RouteSystem => ({
  StarSystem: name,
  SystemAddress: address,
  StarPos: [x, 0, 0],
  StarClass: starClass,
});

const plotted: PlottedRoute = {
  id: 1,
  plottedAt: '2026-09-24T10:00:00Z',
  systems: [system('Sol', 1, 0), system('Alpha', 2, 5, 'N'), system('Beta', 3, 12)],
};

const galaxyCsv = parseCsvRoute(
  [
    'System Name,Distance,Distance Remaining,Neutron Star',
    'Sol,0,30,No',
    'Alpha,10,20,Yes',
    'Beta,12,8,No',
    'Gamma,8,0,No',
  ].join('\n'),
  'route.csv',
  '2026-09-24T09:00:00Z',
);

const at = (position: number | undefined, here = true, route = galaxyCsv): CsvRouteState => ({
  route,
  position,
  here,
});

describe('followedRoute', () => {
  it('follows the plotted route while there is one, CSV route or not', () => {
    const elsewhere = parseCsvRoute('System Name\nSol\nDelta\nEpsilon', 'r.csv', '');
    expect(followedRoute([plotted], at(0, true, elsewhere), 2)?.source).toBe('plotted');
    const followed = followedRoute([plotted], undefined, 2);
    expect(followed).toMatchObject({ source: 'plotted', position: 1, lyLeft: 7 });
    expect(followed?.systems?.map((s) => [s.name, s.starClass, s.legLy])).toEqual([
      ['Sol', 'K', undefined],
      ['Alpha', 'N', 5],
      ['Beta', 'K', 7],
    ]);
  });

  it('falls back to the CSV route when nothing is plotted and the commander is on it', () => {
    const followed = followedRoute([{ ...plotted, clearedAt: '2026-09-24T11:00:00Z' }], at(1), 99);
    expect(followed).toMatchObject({ source: 'csv', position: 1, lyLeft: 20 });
    expect(followed?.systems?.map((s) => [s.name, s.legLy])).toEqual([
      ['Sol', undefined],
      ['Alpha', 10],
      ['Beta', 12],
      ['Gamma', 8],
    ]);
  });

  it('ignores the CSV route away from it, or before reaching it', () => {
    expect(followedRoute([], at(1, false), 99)).toBeUndefined();
    expect(followedRoute([], at(undefined, false), 99)).toBeUndefined();
    expect(followedRoute([], undefined, 99)).toBeUndefined();
  });

  it('adds up jump lengths when the file has no distance remaining', () => {
    const csv = parseCsvRoute('System Name,Distance\nA,0\nB,4\nC,6', 'r.csv', '');
    expect(followedRoute([], at(0, true, csv), 1)?.lyLeft).toBe(10);
  });

  it('leaves distances unknown when the file has none', () => {
    const csv = parseCsvRoute(
      'System Name,Body Name,Distance To Arrival\nA,A 1,50\nB,B 2,900',
      'r',
      '',
    );
    const followed = followedRoute([], at(0, true, csv), 1);
    expect(followed?.lyLeft).toBeUndefined();
    expect(followed?.systems?.[1]?.legLy).toBeUndefined();
  });

  it("takes a CSV route's stars from its Star column, or a lookup, and Refuel's yes", () => {
    const csv = parseCsvRoute('System Name,Refuel\nA,No\nB,Yes\nC,No\nD,No', 'r.csv', '');
    const located = {
      ...csv,
      systems: csv.systems.map((s, index) => (index === 3 ? { ...s, starClass: 'N' } : s)),
    };
    const followed = followedRoute([], at(0, true, located), 1);
    expect(followed?.systems?.map((s) => [s.name, s.starClass, s.scoopable])).toEqual([
      ['A', undefined, undefined],
      ['B', undefined, true],
      ['C', undefined, undefined],
      ['D', 'N', undefined],
    ]);
    const named = parseCsvRoute('System Name,Star\nA,K\nB,DA', 'r.csv', '');
    const stars = followedRoute([], at(0, true, named), 1)?.systems?.map((s) => s.starClass);
    expect(stars).toEqual(['K', 'DA']);
  });

  it('shows the CSV route while the plot is a stretch of it', () => {
    const followed = followedRoute([plotted], at(0), 1);
    expect(followed).toMatchObject({ source: 'csv', position: 0, lyLeft: 30 });
    expect(followed?.systems).toHaveLength(4);
  });
});

describe('routeForAssistant', () => {
  it('is the followed route while there is one', () => {
    expect(routeForAssistant([], at(1), 99)).toMatchObject({
      source: 'csv',
      position: 1,
      onRoute: true,
    });
  });

  it('keeps a CSV route the commander has left, from the last of its systems reached', () => {
    expect(routeForAssistant([], at(1, false), 99)).toMatchObject({
      source: 'csv',
      position: 1,
      lyLeft: 20,
      onRoute: false,
    });
  });

  it('starts before a CSV route none of whose systems has been reached', () => {
    const route = routeForAssistant([], at(undefined, false), 99);
    expect(route).toMatchObject({ source: 'csv', position: -1, onRoute: false });
    expect(route?.lyLeft).toBeUndefined();
  });

  it('has nothing without a plotted or CSV route', () => {
    expect(routeForAssistant([], undefined, 99)).toBeUndefined();
  });
});

describe('plottedAlongCsv', () => {
  const route = (...names: string[]): PlottedRoute => ({
    id: 2,
    plottedAt: '2026-09-24T10:00:00Z',
    systems: names.map((name, index) => system(name, index + 10, index)),
  });

  it('takes a plot from one CSV system to a later one, through systems of its own', () => {
    expect(plottedAlongCsv(route('Sol', 'Alpha'), at(0))).toBe(0);
    expect(plottedAlongCsv(route('alpha', 'Nowhere', 'Gamma'), at(1))).toBe(1);
  });

  it('takes a plot from off the route to a CSV system past the last one reached', () => {
    expect(plottedAlongCsv(route('Nowhere', 'Beta'), at(1, false))).toBe(1);
  });

  it('keeps the last CSV system reached along the plot', () => {
    expect(plottedAlongCsv(route('Sol', 'Alpha', 'Beta'), at(1))).toBe(1);
  });

  it('rejects plots that end off the route, go backwards, or start nowhere known', () => {
    expect(plottedAlongCsv(route('Sol', 'Nowhere'), at(0))).toBeUndefined();
    expect(plottedAlongCsv(route('Beta', 'Alpha'), at(2))).toBeUndefined();
    expect(plottedAlongCsv(route('Nowhere', 'Beta'), at(undefined, false))).toBeUndefined();
    expect(plottedAlongCsv({ ...route('Sol', 'Beta'), systems: undefined }, at(0))).toBeUndefined();
    expect(plottedAlongCsv(route('Sol', 'Beta'), undefined)).toBeUndefined();
  });
});
