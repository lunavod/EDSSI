import { describe, expect, it } from 'vitest';

import { catalogFromEddb, catalogFromEdsySource } from './edsy';

/** A hull in EDSY's shape. */
function hull(fdname: string, extra: Record<string, unknown> = {}) {
  return {
    fdname,
    name: fdname,
    slots: {
      hardpoint: [3, 2, 2, 1],
      utility: [0, 0],
      component: [1, 5, 5, 5, 3, 4, 3, 4],
      military: [],
      internal: [6, 5, 1],
    },
    ...extra,
  };
}

/** Enough hulls to pass for EDSY's database. */
function database(ships: Record<string, unknown>) {
  const filler: Record<string, unknown> = {};
  for (let index = 0; index < 30; index++) filler[1000 + index] = hull(`Filler${index}`);
  return {
    version: 424019902,
    edsy_lastmodified_db: 20260923,
    ship: { ...filler, ...ships },
    mtype: {
      icr: { name: 'Cargo Racks' },
      cft: { name: 'Fuel Tanks' },
      hmc: { name: 'Multi-Cannons' },
    },
    blueprint: { fsd_lr: { name: 'Increased Range', fdname: 'FSD_LongRange' } },
    module: {
      1: {
        mtype: 'icr',
        name: 'Cargo Rack',
        class: 6,
        rating: 'E',
        fdname: 'Int_CargoRack_Size6_Class1',
        cost: 362_591,
      },
      2: {
        mtype: 'hmc',
        name: 'Multi-cannon',
        class: 3,
        rating: 'C',
        mount: 'G',
        fdname: 'Hpt_MultiCannon_Gimbal_Large',
      },
    },
  };
}

describe('catalogFromEddb', () => {
  it("names each slot as EDSY's journal export does", () => {
    const catalog = catalogFromEddb(database({ 1: hull('Cobra') }));
    expect(catalog.ships['cobra']?.slots.map((slot) => [slot.name, slot.group, slot.size])).toEqual(
      [
        ['LargeHardpoint1', 'hardpoint', 3],
        ['MediumHardpoint1', 'hardpoint', 2],
        ['MediumHardpoint2', 'hardpoint', 2],
        ['SmallHardpoint1', 'hardpoint', 1],
        ['TinyHardpoint1', 'utility', 0],
        ['TinyHardpoint2', 'utility', 0],
        ['Armour', 'core', 1],
        ['PowerPlant', 'core', 5],
        ['MainEngines', 'core', 5],
        ['FrameShiftDrive', 'core', 5],
        ['LifeSupport', 'core', 3],
        ['PowerDistributor', 'core', 4],
        ['Radar', 'core', 3],
        ['FuelTank', 'core', 4],
        ['Slot01_Size6', 'internal', 6],
        ['Slot02_Size5', 'internal', 5],
        ['Slot03_Size1', 'internal', 1],
      ],
    );
  });

  it("takes a hull's own slot names where Frontier's numbering breaks the pattern", () => {
    const catalog = catalogFromEddb(
      database({
        1: hull('Panther', {
          slotnames: { internal: ['Cargo01', 'Slot01_Size5', 'Slot02_Size1'] },
          reserved: { internal: [{ icr: 1, cft: 1 }] },
        }),
      }),
    );
    const internal = catalog.ships['panther']?.slots.filter((slot) => slot.group === 'internal');
    expect(internal).toEqual([
      { name: 'Cargo01', group: 'internal', size: 6, only: ['Cargo Racks', 'Fuel Tanks'] },
      { name: 'Slot01_Size5', group: 'internal', size: 5 },
      { name: 'Slot02_Size1', group: 'internal', size: 1 },
    ]);
  });

  it('keeps modules, blueprints and bulkheads by their journal names', () => {
    const catalog = catalogFromEddb(
      database({
        1: hull('Cobra', { module: { 40131: { fdname: 'Cobra_Armour_Grade3', mass: 10 } } }),
      }),
    );
    expect(catalog.modules['hpt_multicannon_gimbal_large']).toEqual({
      name: 'Multi-cannon',
      size: 3,
      rating: 'C',
      mount: 'G',
      kind: 'Multi-Cannons',
    });
    expect(catalog.modules['cobra_armour_grade3']?.name).toBe('Military Grade Composite');
    expect(catalog.blueprints['fsd_longrange']).toBe('Increased Range');
    expect(catalog.modules['int_cargorack_size6_class1']?.cost).toBe(362_591);
    expect(catalog.modified).toBe('2026-09-23');
  });

  it('refuses a database that no longer looks like one', () => {
    expect(() => catalogFromEddb({ ship: { 1: hull('Cobra') }, module: {} })).toThrow(/only 1/);
    expect(() => catalogFromEddb([])).toThrow();
  });
});

describe('stock fits', () => {
  it("reads each hull's stock modules into its slots by name, and its prices", () => {
    const catalog = catalogFromEddb(
      database({
        1: hull('Cobra', {
          cost: 200_000,
          retail: 349_720,
          stock: {
            hardpoint: [0, 0, 0, 2],
            utility: [0, 0],
            component: [40131, 0, 0, 0, 0, 0, 0, 0],
            military: [],
            internal: [1, 0, 999],
          },
          module: { 40131: { fdname: 'Cobra_Armour_Grade1_Default', cost: 0 } },
        }),
      }),
    );
    expect(catalog.ships['cobra']).toMatchObject({
      hullCost: 200_000,
      retail: 349_720,
      stock: {
        SmallHardpoint1: 'hpt_multicannon_gimbal_large',
        Armour: 'cobra_armour_grade1_default',
        Slot01_Size6: 'int_cargorack_size6_class1',
      },
    });
    expect(catalog.modules['cobra_armour_grade1_default']?.name).toBe('Lightweight Alloy');
    // An id EDSY doesn't list is left out rather than guessed at.
    expect(Object.keys(catalog.ships['cobra']?.stock ?? {})).toHaveLength(3);
  });
});

describe('catalogFromEdsySource', () => {
  it('reads the database out of the script', () => {
    const source = `'use strict';\nvar eddb = ${JSON.stringify(database({}))};\n`;
    expect(Object.keys(catalogFromEdsySource(source).ships)).toHaveLength(30);
  });
});
