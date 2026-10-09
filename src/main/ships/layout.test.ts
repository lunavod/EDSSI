import { describe, expect, it } from 'vitest';

import type { ShipCatalog } from '../../shared/ships';
import { describeRestriction, itemName, shipSlots, stockFit } from './layout';
import { loadout } from './loadout-fixture';

const catalog: ShipCatalog = {
  version: 1,
  ships: {
    cobra: {
      name: 'Cobra Mk III',
      slots: [
        { name: 'LargeHardpoint1', group: 'hardpoint', size: 3 },
        { name: 'MediumHardpoint1', group: 'hardpoint', size: 2 },
        { name: 'TinyHardpoint1', group: 'utility', size: 0 },
        { name: 'Armour', group: 'core', size: 1 },
        { name: 'FrameShiftDrive', group: 'core', size: 5 },
        { name: 'Cargo01', group: 'internal', size: 6, only: ['Cargo Racks', 'Fuel Tanks'] },
        { name: 'Slot01_Size4', group: 'internal', size: 4 },
      ],
      stock: {
        MediumHardpoint1: 'hpt_pulselaser_fixed_small',
        Armour: 'cobra_armour_grade1',
        FrameShiftDrive: 'int_hyperdrive_size5_class5',
      },
      hullCost: 200_000,
      retail: 349_720,
    },
  },
  modules: {
    hpt_multicannon_gimbal_large: { name: 'Multi-cannon', size: 3, rating: 'C', mount: 'G' },
    int_hyperdrive_size5_class5: { name: 'Frame Shift Drive', size: 5, rating: 'A' },
    cobra_armour_grade1: { name: 'Lightweight Alloy', size: 1, rating: 'I', kind: 'Bulkheads' },
    hpt_pulselaser_fixed_small: {
      name: 'Pulse Laser',
      size: 1,
      rating: 'F',
      mount: 'F',
      cost: 2200,
    },
  },
  blueprints: { fsd_longrange: 'Increased Range' },
};

describe('shipSlots', () => {
  it("lays the loadout into EDSY's slots, keeping the empty ones", () => {
    const { layout, slots } = shipSlots(
      'Cobra',
      loadout([
        { Slot: 'LargeHardpoint1', Item: 'hpt_multicannon_gimbal_large' },
        { Slot: 'Armour', Item: 'cobra_armour_grade1' },
        {
          Slot: 'FrameShiftDrive',
          Item: 'Int_Hyperdrive_Size5_Class5',
          Engineering: {
            EngineerID: 1,
            BlueprintID: 2,
            BlueprintName: 'FSD_LongRange',
            Level: 5,
            Quality: 0.8,
            Modifiers: [],
            Engineer: 'Felicity Farseer',
            ExperimentalEffect_Localised: 'Mass Manager',
          },
        },
        { Slot: 'PaintJob', Item: 'paintjob_cobra_red' },
        { Slot: 'VesselVoice', Item: 'voicepack_celeste' },
      ]),
      new Map(),
      catalog,
    );
    expect(layout).toBe('edsy');
    expect(slots.map((slot) => [slot.slot, slot.module?.name ?? null])).toEqual([
      ['LargeHardpoint1', 'Multi-cannon'],
      ['MediumHardpoint1', null],
      ['TinyHardpoint1', null],
      ['Armour', 'Lightweight Alloy'],
      ['FrameShiftDrive', 'Frame Shift Drive'],
      ['Cargo01', null],
      ['Slot01_Size4', null],
    ]);
    expect(slots[0]?.module).toMatchObject({ grade: '3C', mount: 'Gimballed' });
    expect(slots[3]?.module?.grade).toBeUndefined();
    expect(slots[4]?.module?.engineering).toEqual({
      blueprint: 'Increased Range',
      level: 5,
      quality: 0.8,
      engineer: 'Felicity Farseer',
      experimental: 'Mass Manager',
    });
    expect(slots[5]?.only).toBe('Cargo racks or fuel tanks');
  });

  it('marks a module fitted where EDSY lists no slot, and still shows it', () => {
    const { slots } = shipSlots(
      'cobra',
      loadout([{ Slot: 'SmallHardpoint3', Item: 'hpt_beamlaser_fixed_small' }]),
      new Map(),
      catalog,
    );
    const unlisted = slots.find((slot) => slot.unlisted);
    expect(unlisted).toMatchObject({ slot: 'SmallHardpoint3', group: 'hardpoint', size: 1 });
    expect(unlisted?.module?.name).toBe('Beamlaser Fixed Small');
    // Grouped with the other hardpoints, after them.
    expect(slots.findIndex((slot) => slot.unlisted)).toBe(2);
  });

  it('falls back to the slots seen filled on the ship for a hull EDSY lacks', () => {
    const { layout, slots } = shipSlots(
      'brandnewship',
      loadout([
        { Slot: 'MediumHardpoint1', Item: 'hpt_pulselaser_fixed_medium' },
        { Slot: 'FuelTank', Item: 'int_fueltank_size5_class3' },
      ]),
      new Map([
        ['largehardpoint1', { slot: 'LargeHardpoint1', item: 'hpt_railgun_fixed_large' }],
        ['slot02_size3', { slot: 'Slot02_Size3', item: 'int_cargorack_size3_class1' }],
        ['tinyhardpoint2', { slot: 'TinyHardpoint2', item: 'hpt_heatsinklauncher_turret_tiny' }],
        ['frameshiftdrive', { slot: 'FrameShiftDrive', item: 'int_hyperdrive_size5_class5' }],
      ]),
      undefined,
    );
    expect(layout).toBe('journal');
    expect(slots.map((slot) => [slot.slot, slot.group, slot.size, Boolean(slot.module)])).toEqual([
      ['LargeHardpoint1', 'hardpoint', 3, false],
      ['MediumHardpoint1', 'hardpoint', 2, true],
      ['TinyHardpoint2', 'utility', 0, false],
      ['FrameShiftDrive', 'core', 5, false],
      ['FuelTank', 'core', 5, true],
      ['Slot02_Size3', 'internal', 3, false],
    ]);
  });
});

