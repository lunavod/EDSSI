/**
 * The frame shift drive's fuel use, and what it comes to over the stretch of a route with no star
 * to scoop from. The formulas are the game's, as the community's route plotters use them; the
 * drive's figures come from the journal's `Loadout` through `shipBuild`, as they do for Spansh's
 * plotter.
 */

import type { FollowedRoute, FollowedSystem } from './followed-route';
import { type ShipBuild, shipBuild } from './fsd';
import type { LoadoutEvent } from './journal';
import { isScoopableClass } from './nav-routes';

/** How much a white dwarf multiplies range. */
const WHITE_DWARF_BOOST = 1.5;

export type Drive = Pick<
  ShipBuild,
  | 'fuel_power'
  | 'fuel_multiplier'
  | 'optimal_mass'
  | 'base_mass'
  | 'max_fuel_per_jump'
  | 'range_boost'
  | 'supercharge_multiplier'
>;

/** The drive's figures from a Loadout; undefined for one EDSSI doesn't know. */
export function driveOf(loadout: LoadoutEvent): Drive | undefined {
  try {
    const build = shipBuild(loadout);
    if (typeof build === 'string') return undefined;
    return {
      fuel_power: build.fuel_power,
      fuel_multiplier: build.fuel_multiplier,
      optimal_mass: build.optimal_mass,
      base_mass: build.base_mass,
      max_fuel_per_jump: build.max_fuel_per_jump,
      range_boost: build.range_boost,
      supercharge_multiplier: build.supercharge_multiplier,
    };
  } catch {
    // The Loadout's shape isn't checked at runtime.
    return undefined;
  }
}

/** The ship with `fuel` in the main tank and `cargo` in the hold, in t. */
function mass(drive: Drive, fuel: number, cargo: number): number {
  return drive.base_mass + cargo + Math.max(0, fuel);
}

/** The Guardian booster, applied as a raised power. */
function effectivePower(drive: Drive, shipMass: number): number {
  if (drive.range_boost === 0) return drive.fuel_power;
  const ratio = drive.max_fuel_per_jump / drive.fuel_multiplier;
  const base = (drive.optimal_mass / shipMass) * ratio ** (1 / drive.fuel_power);
  return Math.log(ratio) / Math.log(((base + drive.range_boost) * shipMass) / drive.optimal_mass);
}

/** The longest jump on `fuel` t. */
export function jumpRange(drive: Drive, fuel: number, cargo: number, multiplier = 1): number {
  const usable = Math.min(fuel, drive.max_fuel_per_jump);
  if (usable <= 0) return 0;
  const shipMass = mass(drive, fuel, cargo);
  const power = effectivePower(drive, shipMass);
  return (
    ((multiplier * drive.optimal_mass) / shipMass) * (usable / drive.fuel_multiplier) ** (1 / power)
  );
}

/** Fuel a jump of `distance` ly uses starting on `fuel` t; Infinity past max fuel per jump. */
export function fuelFor(
  drive: Drive,
  distance: number,
  fuel: number,
  cargo: number,
  multiplier = 1,
): number {
  const shipMass = mass(drive, fuel, cargo);
  const power = effectivePower(drive, shipMass);
  const used =
    drive.fuel_multiplier * (((distance / multiplier) * shipMass) / drive.optimal_mass) ** power;
  return used <= drive.max_fuel_per_jump * (1 + 1e-9) ? used : Infinity;
}

/** A fuel scoop works there: the star class says so, or the route does. */
export function scoopable(system: FollowedSystem): boolean {
  return (
    system.scoopable === true ||
    (system.starClass !== undefined && isScoopableClass(system.starClass))
  );
}

/**
 * How far a jump from a star of this class is multiplied: a neutron star supercharges, and a
 * white dwarf does when the jump is too long without it.
 */
function boostFrom(
  drive: Drive,
  starClass: string | undefined,
  leg: number,
  fuel: number,
  cargo: number,
): number {
  if (starClass === 'N') return drive.supercharge_multiplier;
  if (starClass?.startsWith('D') && leg > jumpRange(drive, fuel, cargo)) return WHITE_DWARF_BOOST;
  return 1;
}

export interface Stretch {
  /** The system targeted. */
  target: string;
  /** The first scoopable star after the target; unset when there is none before the end. */
  scoop?: string;
  /** Jumps from here to the scoop (or the end of the route). */
  jumps: number;
  /** Fuel those jumps take, t. */
  needed: number;
  /** Fuel in the tank now, t. */
  fuel: number;
  /** The star here can be scooped, so the tank can be filled before setting off. */
  scoopableHere: boolean;
}

