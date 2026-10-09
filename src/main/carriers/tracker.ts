import {
  CARRIER_BASE_UPKEEP,
  CARRIER_MAX_JUMP_LY,
  CARRIER_SERVICES,
  type CarrierService,
  type CarrierUpkeep,
  type CarrierCargoItem,
  type CarrierKind,
  type CarrierSpace,
  type CarrierView,
  carrierJumpFuel,
  carrierJumpsLeft,
  lightYearsBetween,
  upkeepForecast,
} from '../../shared/carriers';
import { journalCommodityName } from '../../shared/commodities';
import type { Coords } from '../../shared/csv-route';
import type { JournalEvent } from '../../shared/journal';

/** A jump request that doesn't say when it leaves goes after the usual lockdown. */
const DEFAULT_DEPARTURE_MS = 16 * 60_000;

interface PendingJump {
  system: string;
  address: string;
  bodyId: number;
  body?: string;
  /** Ms since the epoch. */
  departs: number;
}

/** A jump made since the last fuel reading, for working out what it burned. */
interface JumpMade {
  from: string;
  to: string;
  /** Space used when it went, if the tracker knew. */
  used?: number;
}

interface CarrierRecord {
  id: string;
  kind: CarrierKind;
  name?: string;
  callsign?: string;
  system?: string;
  bodyId?: number;
  body?: string;
  arrivedAt?: string;
  pending?: PendingJump;
  fuel?: { level: number; at: string };
  jumps: JumpMade[];
  stats?: { space: CarrierSpace; at: string };
  /** Tonnes moved in (or, negative, out) since `stats`. */
  cargoDelta: number;
  /** By the journal's commodity name, lowercase. */
  cargo: Map<string, { count: number; localised?: string }>;
  range?: number;
  finance?: { balance: number; reserve: number; available: number; readAt: string };
  dockingAccess?: string;
  allowNotorious?: boolean;
  /** Each crew role installed, and whether it's running. */
  services: Map<string, CarrierService['state']>;
  /** When each jump went, in ms, for the maintenance the next upkeep adds. */
  jumpTimes: number[];
  /** Ms since the epoch. */
  decommissionAt?: number;
}

interface CommanderRecord {
  name?: string;
  carriers: Map<string, CarrierRecord>;
}

/**
 * Follows the journal from the very first file and keeps, per commander, their own carrier and
 * their squadron's: where each is and is going, its tritium, its space and what it holds.
 *
 * The journal never lists a carrier's hold. The tracker adds up what the commander's own journal
 * moved in and out (transfers while docked on it, trades at its market), and checks the total
 * against `CarrierStats` whenever the management screen is opened. Fuel is read there and at
 * each deposit, less what each jump since burned (`carrierJumpFuel`).
 */
export class CarriersTracker {
  readonly #commanders = new Map<string, CommanderRecord>();
  #commander: CommanderRecord = this.#commanderFor('');
  /** Every system position the journal (or EDSM) gave, by lowercase name. */
  readonly #positions = new Map<string, Coords>();
  /** The system the commander is in. */
  #here: string | undefined;
  /** Where the commander is docked: its `MarketID`, and what kind of station. */
  #docked: { id: string; type?: string } | undefined;
  #version = 0;

  get version(): number {
    return this.#version;
  }

  get commander(): string | undefined {
    return this.#commander.name;
  }

  /** Applies an event; returns whether it could have changed what the tracker holds. */
  apply(event: JournalEvent): boolean {
    const time = Date.parse(event.timestamp);
    const settled = Number.isFinite(time) && this.#settle(time);
    const changed = this.#apply(event) || settled;
    if (changed) this.#version++;
    return changed;
  }

  /**
   * Moves each carrier whose jump has left by `now` (ms) to where it was going, and drops one
   * that has been scrapped. Returns whether anything moved.
   */
  settle(now: number): boolean {
    const changed = this.#settle(now);
    if (changed) this.#version++;
    return changed;
  }

