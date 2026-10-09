import { describe, expect, it } from 'vitest';

import {
  activeRoute,
  isScoopableClass,
  nextJump,
  type PlottedRoute,
  positionOf,
  routeLengthLy,
  routeProgress,
  type RouteEdsmCheck,
  type RouteSystem,
  unknownToEdsm,
  upsertRoute,
} from './nav-routes';

function system(name: string, address: number, x: number): RouteSystem {
  return { StarSystem: name, SystemAddress: address, StarPos: [x, 0, 0], StarClass: 'K' };
}

const a = system('A', 1, 0);
const b = system('B', 2, 3);
const c = system('C', 3, 7);
const d = system('D', 4, 12);

const route: PlottedRoute = {
  id: 1,
  plottedAt: '2026-09-10T10:00:00Z',
  clearedAt: '2026-09-10T10:05:00Z',
  systems: [a, b, c],
};

describe('routeProgress', () => {
  it('places a jump on the route being followed', () => {
    expect(routeProgress([route], '2026-09-10T10:01:00Z', 2)).toEqual({ route, position: 1 });
    expect(routeProgress([route], '2026-09-10T10:01:00Z', 4)).toEqual({
      route,
      position: undefined,
    });
  });

  it('has no route before the first plot', () => {
    expect(routeProgress([route], '2026-09-10T09:59:59Z', 2)).toBeUndefined();
  });

  it('counts the arrival that follows the clear during the final jump', () => {
    // The game clears the route ~12 s before the FSDJump into the destination.
    expect(routeProgress([route], '2026-09-10T10:05:12Z', 3)).toEqual({ route, position: 2 });
    expect(routeProgress([route], '2026-09-10T10:05:12Z', 2)).toBeUndefined();
    expect(routeProgress([route], '2026-09-10T10:30:00Z', 3)).toBeUndefined();
  });

  it('follows the newest route plotted by then', () => {
    const next: PlottedRoute = { id: 2, plottedAt: '2026-09-10T10:02:00Z', systems: [b, d] };
    expect(routeProgress([route, next], '2026-09-10T10:03:00Z', 4)).toEqual({
      route: next,
      position: 1,
    });
  });

  it('matches addresses whether they are numbers or bigints', () => {
    expect(routeProgress([route], '2026-09-10T10:01:00Z', 3n)?.position).toBe(2);
  });

  it('keeps a route whose systems are unknown', () => {
    const unknown: PlottedRoute = { id: 3, plottedAt: '2026-09-10T10:00:00Z' };
    expect(routeProgress([unknown], '2026-09-10T10:01:00Z', 2)).toEqual({
      route: unknown,
      position: undefined,
    });
  });
});

describe('routeLengthLy', () => {
  it('adds up the legs', () => {
    expect(routeLengthLy([a, b, c, d])).toBe(12);
    expect(routeLengthLy([a, b, c, d], 1)).toBe(9);
    expect(routeLengthLy([a, b, c, d], 1, 2)).toBe(4);
  });
});

describe('upsertRoute', () => {
  it('keeps routes oldest first', () => {
    const later: PlottedRoute = { id: 2, plottedAt: '2026-09-10T11:00:00Z' };
    const earlier: PlottedRoute = { id: 3, plottedAt: '2026-09-10T09:00:00Z' };
    expect(upsertRoute(upsertRoute([later], earlier), route).map(({ id }) => id)).toEqual([
      3, 1, 2,
    ]);
  });

  it("doesn't let an older copy of a route undo what's known since", () => {
    const stale: PlottedRoute = { id: 1, plottedAt: route.plottedAt };
    expect(upsertRoute([route], stale)).toEqual([route]);
  });

  it("keeps EDSM's answer over a copy from while it was still being asked", () => {
    const checked: PlottedRoute = { ...route, edsm: { status: 'checked', unknown: ['2'] } };
    expect(upsertRoute([checked], { ...route, edsm: { status: 'checking' } })).toEqual([checked]);
    expect(upsertRoute([checked], route)).toEqual([checked]);
    const failed: PlottedRoute = { ...route, edsm: { status: 'failed' } };
    expect(upsertRoute([checked], failed)).toEqual([failed]);
  });
});

describe('unknownToEdsm', () => {
  it('counts the given systems EDSM has never heard of', () => {
    const check: RouteEdsmCheck = { status: 'checked', unknown: ['2', '3'] };
    expect(unknownToEdsm(check, [a, b, c])).toBe(2);
    expect(unknownToEdsm(check, [c])).toBe(1);
    expect(unknownToEdsm(check, [a])).toBe(0);
    expect(
      unknownToEdsm({ status: 'checked', unknown: ['9007199254740993'] }, [
        { ...a, SystemAddress: 9007199254740993n },
      ]),
    ).toBe(1);
  });

  it('knows nothing until EDSM has answered', () => {
    expect(unknownToEdsm(undefined, [a])).toBeUndefined();
    expect(unknownToEdsm({ status: 'checking' }, [a])).toBeUndefined();
    expect(unknownToEdsm({ status: 'failed' }, [a])).toBeUndefined();
  });
});

describe('following the active route', () => {
  const open: PlottedRoute = { id: 2, plottedAt: '2026-09-10T11:00:00Z', systems: [a, b, c] };

  it('follows the latest route until the game clears it', () => {
    expect(activeRoute([route, open])).toBe(open);
    expect(activeRoute([open, { ...route, id: 3, plottedAt: '2026-09-10T12:00:00Z' }])).toBe(
      undefined,
    );
    expect(activeRoute([])).toBeUndefined();
  });

  it('finds the next jump from where the commander is', () => {
    expect(positionOf(open, 2)).toBe(1);
    expect(positionOf(open, 99)).toBeUndefined();
    expect(nextJump(open, 1)).toEqual({ system: b, jump: 1, jumps: 2 });
    expect(nextJump(open, 2n)).toEqual({ system: c, jump: 2, jumps: 2 });
    expect(nextJump(open, 3)).toBeUndefined(); // Arrived.
    expect(nextJump(open, 99)).toBeUndefined(); // Off route.
    expect(nextJump(undefined, 1)).toBeUndefined();
  });
});

describe('isScoopableClass', () => {
  it.each([
    ['K', true],
    ['M_RedGiant', true],
    ['A_BlueWhiteSuperGiant', true],
    ['DA', false],
    ['N', false],
    ['TTS', false],
    ['L', false],
  ])('%s → %s', (starClass, expected) => {
    expect(isScoopableClass(starClass)).toBe(expected);
  });
});
