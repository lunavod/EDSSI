import type { LoadoutEvent } from '../../shared/journal';

/** A Cobra's `Loadout` with these modules, for tests. */
export function loadout(
  modules: { Slot: string; Item: string; Engineering?: object; On?: boolean; Health?: number }[],
  extra: Partial<LoadoutEvent> = {},
): LoadoutEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the fields read are given
  return {
    timestamp: '2026-09-28T18:53:08Z',
    event: 'Loadout',
    Ship: 'cobra',
    ShipID: 7,
    ShipName: 'Roadrunner',
    ShipIdent: 'RR-01',
    HullHealth: 1,
    UnladenMass: 300,
    CargoCapacity: 16,
    MaxJumpRange: 30,
    FuelCapacity: { Main: 16, Reserve: 0.5 },
    Rebuy: 1000,
    Modules: modules.map((module) => ({ On: true, Priority: 1, Health: 1, ...module })),
    ...extra,
  } as LoadoutEvent;
}