/**
 * The run of unscoopable stars that starts with the system targeted, when the fuel in the tank
 * won't last to the next scoopable star on the route (or its end). Undefined when it will, when
 * the target isn't a system ahead on the route or can be scooped, or when a jump's length isn't
 * known. `targetClass`: the target's star as the game said, over what the route says.
 */
export function shortStretch(
  route: FollowedRoute | undefined,
  target: { name: string; starClass?: string },
  fuel: number,
  cargo: number,
  drive: Drive,
): Stretch | undefined {
  const systems = route?.systems;
  const position = route?.position;
  if (!systems || position === undefined) return undefined;
  const at = systems.findIndex(
    (system, index) => index > position && system.name.toLowerCase() === target.name.toLowerCase(),
  );
  if (at < 0) return undefined;
  const targeted = { ...systems[at]!, ...(target.starClass && { starClass: target.starClass }) };
  if (scoopable(targeted)) return undefined;

  const scoopAt = systems.findIndex((system, index) => index > at && scoopable(system));
  const end = scoopAt < 0 ? systems.length - 1 : scoopAt;
  let left = fuel;
  let needed = 0;
  for (let index = position + 1; index <= end; index++) {
    const leg = systems[index]!.legLy;
    if (leg === undefined) return undefined;
    const from = index - 1 === at ? targeted : systems[index - 1]!;
    const boost = boostFrom(drive, from.starClass, leg, left, cargo);
    // A jump the model says is too long is flown on the most the drive takes.
    const used = Math.min(fuelFor(drive, leg, left, cargo, boost), drive.max_fuel_per_jump);
    needed += used;
    left -= used;
  }
  if (needed <= fuel) return undefined;
  return {
    target: systems[at]!.name,
    ...(scoopAt >= 0 && { scoop: systems[scoopAt]!.name }),
    jumps: end - position,
    needed,
    fuel,
    scoopableHere: scoopable(systems[position]!),
  };
}

export interface RouteFuel {
  /** Fuel the jump to the route's next system takes, t. */
  next: number;
  /** Fuel the rest of the route takes, the next jump included, t; unset when a leg is unknown. */
  route?: number;
  /** Systems left on the route. */
  legs: number;
}

/**
 * Fuel one leg of a route takes starting on `fuel` t. A leg longer than a jump is several, as
 * between the waypoints of a neutron route: one as far as the drive goes, boosted by the star it
 * leaves, and the rest of the way in equal jumps.
 */
function legFuel(
  drive: Drive,
  leg: number,
  fuel: number,
  cargo: number,
  starClass: string | undefined,
): number {
  const boost = boostFrom(drive, starClass, leg, fuel, cargo);
  const single = fuelFor(drive, leg, fuel, cargo, boost);
  if (single !== Infinity) return single;
  const range = jumpRange(drive, fuel, cargo);
  if (range <= 0) return drive.max_fuel_per_jump;
  const rest = leg - range * boost;
  const jumps = Math.max(1, Math.ceil(rest / range));
  const each = Math.min(fuelFor(drive, rest / jumps, fuel, cargo), drive.max_fuel_per_jump);
  return drive.max_fuel_per_jump + jumps * each;
}

/**
 * What the next jump of the route and the whole of what is left of it take, from `fuel` t in the
 * tank. Undefined off the route, at its end, or when the next jump's length isn't known. Over a
 * route longer than the tank lasts, the tank (of `capacity` t) counts as filled whenever it
 * wouldn't cover a leg, since a fuller tank makes each jump dearer.
 */
export function routeFuel(
  route: FollowedRoute | undefined,
  fuel: number,
  cargo: number,
  drive: Drive,
  capacity?: number,
): RouteFuel | undefined {
  const systems = route?.systems;
  const position = route?.position;
  if (!systems || position === undefined || position >= systems.length - 1) return undefined;
  let left = fuel;
  let total: number | undefined = 0;
  let next: number | undefined;
  for (let index = position + 1; index < systems.length; index++) {
    const leg = systems[index]!.legLy;
    if (leg === undefined) {
      if (next === undefined) return undefined;
      total = undefined;
      break;
    }
    const from = systems[index - 1]!.starClass;
    let used = legFuel(drive, leg, left, cargo, from);
    // The first jump is made on what is in the tank, whatever that is.
    if (next !== undefined && used > left && capacity !== undefined && capacity > left) {
      left = capacity;
      used = legFuel(drive, leg, left, cargo, from);
    }
    next ??= used;
    total += used;
    left = Math.max(0, left - used);
  }
  if (next === undefined) return undefined;
  return {
    next,
    ...(total !== undefined && { route: total }),
    legs: systems.length - 1 - position,
  };
}
