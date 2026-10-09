import { describe, expect, it } from 'vitest';

import {
  moduleForItem,
  type OwnedShip,
  planBuild,
  readBuilds,
  shipToCompare,
} from './build-import';

/** Coriolis' own SLEF test fixture (EDCD/coriolis, `slef-single-build.json`), cut down. */
const SLEF = [
  {
    header: { appName: 'Inara', appVersion: '1.0', appURL: 'https://inara.cz/cmdr-fleet/1/1/' },
    data: {
      Ship: 'krait_mkii',
      ShipName: 'pancake hammer',
      Modules: [
        { Slot: 'largehardpoint1', Item: 'hpt_mininglaser_fixed_small', On: true },
        {
          Slot: 'largehardpoint2',
          Item: 'hpt_cannon_gimbal_large',
          Engineering: {
            BlueprintName: 'weapon_overcharged',
            Level: 2,
            ExperimentalEffect: 'special_auto_loader',
          },
        },
        {
          Slot: 'largehardpoint3',
          Item: 'hpt_cannon_gimbal_large',
          Engineering: {
            BlueprintName: 'weapon_overcharged',
            Level: 2,
            ExperimentalEffect: 'special_auto_loader',
          },
        },
        {
          Slot: 'mediumhardpoint1',
          Item: 'hpt_basicmissilerack_fixed_medium',
          Engineering: { BlueprintName: 'weapon_highcapacity', Level: 5 },
        },
        {
          Slot: 'frameshiftdrive',
          Item: 'int_hyperdrive_size5_class5',
          Engineering: { BlueprintName: 'fsd_longrange', Level: 2 },
        },
        {
          Slot: 'armour',
          Item: 'krait_mkii_armour_grade3',
          Engineering: { BlueprintName: 'armour_heavyduty', Level: 5 },
        },
      ],
    },
  },
];

describe('readBuilds', () => {
  it('reads SLEF, as EDSY, Coriolis and Inara export it', () => {
    const [build] = readBuilds(SLEF);
    expect(build).toMatchObject({ ship: 'krait_mkii', name: 'pancake hammer' });
    expect(build?.modules.map((module) => [module.module, module.blueprint, module.grade])).toEqual(
      [
        ['Cannon', 'weapon_overcharged', 2],
        ['Cannon', 'weapon_overcharged', 2],
        ['Missile Rack', 'weapon_highcapacity', 5],
        ['Frame Shift Drive', 'fsd_longrange', 2],
        ['Armour', 'armour_heavyduty', 5],
      ],
    );
  });

  it("reads a journal Loadout and Coriolis' detailed build", () => {
    expect(readBuilds(SLEF[0]!.data)).toHaveLength(1);
    const [build] = readBuilds({
      $schema: 'https://coriolis.io/schemas/ship-loadout/4.json#',
      name: 'Explorer',
      ship: 'Krait Mk II',
      components: {
        standard: {
          bulkheads: 'Lightweight Alloy',
          frameShiftDrive: {
            class: 5,
            rating: 'A',
            blueprint: {
              fdname: 'FSD_LongRange',
              grade: 5,
              special: { edname: 'special_fsd_heavy' },
            },
          },
        },
        hardpoints: [null],
        utility: [
          { group: 'Shield Booster', blueprint: { fdname: 'ShieldBooster_Resistive', grade: 3 } },
        ],
        internal: [{ group: 'Shield Generator' }],
      },
    });
    expect(build).toEqual({
      ship: 'krait_mk_ii',
      name: 'Explorer',
      modules: [
        {
          slot: 'frameShiftDrive',
          module: 'Frame Shift Drive',
          blueprint: 'FSD_LongRange',
          grade: 5,
          experimental: 'special_fsd_heavy',
        },
        {
          slot: 'utility 1',
          module: 'Shield Booster',
          blueprint: 'ShieldBooster_Resistive',
          grade: 3,
        },
      ],
    });
  });

  it('finds nothing in anything else', () => {
    expect(readBuilds({ hello: 1 })).toEqual([]);
    expect(readBuilds('text')).toEqual([]);
  });
});

it('names modules by their journal items', () => {
  expect(moduleForItem('Hpt_PulseLaserBurst_Fixed_Small')).toBe('Burst Laser');
  expect(moduleForItem('hpt_pulselaser_gimbal_medium')).toBe('Pulse Laser');
  expect(moduleForItem('int_hyperdrive_overcharge_size5_class5')).toBe('Frame Shift Drive');
  expect(moduleForItem('anaconda_armour_grade3')).toBe('Armour');
  expect(moduleForItem('int_cargorack_size6_class1')).toBe(undefined);
});