  /** When the next scheduled jump leaves or scrapping happens, in ms, if any. */
  nextDue(): number | undefined {
    let next: number | undefined;
    for (const carrier of this.#commander.carriers.values()) {
      for (const due of [carrier.pending?.departs, carrier.decommissionAt]) {
        if (due !== undefined && (next === undefined || due < next)) next = due;
      }
    }
    return next;
  }

  /** Systems the carriers were, are or are going, that the tracker has no position for. */
  missingPositions(): string[] {
    const names = new Set<string>();
    for (const carrier of this.#commander.carriers.values()) {
      for (const name of [
        carrier.system,
        carrier.pending?.system,
        ...carrier.jumps.flatMap((jump) => [jump.from, jump.to]),
      ]) {
        if (name !== undefined && !this.#positions.has(name.toLowerCase())) names.add(name);
      }
    }
    if (this.#here !== undefined && !this.#positions.has(this.#here.toLowerCase())) {
      names.add(this.#here);
    }
    return [...names];
  }

  /** Positions found elsewhere (EDSM), keyed by lowercase name. */
  addPositions(found: ReadonlyMap<string, Coords>): boolean {
    let changed = false;
    for (const [name, coords] of found) {
      if (this.#positions.has(name.toLowerCase())) continue;
      this.#positions.set(name.toLowerCase(), coords);
      changed = true;
    }
    if (changed) this.#version++;
    return changed;
  }

  /** The commander's carriers as the tab and the assistant show them, their own first. */
  views(now = Date.now()): CarrierView[] {
    return [...this.#commander.carriers.values()]
      .toSorted((a, b) => Number(a.kind === 'squadron') - Number(b.kind === 'squadron'))
      .map((carrier) => this.#view(carrier, now));
  }

  #apply(event: JournalEvent): boolean {
    switch (event.event) {
      case 'Commander':
        this.#commander = this.#commanderFor(event.FID, event.Name);
        return true;
      case 'LoadGame':
        this.#commander = this.#commanderFor(event.FID, event.Commander);
        return true;

      case 'Location':
        this.#docked =
          event.Docked && event.MarketID !== undefined
            ? { id: String(event.MarketID), type: event.StationType }
            : undefined;
        this.#arrive(event.StarSystem, event.StarPos);
        return true;
      case 'FSDJump':
        this.#docked = undefined;
        this.#arrive(event.StarSystem, event.StarPos);
        return true;
      case 'CarrierJump': {
        this.#arrive(event.StarSystem, event.StarPos);
        // Aboard, the arrival names no carrier; the one headed here is the one that jumped.
        const address = String(event.SystemAddress);
        for (const carrier of this.#commander.carriers.values()) {
          if (carrier.pending?.address === address) this.#complete(carrier);
        }
        return true;
      }
      case 'Docked':
        this.#docked = { id: String(event.MarketID), type: event.StationType };
        return false;
      case 'Undocked':
        this.#docked = undefined;
        return false;

      case 'CarrierBuy': {
        const carrier = this.#carrier(event.CarrierID, event.CarrierType);
        carrier.callsign = event.Callsign;
        carrier.system = event.Location;
        carrier.arrivedAt = event.timestamp;
        return true;
      }
      case 'CarrierStats':
        return this.#stats(event);
      case 'CarrierLocation': {
        const carrier = this.#carrier(event.CarrierID, event.CarrierType);
        this.#locate(
          carrier,
          event.StarSystem,
          String(event.SystemAddress),
          event.BodyID,
          event.timestamp,
        );
        return true;
      }
      case 'CarrierJumpRequest': {
        const carrier = this.#carrier(event.CarrierID, event.CarrierType);
        const departs = Date.parse(event.DepartureTime ?? '');
        carrier.pending = {
          system: event.SystemName,
          address: String(event.SystemAddress),
          bodyId: event.BodyID,
          ...(event.Body !== undefined && { body: event.Body }),
          departs: Number.isFinite(departs)
            ? departs
            : Date.parse(event.timestamp) + DEFAULT_DEPARTURE_MS,
        };
        return true;
      }
      case 'CarrierJumpCancelled': {
        const carrier = this.#known(event.CarrierID);
        if (!carrier?.pending) return false;
        delete carrier.pending;
        return true;
      }
      case 'CarrierDepositFuel': {
        // Anyone can donate to any carrier; only one of the commander's is worth a record.
        const carrier = this.#known(event.CarrierID);
        if (!carrier) return false;
        carrier.fuel = { level: event.Total, at: event.timestamp };
        carrier.jumps = [];
        return true;
      }
      case 'CarrierNameChange': {
        const carrier = this.#carrier(event.CarrierID, event.CarrierType);
        carrier.name = event.Name;
        carrier.callsign = event.Callsign;
        return true;
      }
      case 'CarrierFinance': {
        const carrier = this.#carrier(event.CarrierID, event.CarrierType);
        carrier.finance = {
          balance: event.CarrierBalance,
          reserve: event.ReserveBalance,
          available: event.AvailableBalance,
          readAt: event.timestamp,
        };
        return true;
      }
      case 'CarrierBankTransfer': {
        const carrier = this.#carrier(event.CarrierID, event.CarrierType);
        const reserve = carrier.finance?.reserve ?? 0;
        carrier.finance = {
          balance: event.CarrierBalance,
          reserve,
          available: Math.max(0, event.CarrierBalance - reserve),
          readAt: event.timestamp,
        };
        return true;
      }
      case 'CarrierDockingPermission': {
        const carrier = this.#carrier(event.CarrierID, event.CarrierType);
        carrier.dockingAccess = event.DockingAccess;
        carrier.allowNotorious = event.AllowNotorious;
        return true;
      }
      case 'CarrierCrewServices': {
        const carrier = this.#known(event.CarrierID);
        if (!carrier) return false;
        // Activate installs a service, Deactivate removes it; Pause and Resume suspend it.
        const operation = event.Operation.toLowerCase();
        if (operation === 'activate' || operation === 'resume') {
          carrier.services.set(event.CrewRole, 'active');
        } else if (operation === 'pause') carrier.services.set(event.CrewRole, 'suspended');
        else if (operation === 'deactivate') carrier.services.delete(event.CrewRole);
        else return false;
        return true;
      }
      case 'CarrierDecommission': {
        const carrier = this.#known(event.CarrierID);
        if (!carrier) return false;
        carrier.decommissionAt = event.ScrapTime * 1000;
        return true;
      }
      case 'CarrierCancelDecommission': {
        const carrier = this.#known(event.CarrierID);
        if (!carrier) return false;
        delete carrier.decommissionAt;
        return true;
      }

      case 'CargoTransfer': {
        // Only docked on a carrier does a transfer touch it; "toship" is also an SRV's way back.
        // Cargo moves only to the commander's own or squadron's carrier, so one not seen yet is it.
        const docked = this.#docked;
        const carrier =
          docked &&
          (this.#known(docked.id) ??
            (docked.type !== undefined && /carrier/i.test(docked.type)
              ? this.#carrier(Number(docked.id), docked.type)
              : undefined));
        if (!carrier) return false;
        for (const transfer of event.Transfers) {
          const direction = transfer.Direction.toLowerCase();
          const sign = direction === 'tocarrier' ? 1 : direction === 'toship' ? -1 : 0;
          if (sign !== 0) {
            this.#move(carrier, transfer.Type, transfer.Type_Localised, sign * transfer.Count);
          }
        }
        return true;
      }
      case 'MarketBuy': {
        const carrier = this.#known(event.MarketID);
        if (!carrier) return false;
        this.#move(carrier, event.Type, event.Type_Localised, -event.Count);
        return true;
      }
      case 'MarketSell': {
        const carrier = this.#known(event.MarketID);
        if (!carrier) return false;
        this.#move(carrier, event.Type, event.Type_Localised, event.Count);
        return true;
      }

      case 'LeftSquadron':
      case 'KickedFromSquadron':
      case 'DisbandedSquadron':
        return this.#drop('squadron');
      default:
        return false;
    }
  }

  #stats(event: JournalEvent & { event: 'CarrierStats' }): boolean {
    const carrier = this.#carrier(event.CarrierID, event.CarrierType);
    const space = event.SpaceUsage;
    carrier.name = event.Name;
    carrier.callsign = event.Callsign;
    carrier.fuel = { level: event.FuelLevel, at: event.timestamp };
    carrier.jumps = [];
    carrier.range = event.JumpRangeCurr;
    carrier.stats = {
      space: {
        capacity: space.TotalCapacity,
        crew: space.Crew,
        cargo: space.Cargo,
        reserved: space.CargoSpaceReserved,
        shipPacks: space.ShipPacks,
        modulePacks: space.ModulePacks,
        free: space.FreeSpace,
      },
      at: event.timestamp,
    };
    carrier.cargoDelta = 0;
    carrier.finance = {
      balance: event.Finance.CarrierBalance,
      reserve: event.Finance.ReserveBalance,
      available: event.Finance.AvailableBalance,
      readAt: event.timestamp,
    };
    carrier.dockingAccess = event.DockingAccess;
    carrier.allowNotorious = event.AllowNotorious;
    // Activated is installed; Enabled false is installed but suspended.
    carrier.services = new Map(
      event.Crew.filter((crew) => crew.Activated).map((crew) => [
        crew.CrewRole,
        crew.Enabled === false ? 'suspended' : 'active',
      ]),
    );
    if (!event.PendingDecommission) delete carrier.decommissionAt;
    return true;
  }

  #settle(now: number): boolean {
    let changed = false;
    for (const commander of this.#commanders.values()) {
      for (const [id, carrier] of commander.carriers) {
        if (carrier.decommissionAt !== undefined && carrier.decommissionAt <= now) {
          commander.carriers.delete(id);
          changed = true;
        } else if (carrier.pending && carrier.pending.departs <= now) {
          this.#complete(carrier);
          changed = true;
        }
      }
    }
    return changed;
  }

  /** Where a `CarrierLocation` puts it: its scheduled jump's end, or somewhere it went unseen. */
  #locate(carrier: CarrierRecord, system: string, address: string, bodyId: number, at: string) {
    if (carrier.pending?.address === address) this.#complete(carrier);
    else if (carrier.system?.toLowerCase() !== system.toLowerCase()) {
      // Jumped while EDSSI wasn't looking (the game was off, or a squadron officer flew it).
      if (carrier.system !== undefined) {
        carrier.jumps.push({ from: carrier.system, to: system, ...this.#usedNow(carrier) });
        jumped(carrier, Date.parse(at));
      }
      carrier.system = system;
      carrier.arrivedAt = at;
      delete carrier.body;
    }
    if (carrier.bodyId !== bodyId) delete carrier.body;
    carrier.bodyId = bodyId;
  }

  #complete(carrier: CarrierRecord): void {
    const pending = carrier.pending;
    if (!pending) return;
    if (carrier.system !== undefined && carrier.system !== pending.system) {
      carrier.jumps.push({ from: carrier.system, to: pending.system, ...this.#usedNow(carrier) });
    }
    // A hop between bodies of one system is a jump too, for the maintenance fee.
    jumped(carrier, pending.departs);
    carrier.system = pending.system;
    carrier.bodyId = pending.bodyId;
    if (pending.body === undefined) delete carrier.body;
    else carrier.body = pending.body;
    carrier.arrivedAt = new Date(pending.departs).toISOString();
    delete carrier.pending;
  }

  #usedNow(carrier: CarrierRecord): { used?: number } {
    const used = usedSpace(carrier);
    return used === undefined ? {} : { used };
  }

  #move(carrier: CarrierRecord, type: string, localised: string | undefined, count: number) {
    const key = type.toLowerCase();
    const item = carrier.cargo.get(key) ?? { count: 0 };
    // Below nothing means the journal missed a move; the check against CarrierStats shows it.
    item.count = Math.max(0, item.count + count);
    if (localised !== undefined) item.localised = localised;
    carrier.cargo.set(key, item);
    carrier.cargoDelta += count;
  }

  #arrive(system: string, position: readonly number[] | undefined): void {
    this.#here = system;
    const [x, y, z] = position ?? [];
    if (x !== undefined && y !== undefined && z !== undefined) {
      this.#positions.set(system.toLowerCase(), [x, y, z]);
    }
  }

