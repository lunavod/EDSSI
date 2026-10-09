/**
 * The situation the commander is in, folded out of the session's events: who they are, what they
 * fly, and where they are. Both the HUD and the assistant work from it.
 */

import { creditsDelta } from './credits';
import type { JournalEvent, LoadoutEvent } from './journal';
import { type Drive, driveOf } from './jump-fuel';

export interface Overview {
  commander?: string;
  ship?: string;
  shipName?: string;
  /** The ship's registration, e.g. `PR-10E`. */
  shipIdent?: string;
  /** Main tank size in tonnes, from the last Loadout. */
  fuelCapacity?: number;
  /** Jump range in light years, as the last Loadout gave it. */
  maxJumpRange?: number;
  /** The cargo racks' total in tonnes. */
  cargoCapacity?: number;
  /** The frame shift drive's figures, from the last Loadout; unset for a drive EDSSI doesn't know. */
  drive?: Drive;
  system?: string;
  systemAddress?: number | bigint;
  /** As the last Location or jump into the current system reported it. */
  systemDetails?: SystemDetails;
  /** Class of the arrival star, if the journal said: the jump's countdown or the arrival scan. */
  starClass?: string;
  /** Station or carrier the ship is docked at, if any. */
  station?: string;
  /** What docking said about that station; only while docked. */
  stationDetails?: StationDetails;
  /** Credit balance as of the last LoadGame; Status.json carries the live one. */
  credits?: number;
  /** Where the hyperspace countdown in progress is headed, until the jump completes. */
  charging?: { system: string; starClass?: string };
  /** The commander's own carrier's jump, from its request until it's made or cancelled. */
  carrierJump?: CarrierJumpScheduled;
}

export interface CarrierJumpScheduled {
  carrierId: string;
  system?: string;
  /** When the carrier leaves, in ms since the epoch. */
  departs: number;
}

export interface SystemDetails {
  allegiance?: string;
  economy?: string;
  government?: string;
  security?: string;
  population?: number;
}

export interface StationDetails {
  /** As the journal names it: `Coriolis`, `FleetCarrier`, `CraterOutpost`… */
  type?: string;
  /** Its `MarketID`; a carrier's is its `CarrierID`. */
  marketId?: string;
  /** The largest pad it has, when the docking said. */
  largestPad?: 'S' | 'M' | 'L';
  /** The journal's service names: `commodities`, `shipyard`, `outfitting`… */
  services?: string[];
}

function largestPad(
  pads: { Small: number; Medium: number; Large: number } | undefined,
): StationDetails['largestPad'] {
  if (!pads) return undefined;
  return pads.Large > 0 ? 'L' : pads.Medium > 0 ? 'M' : pads.Small > 0 ? 'S' : undefined;
}

type SystemArrival = Extract<JournalEvent, { event: 'Location' | 'FSDJump' | 'CarrierJump' }>;

function arrival(overview: Overview, event: SystemArrival): Overview {
  const sameSystem = String(event.SystemAddress) === String(overview.systemAddress);
  return {
    ...overview,
    system: event.StarSystem,
    systemAddress: event.SystemAddress,
    systemDetails: {
      allegiance: event.SystemAllegiance || undefined,
      economy: event.SystemEconomy_Localised ?? event.SystemEconomy,
      government: event.SystemGovernment_Localised ?? event.SystemGovernment,
      security: event.SystemSecurity_Localised ?? event.SystemSecurity,
      population: event.Population,
    },
    starClass: sameSystem ? overview.starClass : undefined,
    charging: undefined,
  };
}

