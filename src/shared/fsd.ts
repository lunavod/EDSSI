/**
 * What Spansh's galaxy plotter needs to know about a ship's frame shift drive, worked out from the
 * journal's `Loadout` the way the site does for a loadout pasted from the game.
 *
 * Base drive figures are from coriolis-data (as bundled by Spansh). Two of its SCO rows are
 * misprinted there (a size 6 A with 2 t optimal mass, a size 7 A with 3 t); they are corrected here
 * from the game's own values. Engineering replaces optimal mass and maximum fuel per jump, and the
 * journal gives the engineered figures directly, so blueprints need no table.
 */

import type { LoadoutEvent } from './journal';

interface Drive {
  optimalMass: number;
  maxFuel: number;
  fuelMultiplier: number;
  fuelPower: number;
  /** How much a neutron or white dwarf boost multiplies range; 4 unless the drive says. */
  supercharge?: number;
}

/** Optimal mass, max fuel per jump, fuel multiplier and power, by size and class (1 = E … 5 = A). */
const STANDARD: Record<number, [number, number, number, number][]> = {
  2: [
    [48, 0.6, 0.011, 2],
    [54, 0.6, 0.01, 2],
    [60, 0.6, 0.008, 2],
    [75, 0.8, 0.01, 2],
    [90, 0.9, 0.012, 2],
  ],
  3: [
    [80, 1.2, 0.011, 2.15],
    [90, 1.2, 0.01, 2.15],
    [100, 1.2, 0.008, 2.15],
    [125, 1.5, 0.01, 2.15],
    [150, 1.8, 0.012, 2.15],
  ],
  4: [
    [280, 2, 0.011, 2.3],
    [315, 2, 0.01, 2.3],
    [350, 2, 0.008, 2.3],
    [437.5, 2.5, 0.01, 2.3],
    [525, 3, 0.012, 2.3],
  ],
  5: [
    [560, 3.3, 0.011, 2.45],
    [630, 3.3, 0.01, 2.45],
    [700, 3.3, 0.008, 2.45],
    [875, 4.1, 0.01, 2.45],
    [1050, 5, 0.012, 2.45],
  ],
  6: [
    [960, 5.3, 0.011, 2.6],
    [1080, 5.3, 0.01, 2.6],
    [1200, 5.3, 0.008, 2.6],
    [1500, 6.6, 0.01, 2.6],
    [1800, 8, 0.012, 2.6],
  ],
  7: [
    [1440, 8.5, 0.011, 2.75],
    [1620, 8.5, 0.01, 2.75],
    [1800, 8.5, 0.008, 2.75],
    [2250, 10.6, 0.01, 2.75],
    [2700, 12.8, 0.012, 2.75],
  ],
};

/** The supercruise overcharge (SCO) drives. */
const OVERCHARGE: Record<number, [number, number, number, number][]> = {
  2: [
    [60, 0.6, 0.008, 2],
    [90, 0.9, 0.012, 2],
    [90, 0.9, 0.012, 2],
    [90, 0.9, 0.012, 2],
    [100, 1, 0.013, 2],
  ],
  3: [
    [100, 1.2, 0.008, 2.15],
    [150, 1.8, 0.012, 2.15],
    [150, 1.8, 0.012, 2.15],
    [150, 1.8, 0.012, 2.15],
    [167, 1.9, 0.013, 2.15],
  ],
  4: [
    [350, 2, 0.008, 2.3],
    [525, 3, 0.012, 2.3],
    [525, 3, 0.012, 2.3],
    [525, 3, 0.012, 2.3],
    [585, 3.2, 0.013, 2.3],
  ],
  5: [
    [700, 3.3, 0.008, 2.45],
    [1050, 5, 0.012, 2.45],
    [1050, 5, 0.012, 2.45],
    [1050, 5, 0.012, 2.45],
    [1175, 5.2, 0.013, 2.45],
  ],
  6: [
    [1200, 5.3, 0.008, 2.6],
    [1800, 8, 0.012, 2.6],
    [1800, 8, 0.012, 2.6],
    [1800, 8, 0.012, 2.6],
    [2000, 8.3, 0.013, 2.6],
  ],
  7: [
    [1800, 8.5, 0.008, 2.75],
    [2700, 12.8, 0.012, 2.75],
    [2700, 12.8, 0.012, 2.75],
    [2700, 12.8, 0.012, 2.75],
    [3000, 13.1, 0.013, 2.75],
  ],
  8: [
    [2800, 13.6, 0.008, 2.9],
    [4200, 20.4, 0.012, 2.9],
    [4200, 20.4, 0.012, 2.9],
    [4200, 20.4, 0.012, 2.9],
    [4670, 20.7, 0.013, 2.9],
  ],
};

