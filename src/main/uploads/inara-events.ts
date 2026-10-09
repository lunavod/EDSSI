import type { JournalEvent, JournalEventMap } from '../../shared/journal';
import type { GameState } from './game-state';

/**
 * Inara doesn't read the journal: it has its own events (`addCommanderTravelFSDJump`,
 * `setCommanderCredits`, …), documented at inara.cz/elite/inara-api-docs. This turns journal
 * lines into those. What is sent, and when, follows EDMarketConnector's Inara plugin, which Inara's
 * own guide points to.
 */
export interface InaraEvent {
  eventName: string;
  eventTimestamp: string;
  eventData: unknown;
}

/** Travel is what a commander looks for on Inara, so it goes out without waiting for company. */
const URGENT = new Set([
  'addCommanderTravelFSDJump',
  'addCommanderTravelCarrierJump',
  'addCommanderTravelDock',
]);

export function isUrgentForInara(event: InaraEvent): boolean {
  return URGENT.has(event.eventName);
}

/** The engineer stages Inara knows; the journal also says `Known`, which it doesn't take. */
const ENGINEER_STAGES = new Set(['Invited', 'Acquainted', 'Unlocked', 'Barred']);

const PILOT_RANKS = [
  'Combat',
  'Trade',
  'Explore',
  'Soldier',
  'Exobiologist',
  'CQC',
  'Federation',
  'Empire',
] as const;

type RankName = (typeof PILOT_RANKS)[number];

/**
 * Remembers what it takes to turn the next line into Inara events: the ranks written just before
 * their progress, what was last sent for things that are re-sent whole (cargo, materials, loadout),
 * and which `Docked` lines don't mean a new arrival.
 */
export class InaraTranslator {
  #ranks: Partial<Record<RankName, number>> = {};
  #lastCargo: string | undefined;
  #lastMaterials: string | undefined;
  #lastLoadout: string | undefined;
  #lastLocker: string | undefined;
  #friends = new Set<string>();
  /** The game writes Docked after these without the commander having flown anywhere. */
  #suppressDocked = false;
  /** Undocked and not yet left: docking again at the same station isn't a trip. */
  #undocked = false;

  translate(event: JournalEvent, state: GameState): InaraEvent[] {
    const out: InaraEvent[] = [];
    const add = (eventName: string, eventData: unknown) =>
      out.push({ eventName, eventTimestamp: event.timestamp, eventData });

    switch (event.event) {
      case 'Fileheader':
        this.#ranks = {};
        this.#lastCargo = undefined;
        this.#lastMaterials = undefined;
        this.#lastLoadout = undefined;
        this.#lastLocker = undefined;
        this.#friends.clear();
        this.#suppressDocked = false;
        this.#undocked = false;
        break;

      case 'LoadGame':
        if (typeof event.Credits === 'number') {
          add('setCommanderCredits', {
            commanderCredits: event.Credits,
            ...(typeof event.Loan === 'number' && { commanderLoan: event.Loan }),
          });
        }
        break;

      case 'Statistics': {
        const { event: _name, timestamp: _at, ...statistics } = event;
        add('setCommanderGameStatistics', statistics);
        break;
      }

      case 'Rank':
        this.#ranks = pick(event, PILOT_RANKS);
        break;

      case 'Progress': {
        // Always written right after Rank, so both halves are known here.
        const progress = pick(event, PILOT_RANKS);
        const ranks = PILOT_RANKS.filter((name) => this.#ranks[name] !== undefined).map((name) => ({
          rankName: name.toLowerCase(),
          rankValue: this.#ranks[name],
          rankProgress: (progress[name] ?? 0) / 100,
        }));
        if (ranks.length > 0) add('setCommanderRankPilot', ranks);
        break;
      }

      case 'Promotion':
        for (const [name, value] of Object.entries(pick(event, PILOT_RANKS))) {
          add('setCommanderRankPilot', {
            rankName: name.toLowerCase(),
            rankValue: value,
            rankProgress: 0,
          });
        }
        break;

      case 'Reputation': {
        const factions = (['Federation', 'Empire', 'Alliance', 'Independent'] as const)
          .filter((name) => typeof event[name] === 'number')
          .map((name) => ({
            majorfactionName: name.toLowerCase(),
            majorfactionReputation: event[name]! / 100,
          }));
        if (factions.length > 0) add('setCommanderReputationMajorFaction', factions);
        break;
      }