export function updateOverview(overviewBefore: Overview, event: JournalEvent): Overview {
  // Most of a session runs with no live Balance in Status.json (the game only writes it on
  // foot), so this is what keeps the credits shown in step with sales and purchases.
  const delta = creditsDelta(event);
  const overview =
    delta !== 0 && overviewBefore.credits !== undefined
      ? { ...overviewBefore, credits: overviewBefore.credits + delta }
      : overviewBefore;
  switch (event.event) {
    case 'Commander':
      return { ...overview, commander: event.Name };
    case 'LoadGame':
      return {
        ...overview,
        commander: event.Commander,
        ship: event.Ship_Localised ?? event.Ship,
        shipName: event.ShipName,
        shipIdent: event.ShipIdent,
        fuelCapacity: event.FuelCapacity ?? overview.fuelCapacity,
        credits: event.Credits,
      };
    case 'Loadout':
      return {
        ...overview,
        shipName: event.ShipName,
        shipIdent: event.ShipIdent,
        fuelCapacity: event.FuelCapacity.Main,
        maxJumpRange: event.MaxJumpRange,
        cargoCapacity: event.CargoCapacity,
        drive: driveOf(event),
      };
    case 'ShipyardSwap':
      return { ...overview, ship: event.ShipType_Localised ?? event.ShipType };
    case 'Location':
    case 'CarrierJump':
      return {
        ...arrival(overview, event),
        station: event.Docked ? event.StationName : undefined,
        stationDetails: event.Docked
          ? {
              type: event.StationType,
              marketId: idOf(event.MarketID),
              services: event.StationServices,
            }
          : undefined,
        carrierJump:
          event.event === 'CarrierJump' && overview.carrierJump?.carrierId === idOf(event.MarketID)
            ? undefined
            : overview.carrierJump,
      };
    case 'StartJump':
      return event.JumpType === 'Hyperspace' && event.StarSystem
        ? { ...overview, charging: { system: event.StarSystem, starClass: event.StarClass } }
        : overview;
    case 'FSDJump':
      return {
        ...arrival(overview, event),
        starClass:
          overview.charging?.system === event.StarSystem ? overview.charging.starClass : undefined,
        station: undefined,
        stationDetails: undefined,
      };
    case 'Scan':
      // The arrival star, when the session began in the system rather than jumping in.
      return event.DistanceFromArrivalLS === 0 &&
        event.StarType !== undefined &&
        String(event.SystemAddress) === String(overview.systemAddress)
        ? { ...overview, starClass: overview.starClass ?? event.StarType }
        : overview;
    case 'Docked':
      return {
        ...overview,
        system: event.StarSystem ?? overview.system,
        station: event.StationName,
        stationDetails: {
          type: event.StationType,
          marketId: idOf(event.MarketID),
          largestPad: largestPad(event.LandingPads),
          services: event.StationServices,
        },
      };
    case 'Undocked':
      return { ...overview, station: undefined, stationDetails: undefined };
    case 'CarrierJumpRequest': {
      // Older journals don't say when it leaves.
      const departs =
        typeof event.DepartureTime === 'string' ? Date.parse(event.DepartureTime) : NaN;
      return {
        ...overview,
        carrierJump: Number.isFinite(departs)
          ? { carrierId: String(event.CarrierID), system: event.SystemName, departs }
          : undefined,
      };
    }
    case 'CarrierJumpCancelled':
      return overview.carrierJump?.carrierId === String(event.CarrierID)
        ? { ...overview, carrierJump: undefined }
        : overview;
    default:
      return overview;
  }
}

/** The jump of the carrier the ship is docked on, if one is scheduled. */
export function dockedCarrierJump(overview: Overview): CarrierJumpScheduled | undefined {
  const jump = overview.carrierJump;
  const docked = overview.stationDetails?.marketId;
  return jump && docked !== undefined && jump.carrierId === docked ? jump : undefined;
}

/**
 * The ship being flown, as the events last described it: its last `Loadout`, and the tonnes in
 * its hold from the last `Cargo` of the ship (not the SRV's).
 */
export function currentShip(
  events: readonly JournalEvent[],
): { loadout: LoadoutEvent; cargo: number } | undefined {
  const loadout = events.findLast((event): event is LoadoutEvent => event.event === 'Loadout');
  if (!loadout) return undefined;
  const cargo = events.findLast((event) => event.event === 'Cargo' && event.Vessel === 'Ship');
  const count = cargo?.event === 'Cargo' ? cargo.Count : undefined;
  return { loadout, cargo: typeof count === 'number' ? count : 0 };
}

function idOf(value: unknown): string | undefined {
  return typeof value === 'number' || typeof value === 'bigint' ? String(value) : undefined;
}