const MK_II: Drive = {
  optimalMass: 4670,
  maxFuel: 6.8,
  fuelMultiplier: 0.011,
  fuelPower: 2.5025,
  supercharge: 6,
};

/** Light years a Guardian FSD booster adds, by size. */
const GUARDIAN_BOOST: Record<number, number> = { 1: 4, 2: 6, 3: 7.75, 4: 9.25, 5: 10.5 };

/** The base figures of a drive, from its journal item name, e.g. `int_hyperdrive_size5_class5`. */
export function driveFor(item: string): Drive | undefined {
  const name = item.toLowerCase();
  if (name === 'int_hyperdrive_overcharge_size8_class5_overchargebooster_mkii') return MK_II;
  const match = /^int_hyperdrive_(overcharge_)?size(\d)_class(\d)$/.exec(name);
  if (!match) return undefined;
  const row = (match[1] ? OVERCHARGE : STANDARD)[Number(match[2])]?.[Number(match[3]) - 1];
  if (!row) return undefined;
  const [optimalMass, maxFuel, fuelMultiplier, fuelPower] = row;
  return { optimalMass, maxFuel, fuelMultiplier, fuelPower };
}

export interface ShipBuild {
  fuel_power: number;
  fuel_multiplier: number;
  optimal_mass: number;
  base_mass: number;
  tank_size: number;
  internal_tank_size: number;
  max_fuel_per_jump: number;
  range_boost: number;
  supercharge_multiplier: number;
  /** The loadout as Spansh's SLEF import reads it. */
  ship_build: string;
}

/** The plotter's ship figures, or why they can't be worked out. */
export function shipBuild(loadout: LoadoutEvent): ShipBuild | string {
  const fsd = loadout.Modules.find((module) => module.Slot.toLowerCase() === 'frameshiftdrive');
  if (!fsd) return 'The ship has no frame shift drive fitted.';
  const drive = driveFor(fsd.Item);
  if (!drive) return `EDSSI doesn't know the figures of the drive ${fsd.Item}.`;

  let optimalMass = drive.optimalMass;
  let maxFuel = drive.maxFuel;
  for (const modifier of fsd.Engineering?.Modifiers ?? []) {
    if (typeof modifier.Value !== 'number') continue;
    const label = modifier.Label.toLowerCase();
    if (label === 'fsdoptimalmass') optimalMass = modifier.Value;
    if (label === 'maxfuelperjump') maxFuel = modifier.Value;
  }

  const booster = loadout.Modules.find((module) =>
    module.Item.toLowerCase().startsWith('int_guardianfsdbooster'),
  );
  const boosterSize = booster && Number(/size(\d)/i.exec(booster.Item)?.[1]);
  const reserve = loadout.FuelCapacity.Reserve;

  return {
    fuel_power: drive.fuelPower,
    fuel_multiplier: drive.fuelMultiplier,
    optimal_mass: optimalMass,
    base_mass: loadout.UnladenMass + reserve,
    tank_size: loadout.FuelCapacity.Main,
    internal_tank_size: reserve,
    max_fuel_per_jump: maxFuel,
    range_boost: boosterSize ? (GUARDIAN_BOOST[boosterSize] ?? 0) : 0,
    supercharge_multiplier: drive.supercharge ?? 4,
    ship_build: JSON.stringify([{ header: { appName: 'EDSSI', appVersion: '1' }, data: loadout }]),
  };
}

/** How much a neutron star multiplies this ship's range: 6 for the SCO Mk II, 4 otherwise. */
export function superchargeMultiplier(loadout: LoadoutEvent | undefined): number {
  const fsd = loadout?.Modules.find((module) => module.Slot.toLowerCase() === 'frameshiftdrive');
  return (fsd && driveFor(fsd.Item)?.supercharge) ?? 4;
}
