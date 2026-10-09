/**
 * What the commander has been doing, from the very first journal: where they went, what they found,
 * earned and spent, their missions and their career. The journal itself is far too long to put in
 * front of the model, so each event worth talking about becomes one small record, and
 * `summary.ts` adds the records of a period up.
 */

import type { ActivityRecord, EarnSource, PlaySpan, SpendSource } from '../../shared/activity';
import { creditsDelta } from '../../shared/credits';
import type { JournalEvent, StatisticsEvent } from '../../shared/journal';
import { FIRST_FOOTFALL_BONUS } from '../history/tracker';
import { estimateBodyValue, isTerraformable, organicValue } from '../history/values';

export type {
  ActivityRecord,
  EarnSource,
  PlaySpan,
  RecordOf,
  SpendSource,
} from '../../shared/activity';

/**
 * A longer gap between two journal lines is time away from the game, not time played. Long
 * supercruise trips write little, so this is generous.
 */
export const IDLE_GAP_MS = 20 * 60_000;

export interface ActiveMission {
  id: string;
  name: string;
  faction: string;
  acceptedAt: number;
  expires?: number;
  reward?: number;
  destinationSystem?: string;
  destinationStation?: string;
  commodity?: string;
  count?: number;
  killCount?: number;
  passengers?: number;
  wing: boolean;
}

export interface CommanderActivity {
  name?: string;
  /** Oldest first, in the order the game wrote them. */
  records: ActivityRecord[];
  spans: PlaySpan[];
  visited: Set<string>;
  missions: Map<string, ActiveMission>;
  statistics?: StatisticsEvent;
  /** Rank numbers by the Rank event's field names, e.g. `Explore`. */
  ranks?: Record<string, number | undefined>;
  /** Percent towards the next rank, by the same names. */
  progress?: Record<string, number | undefined>;
  /** From the last LoadGame. */
  credits?: number;
  ship?: string;
  shipName?: string;
  gameMode?: string;
  position?: [number, number, number];
  farthestFromSol?: { ly: number; system: string; at: number };
  firstSeen?: number;
  /** The last sale of exploration or organic data. */
  lastDataSale?: number;
}

interface ScannedBody {
  unmapped: number;
  mapped: number;
  mappedEfficiently: number;
  /** Nobody had set foot on it, so its organics pay the bonus. */
  firstFootfall: boolean;
}

export class ActivityTracker {
  readonly #commanders = new Map<string, CommanderActivity>();
  #commander: CommanderActivity = this.#commanderFor('');
  /** When each game session began, for every commander. */
  readonly #sessionStarts: number[] = [];
  readonly #scanned = new Map<string, ScannedBody>();
  readonly #analysed = new Set<string>();
  /** Body names by system address and body id, for events that only give the id. */
  readonly #names = new Map<string, string>();
  #system?: string;
  #station?: string;
  #odyssey = true;

  /** The commander being played now (or last). */
  get current(): CommanderActivity {
    return this.#commander;
  }

  get sessionStarts(): readonly number[] {
    return this.#sessionStarts;
  }

  apply(event: JournalEvent): void {
    const at = Date.parse(event.timestamp);
    if (!Number.isFinite(at)) return;
    this.#play(at);
    this.#apply(event, at);
  }

