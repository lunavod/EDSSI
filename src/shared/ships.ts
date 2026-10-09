/** The Ships tab: each of the commander's ships, slot by slot, with the empty slots shown too. */

/** The groups a ship's slots come in, in the order the tab shows them. */
export const SLOT_GROUPS = ['hardpoint', 'utility', 'core', 'internal', 'military'] as const;
export type SlotGroup = (typeof SLOT_GROUPS)[number];

/** One slot of a hull, as EDSY lists it. */
export interface CatalogSlot {
  /** The journal's `Slot` name, e.g. `LargeHardpoint1` or `Slot03_Size6`. */
  name: string;
  group: SlotGroup;
  /** 0 for a utility mount, 1–4 for small to huge hardpoints, the class for the rest. */
  size: number;
  /** The only kinds of module it takes, by EDSY's names (e.g. "Cargo Racks"), when restricted. */
  only?: string[];
}

export interface CatalogShip {
  name: string;
  slots: CatalogSlot[];
  /** What the shipyard sells it with: the item in each slot filled, by slot name. */
  stock: Record<string, string>;
  /** The hull alone, in credits, before any discount. */
  hullCost?: number;
  /** The hull with its stock modules. */
  retail?: number;
}

export interface CatalogModule {
  name: string;
  /** The module's class. */
  size: number;
  rating: string;
  mount?: 'F' | 'G' | 'T';
  /** EDSY's name for the kind of module, e.g. "Shield Generators". */
  kind?: string;
  /** Its price in outfitting, before any discount. */
  cost?: number;
}

/** What EDSSI takes from EDSY's database: every hull's slots, and the modules' names. */
export interface ShipCatalog {
  /** EDSY's database version. */
  version: number;
  /** When EDSY last changed its database, as `YYYY-MM-DD`, if it says. */
  modified?: string;
  /** By the journal's ship name, lowercase (`panthermkii`). */
  ships: Record<string, CatalogShip>;
  /** By the journal's item name, lowercase (`int_hyperdrive_size5_class5`). */
  modules: Record<string, CatalogModule>;
  /** Engineering blueprints' names by the journal's, lowercase (`engine_dirty` → "Dirty Tuning"). */
  blueprints: Record<string, string>;
}

export interface CatalogStatus {
  state: 'loading' | 'ready' | 'failed';
  /** When the slot tables EDSSI holds were fetched from EDSY. */
  fetchedAt?: string;
  modified?: string;
  /** Why the last fetch failed; there may still be older tables in use. */
  error?: string;
}

export interface Engineering {
  blueprint: string;
  level: number;
  quality: number;
  engineer?: string;
  experimental?: string;
}

export interface FittedModule {
  /** The journal's item name, lowercase. */
  item: string;
  name: string;
  /** Class and rating, e.g. "5A", where known. */
  grade?: string;
  mount?: string;
  on: boolean;
  priority: number;
  /** 0–1. */
  health: number;
  value?: number;
  engineering?: Engineering;
}

export interface SlotView {
  slot: string;
  group: SlotGroup;
  size?: number;
  module?: FittedModule;
  /** What it takes, when it's restricted, e.g. "Cargo racks or fuel tanks". */
  only?: string;
  /** Fitted in the journal, but not a slot EDSY lists for this hull. */
  unlisted?: boolean;
  /** What's fitted is what the shipyard sells the hull with there. */
  stock?: boolean;
}

export interface ShipStats {
  maxJumpRange: number;
  cargoCapacity: number;
  fuelMain: number;
  fuelReserve: number;
  unladenMass: number;
  rebuy: number;
  hullValue?: number;
  modulesValue?: number;
  /** 0–1. */
  hullHealth: number;
}

export interface ShipView {
  shipId: number;
  /** The journal's ship name, lowercase. */
  ship: string;
  /** "Panther Clipper Mk II". */
  type: string;
  name?: string;
  ident?: string;
  current: boolean;
  /** Where it is kept, when it isn't the ship being flown: a station, or a system. */
  where?: string;
  /** Being transferred to `where`. */
  inTransit?: boolean;
  /** When its loadout was last seen, if ever. */
  seenAt?: string;
  /**
   * Where the slots came from: EDSY's slot table for the hull, only the slots the journal has ever
   * shown filled on this ship, or EDSY's stock fit for a ship whose loadout the journal hasn't shown.
   */
  layout: 'edsy' | 'journal' | 'stock';
  slots: SlotView[];
  stats?: ShipStats;
  /** What the shipyard asks, from EDSY. */
  prices?: HullPrices;
}

export interface HullPrices {
  /** The hull alone. */
  hull?: number;
  /** The hull with its stock modules. */
  retail?: number;
}

/**
 * A hull as the shipyard sells it: every slot, filled as stock. For anything in EDSSI that wants a
 * ship it hasn't seen a loadout for (`ShipsService.stockFit`, `window.edssi.ships.stockFit`).
 */
export interface StockFit {
  /** The journal's ship name, lowercase. */
  ship: string;
  /** "Panther Clipper Mk II". */
  type: string;
  slots: SlotView[];
  prices: HullPrices;
}

/** A hull EDSY knows, for picking one. */
export interface HullSummary {
  ship: string;
  type: string;
}

export interface ShipsSnapshot {
  version: number;
  ready: boolean;
  commander?: string;
  /** The ship being flown first, then the rest by when they were last flown. */
  ships: ShipView[];
  /** Every hull EDSY lists, by name; empty until its tables are in. */
  hulls: HullSummary[];
  catalog: CatalogStatus;
}

/** Where a ship can be sent: opened in EDSY or Coriolis, or saved as a CSV of its slots. */
export type ShipExportTarget = 'edsy' | 'coriolis' | 'csv';

export function isNewerShipsSnapshot(
  current: ShipsSnapshot | undefined,
  next: ShipsSnapshot,
): boolean {
  return !current || next.version > current.version || (next.ready && !current.ready);
}
