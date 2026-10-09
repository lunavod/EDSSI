import type { JournalEvent, LoadoutEvent } from '../../shared/journal';
import { isCosmeticSlot, type SeenSlot } from './layout';

export interface ShipRecord {
  shipId: number;
  /** The journal's ship name, lowercase. */
  ship: string;
  /** The game's own name for the type, where an event gave it. */
  type?: string;
  name?: string;
  ident?: string;
  /** The last loadout seen. */
  loadout?: LoadoutEvent;
  /** Every slot ever seen filled on it, by lowercase slot name, and with what last. */
  seen: Map<string, SeenSlot>;
  /** Where it's kept, while it isn't the ship being flown. */
  where?: string;
  inTransit?: boolean;
  /** When a transfer ordered in the journal is due, so it stops counting as in transit. */
  arrivesAt?: string;
  /** When it was last the ship being flown. */
  flownAt?: string;
}

interface CommanderRecord {
  name?: string;
  ships: Map<number, ShipRecord>;
  current?: number;
}

/** Ships that are someone else's, or not really a ship: taxis, fighters, multicrew. */
const NOT_OWN_SHIP = /_taxi$|fighter/i;

/**
 * Follows the journal from the very first file and keeps, per commander, every ship they own: its
 * last loadout, every slot ever seen filled on it, and where it's kept.
 */
export class ShipsTracker {
  readonly #commanders = new Map<string, CommanderRecord>();
  #commander: CommanderRecord = this.#commanderFor('');
  /** Where the commander is docked, for a ship left there. */
  #docked: string | undefined;
  #version = 0;

  get version(): number {
    return this.#version;
  }

  get commander(): string | undefined {
    return this.#commander.name;
  }

  get current(): number | undefined {
    return this.#commander.current;
  }

  ships(): readonly ShipRecord[] {
    return [...this.#commander.ships.values()];
  }

  /** Applies an event; returns whether it could have changed what the tracker holds. */
  apply(event: JournalEvent): boolean {
    const changed = this.#apply(event);
    if (changed) this.#version++;
    return changed;
  }

  #apply(event: JournalEvent): boolean {
    switch (event.event) {
      case 'Commander':
        this.#commander = this.#commanderFor(event.FID, event.Name);
        return true;
      case 'LoadGame':
        this.#commander = this.#commanderFor(event.FID, event.Commander);
        return true;

      case 'Docked':
        this.#docked = place(event.StationName, event.StarSystem);
        return false;
      case 'Location':
        this.#docked = event.Docked ? place(event.StationName, event.StarSystem) : undefined;
        return false;
      case 'Undocked':
        this.#docked = undefined;
        return false;

      case 'Loadout':
        return this.#loadout(event);
      case 'SetUserShipName': {
        const record = this.#ship(event.ShipID, event.Ship);
        record.name = event.UserShipName;
        if (event.UserShipId !== undefined) record.ident = event.UserShipId;
        return true;
      }
      case 'ShipyardNew': {
        const record = this.#ship(event.NewShipID, event.ShipType);
        if (event.ShipType_Localised !== undefined) record.type = event.ShipType_Localised;
        this.#fly(record, event.timestamp);
        return true;
      }
      case 'ShipyardBuy':
        if (event.SellShipID !== undefined) this.#commander.ships.delete(event.SellShipID);
        if (event.StoreShipID !== undefined) this.#store(event.StoreShipID, this.#docked);
        return true;
      case 'ShipyardSwap': {
        this.#store(event.StoreShipID, this.#docked);
        const record = this.#ship(event.ShipID, event.ShipType);
        if (event.ShipType_Localised !== undefined) record.type = event.ShipType_Localised;
        this.#fly(record, event.timestamp);
        return true;
      }
      case 'ShipyardSell':
        this.#commander.ships.delete(event.SellShipID);
        return true;
      case 'SellShipOnRebuy':
        this.#commander.ships.delete(event.SellShipId);
        return true;
      case 'ShipyardTransfer': {
        const record = this.#commander.ships.get(event.ShipID);
        if (!record) return false;
        // The ship comes to where it was sent from; StoredShips won't say where while it travels.
        record.where = this.#docked;
        record.inTransit = event.TransferTime > 0;
        record.arrivesAt = new Date(
          Date.parse(event.timestamp) + event.TransferTime * 1000,
        ).toISOString();
        return true;
      }
      case 'StoredShips':
        return this.#storedShips(event);
      default:
        return false;
    }
  }

