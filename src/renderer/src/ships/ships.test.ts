import { describe, expect, it } from 'vitest';

import type { FittedModule, ShipView } from '../../../shared/ships';
import { withCondition } from './ships';

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