describe('describeRestriction', () => {
  it('says what a restricted slot takes, briefly', () => {
    expect(describeRestriction(['Cargo Racks', 'Fuel Tanks'])).toBe('Cargo racks or fuel tanks');
    expect(describeRestriction(['Collection Limpets', 'Repair Limpets'])).toBe(
      'Limpet controllers',
    );
    expect(describeRestriction(['Vessel Hangars'])).toBe('Vessel hangars');
    expect(describeRestriction(['FSD Boosters', 'Exp - Anti-Xeno Missile Racks'])).toBe(
      'FSD boosters or anti-xeno missile racks',
    );
    expect(
      describeRestriction(['Passenger Cabins', 'Vessel Hangars', 'Refineries', 'Fuel Scoops']),
    ).toBe('Passenger cabins, vessel hangars and 2 more');
  });
});

describe('itemName', () => {
  it("makes a readable name of a journal item EDSY doesn't know", () => {
    expect(itemName('int_shieldgenerator_size7_class2_fast')).toBe('Shieldgenerator Fast');
  });
});

describe('stock', () => {
  it('marks what is still as the shipyard sold it, and not once engineered', () => {
    const { slots } = shipSlots(
      'cobra',
      loadout([
        { Slot: 'MediumHardpoint1', Item: 'Hpt_PulseLaser_Fixed_Small' },
        { Slot: 'Armour', Item: 'cobra_armour_grade1' },
        {
          Slot: 'FrameShiftDrive',
          Item: 'int_hyperdrive_size5_class5',
          Engineering: { BlueprintName: 'FSD_LongRange', Level: 1, Quality: 0, Modifiers: [] },
        },
        { Slot: 'LargeHardpoint1', Item: 'hpt_multicannon_gimbal_large' },
      ]),
      new Map(),
      catalog,
    );
    const stock = Object.fromEntries(slots.map((slot) => [slot.slot, slot.stock === true]));
    expect(stock).toMatchObject({
      MediumHardpoint1: true,
      Armour: true,
      FrameShiftDrive: false,
      LargeHardpoint1: false,
    });
  });

  it('fits a hull as the shipyard sells it', () => {
    const fit = stockFit('Cobra', catalog);
    expect(fit).toMatchObject({
      ship: 'cobra',
      type: 'Cobra Mk III',
      prices: { hull: 200_000, retail: 349_720 },
    });
    expect(fit?.slots.map((slot) => [slot.slot, slot.module?.name ?? null])).toEqual([
      ['LargeHardpoint1', null],
      ['MediumHardpoint1', 'Pulse Laser'],
      ['TinyHardpoint1', null],
      ['Armour', 'Lightweight Alloy'],
      ['FrameShiftDrive', 'Frame Shift Drive'],
      ['Cargo01', null],
      ['Slot01_Size4', null],
    ]);
    expect(fit?.slots[1]).toMatchObject({
      stock: true,
      module: { grade: '1F', mount: 'Fixed', value: 2200, health: 1, on: true },
    });
    expect(stockFit('brandnewship', catalog)).toBeUndefined();
    expect(stockFit('cobra', undefined)).toBeUndefined();
  });
});
