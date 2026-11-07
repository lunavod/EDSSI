import { describe, expect, it } from 'vitest';

import type { FittedModule, ShipView } from '../../../shared/ships';
import { healthPercent, hullPercent, withCondition } from './ships';

const module = (item: string, health: number): FittedModule => ({
  item,
  name: item,
  on: true,
  priority: 0,
  health,
});

const SHIP: ShipView = {
  shipId: 14,
  ship: 'lakonminer',
  type: 'Type-11 Prospector',
  current: true,
  layout: 'edsy',
  slots: [
    { slot: 'PowerDistributor', group: 'core', size: 5, module: module('int_pd', 1) },
    { slot: 'Radar', group: 'core', size: 3, module: module('int_sensors', 0.99) },
    { slot: 'Slot05_Size4', group: 'internal', size: 4 },
  ],
  stats: {
    maxJumpRange: 20,
    cargoCapacity: 128,
    fuelMain: 32,
    fuelReserve: 0.8,
    unladenMass: 400,
    rebuy: 1e6,
    hullHealth: 1,
  },
};

describe('withCondition', () => {
  it('leaves the ship as it is without one', () => {
    expect(withCondition(SHIP, undefined)).toBe(SHIP);
  });

  it('puts the health it knows in place of the loadout’s, slot names in any case', () => {
    const ship = withCondition(SHIP, {
      modules: { powerdistributor: 0.82, Slot05_Size4: 0.5, Nowhere: 0.1 },
      hull: 0.73,
      source: 'test',
    });
    expect(ship.slots.map((slot) => slot.module?.health)).toEqual([0.82, 0.99, undefined]);
    expect(ship.slots[0]?.module?.item).toBe('int_pd');
    expect(ship.stats?.hullHealth).toBe(0.73);
    // The loaded ship is not changed.
    expect(SHIP.slots[0]?.module?.health).toBe(1);
    expect(SHIP.stats?.hullHealth).toBe(1);
  });

  it('keeps the loadout’s hull when it has none, and ignores values that are not numbers', () => {
    const ship = withCondition(SHIP, { modules: { Radar: Number.NaN }, source: 'test' });
    expect(ship.slots[1]?.module?.health).toBe(0.99);
    expect(ship.stats?.hullHealth).toBe(1);
  });
});

describe('healthPercent', () => {
  it('rounds down, as the game shows a module', () => {
    expect(healthPercent(0.979_166)).toBe(97);
    expect(healthPercent(0.989_344)).toBe(98);
    expect(healthPercent(0.994_999)).toBe(99);
    expect(healthPercent(1)).toBe(100);
  });

  it('keeps whole percents whole despite floating point', () => {
    expect(healthPercent(0.29)).toBe(29);
    expect(healthPercent(0.57)).toBe(57);
    expect(healthPercent(0)).toBe(0);
    expect(healthPercent(-0.1)).toBe(0);
  });
});

describe('hullPercent', () => {
  it('rounds, as the game shows the hull', () => {
    expect(hullPercent(0.797_172)).toBe(80);
    expect(hullPercent(0.794)).toBe(79);
    expect(hullPercent(1)).toBe(100);
    expect(hullPercent(0)).toBe(0);
  });
});