      case 'EngineerProgress': {
        const engineers = (event.Engineers ?? [event])
          .filter((engineer) => engineer.Engineer && ENGINEER_STAGES.has(engineer.Progress ?? ''))
          .map((engineer) =>
            definedOnly({
              engineerName: engineer.Engineer,
              rankStage: engineer.Progress,
              rankValue: engineer.Rank,
            }),
          );
        if (engineers.length > 0) add('setCommanderRankEngineer', engineers);
        break;
      }

      case 'Powerplay':
        add('setCommanderRankPower', {
          powerName: event.Power,
          rankValue: event.Rank,
          meritsValue: event.Merits,
        });
        break;

      case 'Location': {
        if (event.Docked) this.#suppressDocked = true;
        const location: Record<string, unknown> = {
          starsystemName: event.StarSystem,
          starsystemCoords: event.StarPos,
        };
        if (event.Docked) {
          location['stationName'] = event.StationName;
          location['marketID'] = event.MarketID;
          if (event.BodyType === 'Planet') location['starsystemBodyName'] = event.Body;
        }
        if ('Latitude' in event && 'Longitude' in event) {
          location['starsystemBodyName'] = event.Body;
          location['starsystemBodyCoords'] = [event.Latitude, event.Longitude];
        }
        add('setCommanderTravelLocation', location);
        break;
      }

      case 'FSDJump':
        this.#undocked = false;
        add('addCommanderTravelFSDJump', {
          starsystemName: event.StarSystem,
          starsystemCoords: event.StarPos,
          jumpDistance: event.JumpDist,
          ...ship(state, event.Taxi),
        });
        addMinorFactions(add, event.Factions);
        break;

      case 'CarrierJump':
        this.#suppressDocked = true;
        if (event.StationName) {
          add('addCommanderTravelCarrierJump', {
            starsystemName: event.StarSystem,
            starsystemCoords: event.StarPos,
            stationName: event.StationName,
            marketID: event.MarketID,
            ...ship(state, false),
          });
        }
        addMinorFactions(add, event.Factions);
        break;

      case 'Docked':
        if (this.#undocked) {
          this.#undocked = false;
        } else if (this.#suppressDocked) {
          this.#suppressDocked = false;
        } else if (state.systemName) {
          add('addCommanderTravelDock', {
            starsystemName: state.systemName,
            ...(state.coordinates && { starsystemCoords: state.coordinates }),
            stationName: event.StationName,
            ...(event.MarketID !== undefined && { marketID: event.MarketID }),
            ...ship(state, event.Taxi),
          });
        }
        break;

      case 'Undocked':
        this.#undocked = true;
        break;

      case 'SupercruiseEntry':
        this.#undocked = false;
        break;

      case 'SupercruiseExit':
        add('setCommanderTravelLocation', {
          starsystemName: event.StarSystem,
          ...(state.coordinates && { starsystemCoords: state.coordinates }),
          ...(event.BodyType === 'Planet' && { starsystemBodyName: event.Body }),
        });
        break;

      case 'ApproachSettlement':
        if (state.systemName) {
          add('setCommanderTravelLocation', {
            starsystemName: state.systemName,
            ...(state.coordinates && { starsystemCoords: state.coordinates }),
            stationName: event.Name,
            ...(event.MarketID !== undefined && { marketID: event.MarketID }),
            starsystemBodyName: event.BodyName,
            ...(event.Latitude !== undefined &&
              event.Longitude !== undefined && {
                starsystemBodyCoords: [event.Latitude, event.Longitude],
              }),
          });
        }
        break;

      case 'Touchdown': {
        // Only the commander's own landings on a planet; a recalled ship lands itself.
        const system = event.StarSystem ?? state.systemName;
        if (!event.PlayerControlled || event.OnPlanet === false || !system || !event.Body) break;
        add('addCommanderTravelLand', {
          starsystemName: system,
          ...(state.coordinates && { starsystemCoords: state.coordinates }),
          starsystemBodyName: event.Body,
          ...(event.Latitude !== undefined &&
            event.Longitude !== undefined && {
              starsystemBodyCoords: [event.Latitude, event.Longitude],
            }),
          ...ship(state, event.Taxi),
        });
        break;
      }

      case 'Loadout':
        this.#loadout(event, state, add);
        break;

      case 'ShipyardNew':
        this.#suppressDocked = true;
        add('addCommanderShip', { shipType: event.ShipType, shipGameID: event.NewShipID });
        break;

      case 'ShipyardSwap':
        this.#suppressDocked = true;
        storedShip(add, state, event.StoreOldShip, event.StoreShipID);
        break;