  #view(carrier: CarrierRecord, now: number): CarrierView {
    const position = (name: string | undefined) =>
      name === undefined ? undefined : this.#positions.get(name.toLowerCase());
    const between = (a: string | undefined, b: string | undefined) => {
      const from = position(a);
      const to = position(b);
      return from && to ? lightYearsBetween(from, to) : undefined;
    };

    const capacity = carrier.stats?.space.capacity;
    let fuel: CarrierView['fuel'];
    if (carrier.fuel) {
      let level = carrier.fuel.level;
      let uncounted = 0;
      for (const jump of carrier.jumps) {
        const distance = between(jump.from, jump.to);
        if (distance === undefined || jump.used === undefined || carrier.kind !== 'own') {
          uncounted++;
        } else level = Math.max(0, level - carrierJumpFuel(distance, jump.used, level, capacity));
      }
      fuel = {
        level,
        readAt: carrier.fuel.at,
        estimated: carrier.jumps.length > uncounted,
        uncounted,
      };
    }

    const used = usedSpace(carrier);
    // The formula is checked against fleet carriers only; a squadron's gets no predictions.
    const predictFrom = carrier.kind === 'own' ? used : undefined;
    const range = carrier.range ?? CARRIER_MAX_JUMP_LY;
    const space = carrier.stats && {
      ...carrier.stats.space,
      cargo: carrier.stats.space.cargo + carrier.cargoDelta,
      free: carrier.stats.space.free - carrier.cargoDelta,
    };