  #loadout(event: LoadoutEvent): boolean {
    if (NOT_OWN_SHIP.test(event.Ship)) return false;
    const record = this.#ship(event.ShipID, event.Ship);
    record.loadout = event;
    record.name = event.ShipName;
    record.ident = event.ShipIdent;
    for (const module of event.Modules) {
      if (isCosmeticSlot(module.Slot)) continue;
      record.seen.set(module.Slot.toLowerCase(), { slot: module.Slot, item: module.Item });
    }
    this.#fly(record, event.timestamp);
    return true;
  }

  /** The shipyard's list: every ship owned but the one being flown, and where it is. */
  #storedShips(event: JournalEvent & { event: 'StoredShips' }): boolean {
    const listed = new Set<number>();
    const here = place(event.StationName, event.StarSystem);
    for (const stored of event.ShipsHere) {
      listed.add(stored.ShipID);
      const record = this.#ship(stored.ShipID, stored.ShipType);
      if (stored.ShipType_Localised !== undefined) record.type = stored.ShipType_Localised;
      if (stored.Name !== undefined && record.name === undefined) record.name = stored.Name;
      record.where = here;
      record.inTransit = false;
      delete record.arrivesAt;
    }
    for (const stored of event.ShipsRemote) {
      listed.add(stored.ShipID);
      const record = this.#ship(stored.ShipID, stored.ShipType);
      if (stored.ShipType_Localised !== undefined) record.type = stored.ShipType_Localised;
      if (stored.Name !== undefined && record.name === undefined) record.name = stored.Name;
      record.inTransit = stored.InTransit === true;
      // A ship on its way has no system in the list; keep where the transfer said it was going.
      if (stored.StarSystem !== undefined || !record.inTransit) record.where = stored.StarSystem;
    }
    // Sold, lost or given up in ways the journal didn't spell out.
    for (const shipId of this.#commander.ships.keys()) {
      if (!listed.has(shipId) && shipId !== this.#commander.current) {
        this.#commander.ships.delete(shipId);
      }
    }
    return true;
  }

  #fly(record: ShipRecord, at: string): void {
    this.#commander.current = record.shipId;
    record.flownAt = at;
    delete record.where;
    delete record.inTransit;
    delete record.arrivesAt;
  }

  #store(shipId: number, where: string | undefined): void {
    const record = this.#commander.ships.get(shipId);
    if (!record) return;
    if (where === undefined) delete record.where;
    else record.where = where;
    record.inTransit = false;
  }

  #ship(shipId: number, ship: string): ShipRecord {
    let record = this.#commander.ships.get(shipId);
    const type = ship.toLowerCase();
    if (!record || record.ship !== type) {
      // A new ship, or an id given to another hull: nothing of the old one carries over.
      record = { shipId, ship: type, seen: new Map() };
      this.#commander.ships.set(shipId, record);
    }
    return record;
  }

  #commanderFor(id: string, name?: string): CommanderRecord {
    let record = this.#commanders.get(id);
    if (!record) {
      record = { ships: new Map() };
      this.#commanders.set(id, record);
    }
    if (name !== undefined) record.name = name;
    return record;
  }
}

function place(station: string | undefined, system: string | undefined): string | undefined {
  if (station === undefined) return system;
  return system === undefined ? station : `${station}, ${system}`;
}
