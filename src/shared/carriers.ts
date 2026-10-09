/**
 * The commander's carriers, their own and their squadron's: where each is, the jump it has
 * scheduled, its fuel and what it holds.
 */

import type { Coords } from './csv-route';

/** A fleet carrier's room, crew and packs included; a squadron carrier has more. */
export const CARRIER_CAPACITY = 25_000;
/** The furthest a carrier jumps, as `CarrierStats`' `JumpRangeMax` has it. */
export const CARRIER_MAX_JUMP_LY = 500;
/** The most tritium its tank takes. */
export const CARRIER_FUEL_CAPACITY = 1_000;

/**
 * The tritium a jump burns: 5 t, plus the distance times the carrier's whole mass (a fleet
 * carrier's 25,000 t, what its space holds, and its own fuel) over 200,000. Fits every jump of a
 * real fleet carrier's journal to the tonne, from 23 t to 76 t, at 126–494 ly and 2,600–12,800 t
 * used. A squadron carrier is taken to weigh its capacity the same way, which is unchecked.
 */
export function carrierJumpFuel(
  distanceLy: number,
  usedSpace: number,
  fuel: number,
  capacity = CARRIER_CAPACITY,
): number {
  return Math.round(5 + (distanceLy * (capacity + usedSpace + fuel)) / 200_000);
}

/** How many jumps of `rangeLy` the fuel lasts, each lightening the carrier by what it burns. */
export function carrierJumpsLeft(
  fuel: number,
  usedSpace: number,
  rangeLy: number,
  capacity = CARRIER_CAPACITY,
): number {
  let jumps = 0;
  let left = fuel;
  for (;;) {
    const burn = carrierJumpFuel(rangeLy, usedSpace, left, capacity);
    if (burn > left || jumps >= CARRIER_FUEL_CAPACITY) return jumps;
    left -= burn;
    jumps++;
  }
}

/** What a service costs a week, running or suspended, in credits. */
export interface ServiceUpkeep {
  /** As the carrier's services screen names it. */
  name: string;
  active: number;
  suspended: number;
}

/**
 * Each crew role (the journal's `CrewRole`) and its weekly upkeep, from the Elite Dangerous wiki's
 * Drake-Class Carrier page. The core crew (captain, market, tritium depot) are in the base fee.
 * The wiki says a squadron carrier's services cost much the same.
 */
export const CARRIER_SERVICES: Readonly<Record<string, ServiceUpkeep>> = {
  Captain: { name: 'Bridge crew', active: 0, suspended: 0 },
  Commodities: { name: 'Market', active: 0, suspended: 0 },
  CarrierFuel: { name: 'Tritium depot', active: 0, suspended: 0 },
  Refuel: { name: 'Refuel', active: 1_500_000, suspended: 750_000 },
  Repair: { name: 'Repair', active: 1_500_000, suspended: 750_000 },
  Rearm: { name: 'Armoury', active: 1_500_000, suspended: 750_000 },
  VoucherRedemption: { name: 'Redemption office', active: 1_850_000, suspended: 850_000 },
  Shipyard: { name: 'Shipyard', active: 6_500_000, suspended: 1_800_000 },
  Outfitting: { name: 'Outfitting', active: 5_000_000, suspended: 1_500_000 },
  BlackMarket: { name: 'Secure warehouse', active: 2_000_000, suspended: 1_250_000 },
  Exploration: { name: 'Universal Cartographics', active: 1_850_000, suspended: 700_000 },
  Bartender: { name: 'Bar', active: 1_750_000, suspended: 1_250_000 },
  VistaGenomics: { name: 'Vista Genomics', active: 1_500_000, suspended: 700_000 },
  PioneerSupplies: { name: 'Pioneer Supplies', active: 5_000_000, suspended: 1_500_000 },
};

/** The weekly fee before any service, and what each jump adds to the next one, by kind. */
export const CARRIER_BASE_UPKEEP: Readonly<Record<CarrierKind, { base: number; perJump: number }>> =
  {
    own: { base: 5_000_000, perJump: 100_000 },
    squadron: { base: 10_000_000, perJump: 200_000 },
  };

const WEEK_MS = 7 * 24 * 3_600_000;
/** Thursday 1 January 1970, 07:00 UTC: upkeep is taken in every Thursday's server downtime. */
const FIRST_UPKEEP_MS = 7 * 3_600_000;

/** When the first upkeep after `time` (ms) is taken. */
export function nextUpkeepAt(time: number): number {
  return FIRST_UPKEEP_MS + (Math.floor((time - FIRST_UPKEEP_MS) / WEEK_MS) + 1) * WEEK_MS;
}

export interface UpkeepForecastInput {
  /** The balance, as the game last said. */
  balance: number;
  /** When it said, in ms. */
  balanceAt: number;
  /** The base fee plus the services. */
  weekly: number;
  perJump: number;
  /** When each jump went, in ms; only those since the reading's week matter. */
  jumpTimes: readonly number[];
  now: number;
}

export interface UpkeepForecast {
  /** The balance now: the reading, less every upkeep taken since. */
  balance: number;
  /** Upkeep has been taken since the reading, so `balance` is worked out rather than read. */
  estimated: boolean;
  nextChargeAt: number;
  /** The next charge: the weekly fee and this week's jumps so far. */
  nextCharge: number;
  /** How many charges from the next on the balance pays in full, with no more jumps. */
  weeksCovered: number;
  /** The first charge the balance can't pay, when the carrier goes into debt. */
  debtAt: number;
}