    const cargo: CarrierCargoItem[] = [...carrier.cargo]
      .filter(([, item]) => item.count > 0)
      .map(([type, item]) => ({
        type,
        name: journalCommodityName(type, item.localised),
        count: item.count,
      }))
      .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const listed = cargo.reduce((sum, item) => sum + item.count, 0);
    const unaccounted = space ? space.cargo - listed : undefined;

    const pending = carrier.pending;
    const jumpDistance = pending && between(carrier.system, pending.system);
    const distanceFromHere = between(this.#here, carrier.system);
    const services = [...carrier.services]
      // The core crew are aboard every carrier, paid for by the base fee.
      .filter(([role]) => !CORE_ROLES.has(role))
      .map(([role, state]): CarrierService => {
        const known = CARRIER_SERVICES[role];
        return {
          role,
          name: known?.name ?? role.replace(/([a-z])([A-Z])/g, '$1 $2'),
          state,
          ...(known && { weekly: known[state] }),
        };
      })
      .toSorted((a, b) => a.name.localeCompare(b.name));
    const upkeep = carrier.stats && carrier.finance && this.#upkeep(carrier, services, now);

    return {
      carrierId: carrier.id,
      kind: carrier.kind,
      ...(carrier.name !== undefined && { name: carrier.name }),
      ...(carrier.callsign !== undefined && { callsign: carrier.callsign }),
      ...(carrier.system !== undefined && { system: carrier.system }),
      ...(carrier.body !== undefined && { body: carrier.body }),
      ...(carrier.arrivedAt !== undefined && { arrivedAt: carrier.arrivedAt }),
      ...(distanceFromHere !== undefined && { distanceLy: distanceFromHere }),
      ...(pending && {
        jump: {
          system: pending.system,
          ...(pending.body !== undefined && { body: pending.body }),
          departs: new Date(pending.departs).toISOString(),
          ...(jumpDistance !== undefined && { distanceLy: jumpDistance }),
          ...(jumpDistance !== undefined &&
            predictFrom !== undefined &&
            fuel && { fuel: carrierJumpFuel(jumpDistance, predictFrom, fuel.level, capacity) }),
        },
      }),
      ...(fuel && { fuel }),
      rangeLy: range,
      ...(fuel &&
        predictFrom !== undefined && {
          fullJumpFuel: carrierJumpFuel(range, predictFrom, fuel.level, capacity),
          jumpsLeft: carrierJumpsLeft(fuel.level, predictFrom, range, capacity),
        }),
      ...(space && { space }),
      cargo,
      ...(unaccounted !== undefined && unaccounted !== 0 && { unaccounted }),
      ...(carrier.stats && { statsAt: carrier.stats.at }),
      ...(carrier.finance && { finance: carrier.finance }),
      ...(carrier.dockingAccess !== undefined && { dockingAccess: carrier.dockingAccess }),
      ...(carrier.allowNotorious !== undefined && { allowNotorious: carrier.allowNotorious }),
      services,
      ...(upkeep && { upkeep }),
      ...(carrier.decommissionAt !== undefined && {
        decommissionAt: new Date(carrier.decommissionAt).toISOString(),
      }),
    };
  }