describe('planBuild', () => {
  const [build] = readBuilds(SLEF);

  it('makes one to-do per blueprint and range, counting the modules', () => {
    const plan = planBuild(build!, undefined, 1);
    expect(plan.skipped).toEqual([]);
    expect(
      plan.planned.map(({ todo }) => [
        todo.blueprint,
        todo.from,
        todo.to,
        todo.count,
        todo.experimental,
      ]),
    ).toEqual([
      ['engineering:weapon_overcharged:cannon', 0, 2, 2, 'experimental:special_auto_loader'],
      ['engineering:weapon_highcapacity:missile-rack', 0, 5, undefined, undefined],
      ['engineering:fsd_longrange:frame-shift-drive', 0, 2, undefined, undefined],
      ['engineering:armour_heavyduty:armour', 0, 5, undefined, undefined],
    ]);
    expect(plan.planned[0]?.slots).toEqual(['largehardpoint2', 'largehardpoint3']);
  });

  it("leaves off what the commander's own ship has", () => {
    const owned: OwnedShip = {
      shipId: 3,
      ship: 'krait_mkii',
      name: 'Old Faithful',
      current: false,
      modules: [
        {
          slot: 'LargeHardpoint2',
          item: 'hpt_cannon_gimbal_large',
          blueprint: 'Weapon_Overcharged',
          level: 2,
          experimental: 'special_auto_loader',
        },
        {
          slot: 'MediumHardpoint1',
          item: 'hpt_basicmissilerack_fixed_medium',
          blueprint: 'Weapon_HighCapacity',
          level: 3,
        },
        {
          slot: 'FrameShiftDrive',
          item: 'int_hyperdrive_size5_class5',
          blueprint: 'FSD_Shielded',
          level: 5,
        },
      ],
    };
    expect(shipToCompare(build!, [owned])).toBe(owned);
    const plan = planBuild(build!, owned, 2);
    expect(plan.comparedWith).toBe('Old Faithful (Krait Mkii)');
    const rows = plan.planned.map((row) => [
      row.label,
      row.todo.from,
      row.todo.to,
      row.todo.count ?? 1,
      row.done,
    ]);
    expect(rows).toEqual([
      ['Overcharged Weapon · Cannon', 1, 2, 1, true],
      ['Overcharged Weapon · Cannon', 0, 2, 1, false],
      ['High Capacity Magazine · Missile Rack', 3, 5, 1, false],
      // Another blueprint there: from scratch.
      ['Increased FSD Range · Frame Shift Drive', 0, 2, 1, false],
      ['Heavy Duty Armour · Armour', 0, 5, 1, false],
    ]);
    expect(plan.planned[3]?.fitted).toBe('another blueprint, G5');
  });

  it("reads Coriolis' module-named generic blueprints as EDDiscovery's misc ones", () => {
    const plan = planBuild(
      {
        modules: [
          { module: 'Life Support', blueprint: 'LifeSupport_LightWeight', grade: 5 },
          { module: 'Auto Field-Maintenance Unit', blueprint: 'AFM_Shielded', grade: 1 },
          {
            module: 'Collector Limpet Controller',
            blueprint: 'CollectionLimpet_Reinforced',
            grade: 3,
          },
          { module: 'Wake Scanner', blueprint: 'Scanner_LongRange', grade: 2 },
        ],
      },
      {
        shipId: 1,
        ship: 'anaconda',
        current: true,
        modules: [
          {
            slot: 'LifeSupport',
            item: 'int_lifesupport_size5_class2',
            blueprint: 'Misc_LightWeight',
            level: 3,
          },
        ],
      },
      'max',
    );
    expect(plan.skipped).toEqual([]);
    expect(plan.planned.map(({ todo }) => [todo.blueprint, todo.from, todo.to])).toEqual([
      ['engineering:misc_lightweight:life-support', 3, 5],
      ['engineering:misc_shielded:auto-field-maintenance-unit', 0, 1],
      ['engineering:misc_reinforced:collector-limpet-controller', 0, 3],
      ['engineering:sensor_longrange:wake-scanner', 0, 2],
    ]);
  });

  it('says what it cannot place', () => {
    const plan = planBuild(
      { modules: [{ module: 'Shield Booster', blueprint: 'Nonsense', grade: 1 }] },
      undefined,
      1,
    );
    expect(plan.planned).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
  });
});