/**
 * How long the carrier's balance lasts. Each Thursday takes the weekly fee and the jumps made
 * since the Thursday before; takings from tariffs aren't in the journal, so aren't counted.
 */
export function upkeepForecast(input: UpkeepForecastInput): UpkeepForecast {
  const { weekly, perJump, jumpTimes, now } = input;
  const jumpsIn = (from: number, to: number) =>
    jumpTimes.filter((time) => time > from && time <= to).length;
  let balance = input.balance;
  let charge = nextUpkeepAt(input.balanceAt);
  let estimated = false;
  while (charge <= now) {
    balance -= weekly + perJump * jumpsIn(charge - WEEK_MS, charge);
    charge += WEEK_MS;
    estimated = true;
  }
  const nextCharge = weekly + perJump * jumpsIn(charge - WEEK_MS, now);
  // The base fee is never nothing, so the weeks always run out.
  const weeksCovered =
    balance < nextCharge ? 0 : 1 + Math.floor((balance - nextCharge) / Math.max(weekly, 1));
  return {
    balance,
    estimated,
    nextChargeAt: charge,
    nextCharge,
    weeksCovered,
    debtAt: charge + weeksCovered * WEEK_MS,
  };
}

/** The commander's own carrier, or the squadron's they can see. */
export type CarrierKind = 'own' | 'squadron';

export interface CarrierCargoItem {
  /** The journal's commodity name, lowercase: `tritium`. */
  type: string;
  name: string;
  count: number;
}

/** How its 25,000 t are taken, as of the last `CarrierStats` and the moves since. */
export interface CarrierSpace {
  capacity: number;
  crew: number;
  cargo: number;
  /** Held for buy orders. */
  reserved: number;
  shipPacks: number;
  modulePacks: number;
  free: number;
}

export interface CarrierFuel {
  /** Tonnes of tritium in the tank. */
  level: number;
  /** When the game last said, in `CarrierStats` or a deposit. */
  readAt: string;
  /** Less what the jumps since then burned, worked out rather than read. */
  estimated: boolean;
  /** Jumps since the reading whose burn couldn't be worked out (a system with no position). */
  uncounted: number;
}

export interface CarrierView {
  /** Its `CarrierID`, which is also its `MarketID`, as digits. */
  carrierId: string;
  kind: CarrierKind;
  name?: string;
  callsign?: string;
  system?: string;
  /** The body it's parked at, where a jump request named it. */
  body?: string;
  /** Since when it has been there, if EDSSI saw it arrive. */
  arrivedAt?: string;
  /** Light years from the commander, when both positions are known. */
  distanceLy?: number;
  /** The jump it has scheduled, until it goes. */
  jump?: { system: string; body?: string; departs: string; distanceLy?: number; fuel?: number };
  fuel?: CarrierFuel;
  /** Its jump range now. */
  rangeLy: number;
  /** What a full-range jump burns at its present load and fuel. */
  fullJumpFuel?: number;
  /** How many full-range jumps its fuel lasts. */
  jumpsLeft?: number;
  space?: CarrierSpace;
  /** Most first. Only what the commander's own journal moved in or out of it. */
  cargo: CarrierCargoItem[];
  /**
   * Tonnes the carrier holds that `cargo` doesn't account for: others trading at its market, or
   * moves from before the journals EDSSI has. Negative when the list has more than the carrier.
   */
  unaccounted?: number;
  /** When the carrier's management screen was last opened, which is when these figures are exact. */
  statsAt?: string;
  finance?: {
    balance: number;
    reserve: number;
    available: number;
    /** When the game last said. */
    readAt: string;
  };
  /** What the carrier costs a week and how long its balance lasts, once its services are known. */
  upkeep?: CarrierUpkeep;
  /** `all`, `none`, `friends`, `squadron`, `squadronfriends`. */
  dockingAccess?: string;
  allowNotorious?: boolean;
  /** The services installed beyond the core crew, running or suspended. */
  services: CarrierService[];
  /** When it is to be scrapped, while decommissioning. */
  decommissionAt?: string;
}

export interface CarrierService {
  /** The journal's `CrewRole`: `Refuel`, `VistaGenomics`… */
  role: string;
  name: string;
  state: 'active' | 'suspended';
  /** A week of it in this state, when the role is one EDSSI knows the cost of. */
  weekly?: number;
}

export interface CarrierUpkeep {
  base: number;
  /** The services' share of the weekly fee. */
  services: number;
  /** The base and services, a week. */
  weekly: number;
  perJump: number;
  /** Jumps since the last Thursday, which the next charge adds. */
  jumpsThisWeek: number;
  nextCharge: number;
  nextChargeAt: string;
  /** The balance now, less the upkeep taken since it was read. */
  balance: number;
  balanceEstimated: boolean;
  /** How many weekly charges it pays in full, the next one first, with no more jumps. */
  weeksCovered: number;
  /** When it first can't pay, and the carrier goes into debt. */
  debtAt: string;
  /** Services the journal names whose cost EDSSI doesn't know; the fee is at least this much. */
  unknownServices: string[];
}

export interface CarriersSnapshot {
  version: number;
  ready: boolean;
  commander?: string;
  /** Their own carrier first. */
  carriers: CarrierView[];
}

export function isNewerCarriersSnapshot(
  current: CarriersSnapshot | undefined,
  next: CarriersSnapshot,
): boolean {
  return !current || next.version > current.version || (next.ready && !current.ready);
}

export function lightYearsBetween(a: Coords, b: Coords): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