      case 'ShipyardBuy':
        storedShip(add, state, event.StoreOldShip, event.StoreShipID);
        if (event.SellShipID !== undefined) {
          add('delCommanderShip', {
            shipType: event.SellOldShip ?? event.ShipType,
            shipGameID: event.SellShipID,
          });
        }
        break;

      case 'ShipyardSell':
        add('delCommanderShip', { shipType: event.ShipType, shipGameID: event.SellShipID });
        break;

      case 'SellShipOnRebuy':
        add('delCommanderShip', { shipType: event.ShipType, shipGameID: event.SellShipId });
        break;

      case 'SetUserShipName':
        add('setCommanderShip', {
          shipType: event.Ship,
          shipGameID: event.ShipID,
          shipName: event.UserShipName,
          ...(event.UserShipId !== undefined && { shipIdent: event.UserShipId }),
          isCurrentShip: event.ShipID === state.shipId,
        });
        break;

      case 'ShipyardTransfer':
        add('setCommanderShipTransfer', {
          shipType: event.ShipType,
          shipGameID: event.ShipID,
          starsystemName: state.systemName,
          stationName: state.stationName,
          ...(event.MarketID !== undefined && { marketID: event.MarketID }),
          transferTime: event.TransferTime,
        });
        break;

      case 'Cargo': {
        // Only the ship's hold, and only when the line lists it (see edsmEntry).
        if (event.Vessel !== 'Ship' || !Array.isArray(event.Inventory)) break;
        const counts = new Map<string, number>();
        for (const item of event.Inventory) {
          counts.set(item.Name, (counts.get(item.Name) ?? 0) + item.Count);
        }
        const cargo = [...counts]
          .toSorted(([a], [b]) => a.localeCompare(b))
          .map(([itemName, itemCount]) => ({ itemName, itemCount }));
        const key = JSON.stringify(cargo);
        if (key !== this.#lastCargo) {
          this.#lastCargo = key;
          add('setCommanderInventoryCargo', cargo);
        }
        break;
      }

      case 'Materials': {
        const materials = [
          ...(event.Raw ?? []),
          ...(event.Manufactured ?? []),
          ...(event.Encoded ?? []),
        ]
          .map((item) => ({ itemName: item.Name, itemCount: item.Count }))
          .toSorted((a, b) => a.itemName.localeCompare(b.itemName));
        const key = JSON.stringify(materials);
        if (key !== this.#lastMaterials) {
          this.#lastMaterials = key;
          add('setCommanderInventoryMaterials', materials);
        }
        break;
      }

