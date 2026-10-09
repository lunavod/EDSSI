import { describe, expect, it } from 'vitest';

import type { FollowedRoute, FollowedSystem } from './followed-route';
import { type Drive, fuelFor, jumpRange, routeFuel, shortStretch } from './jump-fuel';

/** An explorer's Mk II SCO drive with a size 5 Guardian booster, as its journal Loadout says. */
const EXPLORER: Drive = {
  fuel_power: 2.5025,
  fuel_multiplier: 0.011,
  optimal_mass: 7528.039551,
  base_mass: 1368.84,
  max_fuel_per_jump: 6.8,
  range_boost: 10.5,
  supercharge_multiplier: 6,
};

/** A plain drive with round figures. */
const PLAIN: Drive = {
  fuel_power: 2,
  fuel_multiplier: 0.01,
  optimal_mass: 1000,
  base_mass: 400,
  max_fuel_per_jump: 5,
  range_boost: 0,
  supercharge_multiplier: 4,
};

describe('fuelFor', () => {
  it('follows the drive formula', () => {
    // 0.01 × (20 ly × 500 t / 1000 t)² = 1 t
    expect(fuelFor(PLAIN, 20, 100, 0)).toBeCloseTo(1, 9);
    expect(fuelFor(PLAIN, 80, 100, 0, 4)).toBeCloseTo(1, 9);
    expect(fuelFor(PLAIN, 60, 100, 0)).toBe(Infinity);
    expect(jumpRange(PLAIN, 100, 0)).toBeCloseTo(Math.sqrt(500) * 2, 9);
  });

  it('matches jumps the game logged, a little over', () => {
    // Ogainks DB-L b10-61 → NG-X d1-1434: 73.61 ly on 93.25 t used 6.046 t, 12 t of cargo.
    const used = fuelFor(EXPLORER, 73.61, 93.25, 12);
    expect(used).toBeGreaterThan(6.046);
    expect(used).toBeLessThan(6.046 * 1.02);
  });
});

function route(systems: FollowedSystem[], position = 0): FollowedRoute {
  return { source: 'csv', systems, position };
}

const star = (name: string, starClass: string, legLy?: number): FollowedSystem => ({
  name,
  starClass,
  ...(legLy !== undefined && { legLy }),
});

describe('shortStretch', () => {
  // 20 ly jumps: about 0.65 t each on a light tank.
  const systems = [
    star('Here', 'K'),
    star('A', 'DA', 20),
    star('B', 'L', 20),
    star('C', 'G', 20),
    star('D', 'T', 20),
  ];

  it('warns when the tank won’t last to the next scoopable star', () => {
    const stretch = shortStretch(route(systems), { name: 'a' }, 1.5, 0, PLAIN);
    expect(stretch).toMatchObject({
      target: 'A',
      scoop: 'C',
      jumps: 3,
      fuel: 1.5,
      scoopableHere: true,
    });
    expect(stretch?.needed).toBeGreaterThan(1.5);
    expect(shortStretch(route(systems), { name: 'A' }, 2.5, 0, PLAIN)).toBeUndefined();
  });

  it('says nothing for a scoopable target, or one off the route', () => {
    expect(shortStretch(route(systems), { name: 'C' }, 0.1, 0, PLAIN)).toBeUndefined();
    expect(shortStretch(route(systems), { name: 'A', starClass: 'F' }, 0.1, 0, PLAIN)).toBe(
      undefined,
    );
    expect(shortStretch(route(systems), { name: 'Elsewhere' }, 0.1, 0, PLAIN)).toBeUndefined();
    expect(shortStretch(route(systems, 2), { name: 'A' }, 0.1, 0, PLAIN)).toBeUndefined();
  });

  it('runs to the end of the route when nothing on it can be scooped', () => {
    const stretch = shortStretch(route(systems, 3), { name: 'D' }, 0.5, 0, PLAIN);
    expect(stretch).toMatchObject({ target: 'D', jumps: 1, scoopableHere: true });
    expect(stretch?.scoop).toBeUndefined();
  });

  it('supercharges from a neutron star', () => {
    const boosted = [star('Here', 'N'), star('A', 'N', 80), star('B', 'K', 80)];
    // Two jumps of 80 ly, each 20 ly's worth of fuel boosted: about 1.3 t.
    expect(shortStretch(route(boosted), { name: 'A' }, 2.5, 0, PLAIN)).toBeUndefined();
    expect(shortStretch(route(boosted), { name: 'A' }, 1, 0, PLAIN)?.jumps).toBe(2);
  });

  it('gives up when a jump’s length is unknown', () => {
    const unknown = [star('Here', 'K'), star('A', 'DA'), star('B', 'K', 20)];
    expect(shortStretch(route(unknown), { name: 'A' }, 0.1, 0, PLAIN)).toBeUndefined();
  });
});

describe('routeFuel', () => {
  const systems = [star('Here', 'K'), star('A', 'K', 20), star('B', 'K', 20), star('C', 'K', 10)];

  it('adds up the jumps left, each on the tank the one before leaves', () => {
    const burn = routeFuel(route(systems), 100, 0, PLAIN);
    const first = fuelFor(PLAIN, 20, 100, 0);
    const second = fuelFor(PLAIN, 20, 100 - first, 0);
    const third = fuelFor(PLAIN, 10, 100 - first - second, 0);
    expect(burn?.next).toBeCloseTo(1, 9);
    expect(burn?.route).toBeCloseTo(first + second + third, 9);
    expect(burn?.legs).toBe(3);
    expect(routeFuel(route(systems, 2), 100, 0, PLAIN)).toMatchObject({ legs: 1 });
  });

  it('has nothing to say off the route or at its end', () => {
    expect(routeFuel(undefined, 100, 0, PLAIN)).toBeUndefined();
    expect(routeFuel({ source: 'plotted', systems }, 100, 0, PLAIN)).toBeUndefined();
    expect(routeFuel(route(systems, 3), 100, 0, PLAIN)).toBeUndefined();
  });

  it('gives the next jump alone when a later leg is unknown', () => {
    const gap = [star('Here', 'K'), star('A', 'K', 20), star('B', 'K'), star('C', 'K', 10)];
    const burn = routeFuel(route(gap), 100, 0, PLAIN);
    expect(burn?.next).toBeCloseTo(1, 9);
    expect(burn?.route).toBeUndefined();
    expect(routeFuel(route(gap, 1), 100, 0, PLAIN)).toBeUndefined();
  });

  it('fills the tank when it runs dry on the way', () => {
    // About 0.65 t a jump on 1 t; the second needs the tank filled, and a full one costs 1 t.
    const burn = routeFuel(route(systems.slice(0, 3)), 1, 0, PLAIN, 100);
    const first = fuelFor(PLAIN, 20, 1, 0);
    expect(burn?.next).toBeCloseTo(first, 9);
    expect(burn?.route).toBeCloseTo(first + 1, 9);
  });

  it('supercharges from a neutron star', () => {
    const boosted = [star('Here', 'N'), star('A', 'K', 80)];
    expect(routeFuel(route(boosted), 100, 0, PLAIN)?.next).toBeCloseTo(1, 9);
  });

  it('counts a leg longer than a jump as several', () => {
    // 100 t: a 5 t jump is 44.72 ly, so 100 ly is one of those and two of 27.64 ly.
    const range = jumpRange(PLAIN, 100, 0);
    const burn = routeFuel(route([star('Here', 'K'), star('Far', 'K', 100)]), 100, 0, PLAIN);
    expect(burn?.next).toBeCloseTo(5 + 2 * fuelFor(PLAIN, (100 - range) / 2, 100, 0), 9);
  });
});