  #upkeep(
    carrier: CarrierRecord,
    services: readonly CarrierService[],
    now: number,
  ): CarrierUpkeep | undefined {
    const finance = carrier.finance;
    if (!finance) return undefined;
    const { base, perJump } = CARRIER_BASE_UPKEEP[carrier.kind];
    const servicesCost = services.reduce((sum, service) => sum + (service.weekly ?? 0), 0);
    const weekly = base + servicesCost;
    const forecast = upkeepForecast({
      balance: finance.balance,
      balanceAt: Date.parse(finance.readAt),
      weekly,
      perJump,
      jumpTimes: carrier.jumpTimes,
      now,
    });
    return {
      base,
      services: servicesCost,
      weekly,
      perJump,
      jumpsThisWeek: (forecast.nextCharge - weekly) / perJump,
      nextCharge: forecast.nextCharge,
      nextChargeAt: new Date(forecast.nextChargeAt).toISOString(),
      balance: forecast.balance,
      balanceEstimated: forecast.estimated,
      weeksCovered: forecast.weeksCovered,
      debtAt: new Date(forecast.debtAt).toISOString(),
      unknownServices: services
        .filter((service) => service.weekly === undefined)
        .map((service) => service.name),
    };
  }

  /** A carrier the commander has, by its id. */
  #known(id: number | string): CarrierRecord | undefined {
    return this.#commander.carriers.get(String(id));
  }

  /**
   * The carrier with that id, made if new. A commander has one carrier of their own and sees one
   * of their squadron's, so a new one of either kind replaces the old.
   */
  #carrier(id: number, type: string | undefined): CarrierRecord {
    const key = String(id);
    const kind: CarrierKind = type === 'SquadronCarrier' ? 'squadron' : 'own';
    let carrier = this.#commander.carriers.get(key);
    if (!carrier) {
      this.#drop(kind);
      carrier = {
        id: key,
        kind,
        jumps: [],
        cargoDelta: 0,
        cargo: new Map(),
        services: new Map(),
        jumpTimes: [],
      };
      this.#commander.carriers.set(key, carrier);
    }
    return carrier;
  }

  #drop(kind: CarrierKind): boolean {
    let dropped = false;
    for (const [id, carrier] of this.#commander.carriers) {
      if (carrier.kind === kind) dropped = this.#commander.carriers.delete(id) || dropped;
    }
    return dropped;
  }

  #commanderFor(id: string, name?: string): CommanderRecord {
    let record = this.#commanders.get(id);
    if (!record) {
      record = { carriers: new Map() };
      this.#commanders.set(id, record);
    }
    if (name !== undefined) record.name = name;
    return record;
  }
}

/** The crew every carrier has, paid for by the base fee. */
const CORE_ROLES = new Set(['Captain', 'Commodities', 'CarrierFuel']);
/** Jumps older than this are long paid for. */
const JUMP_MEMORY_MS = 14 * 24 * 3_600_000;

function jumped(carrier: CarrierRecord, at: number): void {
  if (!Number.isFinite(at)) return;
  carrier.jumpTimes = carrier.jumpTimes.filter((time) => time > at - JUMP_MEMORY_MS);
  carrier.jumpTimes.push(at);
}

/** Space taken now, if the tracker has seen the management screen to know the crew and packs. */
function usedSpace(carrier: CarrierRecord): number | undefined {
  const space = carrier.stats?.space;
  return space && space.capacity - space.free + carrier.cargoDelta;
}