      case 'ShipLocker': {
        const kinds = ['Items', 'Components', 'Data', 'Consumables'] as const;
        // Often only a pointer to ShipLocker.json; a partial line would wipe the rest on Inara.
        if (!kinds.every((kind) => Array.isArray(event[kind]))) break;
        const inventory = kinds.flatMap((itemType) =>
          (event[itemType] ?? []).map((item) => ({
            itemName: item.Name,
            itemCount: item.Count,
            itemType,
          })),
        );
        // The game writes the whole locker after every jump; only a change is worth sending.
        const key = JSON.stringify(inventory);
        if (key === this.#lastLocker) break;
        this.#lastLocker = key;
        add(
          'resetCommanderInventory',
          kinds.map((itemType) => ({ itemType })),
        );
        add('setCommanderInventory', inventory);
        break;
      }

      case 'MissionAccepted': {
        const optional = {
          missionExpiry: event.Expiry,
          starsystemNameTarget: event.DestinationSystem,
          stationNameTarget: event.DestinationStation,
          minorfactionNameTarget: event.TargetFaction,
          commodityName: event.Commodity,
          commodityCount: event.Count,
          targetName: event.Target,
          targetType: event.TargetType,
          killCount: event.KillCount,
          passengerType: event.PassengerType,
          passengerCount: event.PassengerCount,
          passengerIsVIP: event.PassengerVIPs,
          passengerIsWanted: event.PassengerWanted,
        };
        add('addCommanderMission', {
          missionName: event.Name,
          missionGameID: event.MissionID,
          influenceGain: event.Influence,
          reputationGain: event.Reputation,
          starsystemNameOrigin: state.systemName,
          stationNameOrigin: state.stationName,
          minorfactionNameOrigin: event.Faction,
          ...definedOnly(optional),
        });
        break;
      }

      case 'MissionAbandoned':
        add('setCommanderMissionAbandoned', { missionGameID: event.MissionID });
        break;

      case 'MissionFailed':
        add('setCommanderMissionFailed', { missionGameID: event.MissionID });
        break;

      case 'MissionCompleted': {
        const permits = event.PermitsAwarded ?? [];
        for (const system of permits) add('addCommanderPermit', { starsystemName: system });
        const effects = (event.FactionEffects ?? []).map((faction) => {
          // The largest gain across the systems it touched, as `+`s.
          const influence = (faction.Influence ?? [])
            .map((entry) => entry.Influence ?? '')
            .reduce((best, gain) => (gain.length > best.length ? gain : best), '');
          return definedOnly({
            minorfactionName: faction.Faction,
            influenceGain: influence || undefined,
            reputationGain: faction.Reputation || undefined,
          });
        });
        add('setCommanderMissionCompleted', {
          missionGameID: event.MissionID,
          ...(event.Donated !== undefined && { donationCredits: event.Donated }),
          ...(event.Reward !== undefined && { rewardCredits: event.Reward }),
          ...(permits.length > 0 && {
            rewardPermits: permits.map((system) => ({ starsystemName: system })),
          }),
          ...(event.CommodityReward && {
            rewardCommodities: event.CommodityReward.map((item) => ({
              itemName: item.Name,
              itemCount: item.Count,
            })),
          }),
          ...(event.MaterialsReward && {
            rewardMaterials: event.MaterialsReward.map((item) => ({
              itemName: item.Name,
              itemCount: item.Count,
            })),
          }),
          ...(effects.length > 0 && { minorfactionEffects: effects }),
        });
        break;
      }

      case 'Died': {
        if (!state.systemName) break;
        const wing = (event.Killers ?? []).map((killer) => killer.KillerName).filter(Boolean);
        const single = event.KillerName || event.KillerShip;
        if (wing.length > 0) {
          add('addCommanderCombatDeath', {
            starsystemName: state.systemName,
            wingOpponentNames: wing,
          });
        } else if (single) {
          add('addCommanderCombatDeath', {
            starsystemName: state.systemName,
            opponentName: single,
          });
        }
        break;
      }

      case 'Interdicted': {
        const opponent = opponentOf(
          event.Interdictor,
          event.Faction,
          event.Power,
          event.IsThargoid,
        );
        if (!state.systemName || !opponent) break;
        add('addCommanderCombatInterdicted', {
          starsystemName: state.systemName,
          opponentName: opponent,
          isPlayer: event.IsPlayer,
          isSubmit: event.Submitted,
        });
        break;
      }

      case 'Interdiction': {
        const opponent = opponentOf(event.Interdicted, event.Faction, event.Power);
        if (!state.systemName || !opponent) break;
        add('addCommanderCombatInterdiction', {
          starsystemName: state.systemName,
          opponentName: opponent,
          isPlayer: event.IsPlayer,
          isSuccess: event.Success,
        });
        break;
      }

      case 'EscapeInterdiction': {
        const opponent = opponentOf(event.Interdictor, undefined, undefined, event.IsThargoid);
        if (!state.systemName || !opponent) break;
        add('addCommanderCombatInterdictionEscape', {
          starsystemName: state.systemName,
          opponentName: opponent,
          isPlayer: event.IsPlayer,
        });
        break;
      }

      case 'PVPKill':
        if (state.systemName) {
          add('addCommanderCombatKill', {
            starsystemName: state.systemName,
            opponentName: event.Victim,
          });
        }
        break;

      case 'CommunityGoal':
        for (const goal of event.CurrentGoals ?? []) {
          add('setCommunityGoal', {
            communitygoalGameID: goal.CGID,
            communitygoalName: goal.Title,
            starsystemName: goal.SystemName,
            stationName: goal.MarketName,
            goalExpiry: goal.Expiry,
            isCompleted: goal.IsComplete,
            contributorsNum: goal.NumContributors,
            contributionsTotal: goal.CurrentTotal,
            ...definedOnly({
              tierReached: tierNumber(goal.TierReached),
              tierMax: tierNumber(goal.TopTier?.Name),
              completionBonus: goal.TopTier?.Bonus,
              topRankSize: goal.TopRankSize,
            }),
          });
          add('setCommanderCommunityGoalProgress', {
            communitygoalGameID: goal.CGID,
            contribution: goal.PlayerContribution,
            percentileBand: goal.PlayerPercentileBand,
            ...definedOnly({ percentileBandReward: goal.Bonus, isTopRank: goal.PlayerInTopRank }),
          });
        }
        break;

      case 'Friends': {
        const added = event.Status === 'Added' || event.Status === 'Online';
        const removed = event.Status === 'Declined' || event.Status === 'Lost';
        const key = `${added ? '+' : '-'}${event.Name}`;
        // A friend who comes online is announced every login; once a session is plenty.
        if ((!added && !removed) || this.#friends.has(key)) break;
        this.#friends.add(key);
        add(added ? 'addCommanderFriend' : 'delCommanderFriend', {
          commanderName: event.Name,
          gamePlatform: 'pc',
        });
        break;
      }

      default:
        break;
    }
    return out;
  }