  /** Stretches the current span of play, or starts a new one after a silence. */
  #play(at: number): void {
    const commander = this.#commander;
    commander.firstSeen ??= at;
    const last = commander.spans.at(-1);
    if (last && at >= last.to && at - last.to <= IDLE_GAP_MS) last.to = at;
    else if (!last || at > last.to) commander.spans.push({ from: at, to: at });
  }

  #record(record: ActivityRecord): void {
    this.#commander.records.push(record);
  }

  #apply(event: JournalEvent, at: number): void {
    const commander = this.#commander;
    const system = this.#system;
    // Keeps the running balance in step with sales and purchases between `LoadGame`s; see
    // creditsDelta.
    const delta = creditsDelta(event);
    if (delta !== 0 && commander.credits !== undefined) commander.credits += delta;
    switch (event.event) {
      case 'Fileheader':
        if (event.part === 1) this.#sessionStarts.push(at);
        this.#odyssey = event.Odyssey;
        return;
      case 'Commander':
        this.#commander = this.#commanderFor(event.FID, event.Name);
        return;
      case 'LoadGame': {
        this.#commander = this.#commanderFor(event.FID, event.Commander);
        const current = this.#commander;
        current.credits = event.Credits;
        current.ship = event.Ship_Localised ?? event.Ship ?? current.ship;
        current.shipName = event.ShipName ?? current.shipName;
        current.gameMode = event.GameMode === 'Group' ? `Group ${event.Group}` : event.GameMode;
        this.#play(at);
        return;
      }
      case 'Statistics':
        commander.statistics = event;
        return;
      case 'Rank': {
        const { event: _event, timestamp: _timestamp, ...ranks } = event;
        commander.ranks = ranks;
        return;
      }
      case 'Progress': {
        const { event: _event, timestamp: _timestamp, ...progress } = event;
        commander.progress = progress;
        return;
      }
      case 'Promotion':
        for (const [rank, level] of Object.entries(event)) {
          if (typeof level !== 'number') continue;
          this.#record({ kind: 'promotion', at, system, rank, level });
          if (commander.ranks) Object.assign(commander.ranks, { [rank]: level });
        }
        return;

      case 'Location':
      case 'CarrierJump':
        this.#arrive(event.StarSystem, event.SystemAddress, event.StarPos, at);
        this.#station = event.Docked ? event.StationName : undefined;
        this.#record({ kind: 'location', at, system: event.StarSystem });
        return;
      case 'FSDJump': {
        const firstVisit = !commander.visited.has(String(event.SystemAddress));
        this.#arrive(event.StarSystem, event.SystemAddress, event.StarPos, at);
        this.#station = undefined;
        this.#record({
          kind: 'jump',
          at,
          system: event.StarSystem,
          distanceLy: event.JumpDist,
          fromSolLy: fromSol(event.StarPos),
          firstVisit,
        });
        return;
      }
      case 'Docked':
        this.#system = event.StarSystem ?? this.#system;
        this.#station = event.StationName_Localised ?? event.StationName;
        if (event.Taxi || event.Multicrew) return;
        this.#record({
          kind: 'dock',
          at,
          system: this.#system,
          station: this.#station,
          stationType: event.StationType || undefined,
        });
        return;
      case 'Undocked':
        this.#station = undefined;
        return;
      case 'Touchdown':
        if (!event.PlayerControlled || event.OnStation || !event.Body) return;
        this.#record({ kind: 'land', at, system: event.StarSystem ?? system, body: event.Body });
        return;
      case 'Disembark':
        if (!event.OnPlanet || event.Taxi || event.Multicrew) return;
        this.#record({ kind: 'on_foot', at, system: event.StarSystem, body: event.Body });
        return;
      case 'FuelScoop':
        this.#record({ kind: 'scoop', at, system, tons: event.Scooped });
        return;

      case 'Scan':
        this.#scan(event, at);
        return;
      case 'SAAScanComplete': {
        const key = `${String(event.SystemAddress)}:${event.BodyID}`;
        const body = this.#scanned.get(key);
        const efficient = event.ProbesUsed <= event.EfficiencyTarget;
        const mappedValue = body && (efficient ? body.mappedEfficiently : body.mapped);
        this.#record({
          kind: 'map',
          at,
          system,
          body: event.BodyName,
          addedValue: body && mappedValue !== undefined ? mappedValue - body.unmapped : 0,
          efficient,
        });
        return;
      }
      case 'ScanOrganic': {
        if (!/^analyse$/i.test(event.ScanType)) return;
        const newSpecies = !this.#analysed.has(event.Species);
        this.#analysed.add(event.Species);
        const base = organicValue(event.Species);
        const bonus = this.#scanned.get(`${String(event.SystemAddress)}:${event.Body}`)
          ?.firstFootfall
          ? FIRST_FOOTFALL_BONUS
          : 1;
        this.#record({
          kind: 'organic',
          at,
          system,
          body: this.#bodyName(event.SystemAddress, event.Body),
          species: event.Species_Localised ?? event.Species,
          genus: event.Genus_Localised ?? event.Genus,
          value: base === undefined ? undefined : base * bonus,
          newSpecies,
        });
        return;
      }
      case 'CodexEntry':
        if (!event.IsNewEntry) return;
        this.#record({
          kind: 'codex',
          at,
          system: event.System,
          name: event.Name_Localised ?? event.Name,
          category: event.SubCategory_Localised ?? event.Category_Localised ?? event.Category,
          stellar: /StellarBodies/i.test(event.Category),
        });
        return;

      case 'SellExplorationData':
      case 'MultiSellExplorationData':
        commander.lastDataSale = at;
        this.#earn(at, 'exploration', event.TotalEarnings);
        return;
      case 'SellOrganicData':
        commander.lastDataSale = at;
        this.#earn(
          at,
          'exobiology',
          event.BioData.reduce((sum, sold) => sum + sold.Value + sold.Bonus, 0),
        );
        return;
      case 'MarketSell':
        this.#earn(at, 'trade', event.TotalSale, event.Type_Localised ?? event.Type, {
          profit: event.TotalSale - event.AvgPricePaid * event.Count,
        });
        return;
      case 'RedeemVoucher':
        this.#earn(
          at,
          /^bounty$/i.test(event.Type)
            ? 'bounties'
            : /^combatbond$/i.test(event.Type)
              ? 'combat_bonds'
              : 'other_vouchers',
          event.Amount,
          event.Type,
        );
        return;
      case 'MissionCompleted':
        commander.missions.delete(String(event.MissionID));
        this.#record({
          kind: 'mission',
          at,
          system,
          outcome: 'completed',
          name: event.LocalisedName ?? event.Name,
          faction: event.Faction,
          reward: event.Reward,
        });
        if (event.Reward) this.#earn(at, 'missions', event.Reward);
        return;
      case 'SearchAndRescue':
        this.#earn(at, 'search_and_rescue', event.Reward, event.Name_Localised ?? event.Name);
        return;
      case 'ShipyardSell':
      case 'SellShipOnRebuy':
        this.#earn(at, 'ship_and_module_sales', event.ShipPrice, event.ShipType);
        return;
      case 'ModuleSell':
        this.#earn(at, 'ship_and_module_sales', event.SellPrice, event.SellItem_Localised);
        return;

      case 'ShipyardBuy':
        this.#spend(at, 'ships', event.ShipPrice, event.ShipType_Localised ?? event.ShipType);
        if (event.SellPrice) this.#earn(at, 'ship_and_module_sales', event.SellPrice);
        this.#record({
          kind: 'ship',
          at,
          system,
          ship: event.ShipType_Localised ?? event.ShipType,
          how: 'bought',
        });
        return;
      case 'ShipyardSwap':
        commander.ship = event.ShipType_Localised ?? event.ShipType;
        this.#record({ kind: 'ship', at, system, ship: commander.ship, how: 'swapped' });
        return;
      case 'Loadout':
        commander.shipName = event.ShipName || commander.shipName;
        return;
      case 'ModuleBuy':
        this.#spend(at, 'outfitting', event.BuyPrice, event.BuyItem_Localised ?? event.BuyItem);
        if (event.SellPrice) this.#earn(at, 'ship_and_module_sales', event.SellPrice);
        return;
      case 'MarketBuy':
        this.#spend(at, 'trade', event.TotalCost, event.Type_Localised ?? event.Type);
        return;
      case 'Repair':
      case 'RepairAll':
        this.#spend(at, 'repairs', event.Cost);
        return;
      case 'RefuelAll':
      case 'RefuelPartial':
        this.#spend(at, 'fuel', event.Cost);
        return;
      case 'BuyAmmo':
      case 'RestockVehicle':
        this.#spend(at, 'ammo_and_restock', event.Cost);
        return;
      case 'Resurrect':
        this.#spend(at, 'rebuy', event.Cost);
        return;
      case 'PayFines':
      case 'PayBounties':
        this.#spend(at, 'fines_and_bounties', event.Amount);
        return;
      case 'BuyExplorationData':
        this.#spend(at, 'exploration_data', event.Cost, event.System);
        return;

      case 'Bounty':
        this.#record({
          kind: 'bounty',
          at,
          system,
          reward: event.TotalReward ?? event.Reward ?? 0,
          target: event.PilotName_Localised ?? event.Target_Localised ?? event.Target,
        });
        return;
      case 'FactionKillBond':
      case 'CapShipBond':
        this.#record({ kind: 'bond', at, system, reward: event.Reward });
        return;
      case 'Interdicted':
        this.#record({
          kind: 'interdiction',
          at,
          system,
          escaped: false,
          byPlayer: event.IsPlayer,
          interdictor: event.Interdictor_Localised ?? event.Interdictor,
        });
        return;
      case 'EscapeInterdiction':
        this.#record({
          kind: 'interdiction',
          at,
          system,
          escaped: true,
          byPlayer: event.IsPlayer,
          interdictor: event.Interdictor_Localised ?? event.Interdictor,
        });
        return;
      case 'CommitCrime':
        this.#record({
          kind: 'crime',
          at,
          system,
          crime: event.CrimeType,
          fine: event.Fine,
          bounty: event.Bounty,
        });
        return;
      case 'Died':
        this.#record({
          kind: 'death',
          at,
          system,
          killer:
            event.KillerName_Localised ??
            event.KillerName ??
            (event.Killers?.map((killer) => killer.KillerName).join(', ') || undefined),
        });
        return;

      case 'MissionAccepted':
        commander.missions.set(String(event.MissionID), {
          id: String(event.MissionID),
          name: event.LocalisedName ?? event.Name,
          faction: event.Faction,
          acceptedAt: at,
          expires: event.Expiry === undefined ? undefined : Date.parse(event.Expiry),
          reward: event.Reward,
          destinationSystem: event.NewDestinationSystem ?? event.DestinationSystem,
          destinationStation:
            event.NewDestinationStation ?? event.DestinationStation ?? event.DestinationSettlement,
          commodity: event.Commodity_Localised ?? event.Commodity,
          count: event.Count,
          killCount: event.KillCount,
          passengers: event.PassengerCount,
          wing: event.Wing,
        });
        this.#record({
          kind: 'mission',
          at,
          system,
          outcome: 'accepted',
          name: event.LocalisedName ?? event.Name,
          faction: event.Faction,
          reward: event.Reward,
        });
        return;
      case 'MissionRedirected': {
        const mission = commander.missions.get(String(event.MissionID));
        if (mission) {
          mission.destinationSystem = event.NewDestinationSystem;
          mission.destinationStation = event.NewDestinationStation;
        }
        return;
      }
      case 'MissionFailed':
      case 'MissionAbandoned': {
        const mission = commander.missions.get(String(event.MissionID));
        commander.missions.delete(String(event.MissionID));
        this.#record({
          kind: 'mission',
          at,
          system,
          outcome: event.event === 'MissionFailed' ? 'failed' : 'abandoned',
          name: event.LocalisedName ?? mission?.name ?? event.Name,
          faction: mission?.faction,
        });
        return;
      }
      case 'Missions': {
        // The game's own list at login: anything else has gone while EDSSI wasn't looking.
        const active = new Set(event.Active.map((mission) => String(mission.MissionID)));
        for (const id of commander.missions.keys()) {
          if (!active.has(id)) commander.missions.delete(id);
        }
        return;
      }
      default:
        return;
    }
  }

  #arrive(
    name: string,
    address: number | bigint,
    position: [number, number, number] | undefined,
    at: number,
  ): void {
    const commander = this.#commander;
    this.#system = name;
    commander.visited.add(String(address));
    if (!position) return;
    commander.position = position;
    const ly = fromSol(position);
    if (!commander.farthestFromSol || ly > commander.farthestFromSol.ly) {
      commander.farthestFromSol = { ly, system: name, at };
    }
  }

  #scan(event: Extract<JournalEvent, { event: 'Scan' }>, at: number): void {
    // Belt clusters are worth nothing.
    if (event.StarType === undefined && event.PlanetClass === undefined) return;
    const key = `${String(event.SystemAddress)}:${event.BodyID}`;
    this.#names.set(key, event.BodyName);
    // A body is scanned again whenever the commander comes back; only the first scan is news.
    if (this.#scanned.has(key)) return;
    const wasDiscovered: boolean | undefined = event.WasDiscovered;
    const input = {
      starType: event.StarType,
      planetClass: event.PlanetClass,
      terraformState: event.TerraformState,
      stellarMass: event.StellarMass,
      massEM: event.MassEM,
      wasDiscovered: event.WasDiscovered,
      wasMapped: event.WasMapped,
      odyssey: this.#odyssey,
    };
    const body: ScannedBody = {
      unmapped: estimateBodyValue({ ...input, mapped: false, mappedEfficiently: false }),
      mapped: estimateBodyValue({ ...input, mapped: true, mappedEfficiently: false }),
      mappedEfficiently: estimateBodyValue({ ...input, mapped: true, mappedEfficiently: true }),
      firstFootfall: event.WasFootfalled === false,
    };
    this.#scanned.set(key, body);
    this.#record({
      kind: 'scan',
      at,
      system: event.StarSystem ?? this.#system,
      body: event.BodyName,
      bodyType: event.StarType === undefined ? event.PlanetClass! : `class ${event.StarType} star`,
      star: event.StarType !== undefined,
      value: body.unmapped,
      // Journals from before 3.3 don't say, which isn't the same as nobody having been there.
      firstDiscovery: wasDiscovered !== undefined && !wasDiscovered,
      terraformable: isTerraformable(event.TerraformState),
      landable: event.Landable === true,
    });
  }

  #bodyName(address: number | bigint, bodyId: number): string {
    return (
      this.#names.get(`${String(address)}:${bodyId}`) ?? `${this.#system ?? 'body'} #${bodyId}`
    );
  }

  #earn(
    at: number,
    source: EarnSource,
    amount: number,
    detail?: string,
    extra: { profit?: number } = {},
  ): void {
    if (!(amount > 0)) return;
    this.#record({ kind: 'earn', at, system: this.#system, source, amount, detail, ...extra });
  }

  #spend(at: number, source: SpendSource, amount: number, detail?: string): void {
    if (!(amount > 0)) return;
    this.#record({ kind: 'spend', at, system: this.#system, source, amount, detail });
  }

  #commanderFor(fid: string, name?: string): CommanderActivity {
    let commander = this.#commanders.get(fid);
    if (!commander) {
      // The events before the first Commander line belong to whoever it turns out to be.
      const anonymous = this.#commanders.get('');
      if (fid !== '' && anonymous && this.#commanders.size === 1) {
        this.#commanders.delete('');
        commander = anonymous;
      } else {
        commander = { records: [], spans: [], visited: new Set(), missions: new Map() };
      }
      this.#commanders.set(fid, commander);
    }
    if (name) commander.name = name;
    return commander;
  }
}

/** Sol sits at the origin of the galaxy's coordinates. */
export function fromSol([x, y, z]: readonly [number, number, number]): number {
  return Math.hypot(x, y, z);
}
