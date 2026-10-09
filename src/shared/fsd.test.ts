import { describe, expect, it } from 'vitest';

import { driveFor, shipBuild, superchargeMultiplier } from './fsd';
import type { LoadoutEvent } from './journal';

type Module = LoadoutEvent['Modules'][number];

function module(slot: string, item: string, extra: Partial<Module> = {}): Module {
  return { Slot: slot, Item: item, On: true, Priority: 0, Health: 1, ...extra };
}

/** An engineered Mandalay with an SCO Mk II and a 5 Guardian booster, as its journal wrote it. */
const MANDALAY: LoadoutEvent = {
  timestamp: '2026-09-14T17:01:56Z',
  event: 'Loadout',
  Ship: 'explorer_nx',
  ShipID: 12,
  ShipName: '',
  ShipIdent: 'PR-10E',
  HullHealth: 0.96,
  UnladenMass: 1367.699951,
  CargoCapacity: 16,
  MaxJumpRange: 81.927956,
  FuelCapacity: { Main: 128, Reserve: 1.14 },
  Rebuy: 1,
  Modules: [
    module('FrameShiftDrive', 'int_hyperdrive_overcharge_size8_class5_overchargebooster_mkii', {
      Engineering: {
        EngineerID: 300100,
        BlueprintID: 128673694,
        BlueprintName: 'FSD_LongRange',
        Level: 5,
        Quality: 1,
        Modifiers: [
          { Label: 'Mass', Value: 208, OriginalValue: 160 },
          { Label: 'FSDOptimalMass', Value: 7528.039551, OriginalValue: 4670 },
        ],
      },
    }),
    module('Slot04_Size5', 'int_guardianfsdbooster_size5'),
  ],
};

describe('driveFor', () => {
  it('knows standard and SCO drives by their journal names', () => {
    expect(driveFor('int_hyperdrive_size5_class5')).toEqual({
      optimalMass: 1050,
      maxFuel: 5,
      fuelMultiplier: 0.012,
      fuelPower: 2.45,
    });
    expect(driveFor('Int_Hyperdrive_Overcharge_Size7_Class5')?.optimalMass).toBe(3000);
    expect(driveFor('int_hyperdrive_size9_class5')).toBeUndefined();
  });
});

describe('shipBuild', () => {
  it('gives the figures Spansh accepted for this ship', () => {
    const build = shipBuild(MANDALAY);
    expect(build).toMatchObject({
      fuel_power: 2.5025,
      fuel_multiplier: 0.011,
      optimal_mass: 7528.039551,
      max_fuel_per_jump: 6.8,
      base_mass: 1367.699951 + 1.14,
      tank_size: 128,
      internal_tank_size: 1.14,
      range_boost: 10.5,
      supercharge_multiplier: 6,
    });
    expect(JSON.parse((build as { ship_build: string }).ship_build)).toEqual([
      { header: { appName: 'EDSSI', appVersion: '1' }, data: MANDALAY },
    ]);
  });

  it("says why when the drive isn't one it knows", () => {
    const odd = {
      ...MANDALAY,
      Modules: [module('FrameShiftDrive', 'int_hyperdrive_size9_class9')],
    };
    expect(shipBuild(odd)).toMatch(/doesn't know/);
    expect(shipBuild({ ...MANDALAY, Modules: [] })).toMatch(/no frame shift drive/);
  });
});

describe('superchargeMultiplier', () => {
  it('is 6 for the SCO Mk II and 4 for anything else', () => {
    expect(superchargeMultiplier(MANDALAY)).toBe(6);
    expect(
      superchargeMultiplier({
        ...MANDALAY,
        Modules: [module('FrameShiftDrive', 'int_hyperdrive_size5_class5')],
      }),
    ).toBe(4);
    expect(superchargeMultiplier(undefined)).toBe(4);
  });
});