  #loadout(
    event: JournalEventMap['Loadout'],
    state: GameState,
    add: (name: string, data: unknown) => void,
  ): void {
    if (typeof event.ShipID !== 'number' || !event.Ship) return;
    const shipType = event.Ship.toLowerCase();
    add('setCommanderShip', {
      shipType,
      shipGameID: event.ShipID,
      shipName: event.ShipName,
      shipIdent: event.ShipIdent,
      isCurrentShip: true,
      ...definedOnly({
        isHot: event.Hot,
        shipHullValue: event.HullValue,
        shipModulesValue: event.ModulesValue,
        shipRebuyCost: event.Rebuy,
        shipMaxJumpRange: event.MaxJumpRange,
        shipCargoCapacity: event.CargoCapacity,
      }),
      ...(state.stationName && { stationName: state.stationName }),
      ...(state.systemName && { starsystemName: state.systemName }),
    });

    const loadout = {
      shipType,
      shipGameID: event.ShipID,
      shipLoadout: (event.Modules ?? []).map((module) =>
        definedOnly({
          slotName: module.Slot,
          itemName: module.Item,
          itemHealth: module.Health,
          isOn: module.On,
          itemPriority: module.Priority,
          itemAmmoClip: module.AmmoInClip,
          itemAmmoHopper: module.AmmoInHopper,
          itemValue: module.Value,
          engineering: module.Engineering && {
            blueprintName: module.Engineering.BlueprintName,
            blueprintLevel: module.Engineering.Level,
            blueprintQuality: module.Engineering.Quality,
            experimentalEffect: module.Engineering.ExperimentalEffect,
            modifiers: (module.Engineering.Modifiers ?? []).map((modifier) =>
              modifier.OriginalValue !== undefined
                ? {
                    name: modifier.Label,
                    value: modifier.Value,
                    originalValue: modifier.OriginalValue,
                    lessIsGood: modifier.LessIsGood,
                  }
                : { name: modifier.Label, value: modifier.ValueStr },
            ),
          },
        }),
      ),
    };
    const key = JSON.stringify(loadout);
    if (key !== this.#lastLoadout) {
      this.#lastLoadout = key;
      add('setCommanderShipLoadout', loadout);
    }
  }
}

/** The ship a trip was flown in, or which kind of taxi carried the commander. */
function ship(state: GameState, taxi: boolean | undefined): Record<string, unknown> {
  if (taxi ?? state.taxi) return { isTaxiShuttle: true };
  return state.shipType !== undefined && state.shipId !== undefined
    ? { shipType: state.shipType, shipGameID: state.shipId }
    : {};
}

function storedShip(
  add: (name: string, data: unknown) => void,
  state: GameState,
  type: string | undefined,
  id: number | undefined,
): void {
  if (!type || id === undefined) return;
  add('setCommanderShip', {
    shipType: type,
    shipGameID: id,
    ...(state.systemName && { starsystemName: state.systemName }),
    ...(state.stationName && { stationName: state.stationName }),
    ...(state.marketId !== undefined && { marketID: state.marketId }),
  });
}

function addMinorFactions(
  add: (name: string, data: unknown) => void,
  factions: readonly { Name: string; MyReputation: number }[] | undefined,
): void {
  const reputations = (factions ?? [])
    .filter((faction) => typeof faction.MyReputation === 'number')
    .map((faction) => ({
      minorfactionName: faction.Name,
      minorfactionReputation: faction.MyReputation / 100,
    }));
  if (reputations.length > 0) add('setCommanderReputationMinorFaction', reputations);
}

function opponentOf(
  name: string | undefined,
  faction: string | undefined,
  power: string | undefined,
  thargoid?: boolean,
): string | undefined {
  return name || faction || power || (thargoid ? 'Thargoid' : undefined);
}

/** `Tier 3` → 3. */
function tierNumber(name: string | undefined): number | undefined {
  const number = Number.parseInt(name?.split(' ').at(-1) ?? '', 10);
  return Number.isFinite(number) ? number : undefined;
}

function pick<K extends string>(source: object, keys: readonly K[]): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const key of keys) {
    const value: unknown = Reflect.get(source, key);
    if (typeof value === 'number') out[key] = value;
  }
  return out;
}

function definedOnly(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}
