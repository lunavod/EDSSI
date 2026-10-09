import type { JournalEvent, JournalEventMap, JournalEventName } from '../../../shared/journal';
import { formatNumber, humanizeEvent, humanizeField, isGameSymbol } from './format';

export type Category =
  | 'travel'
  | 'station'
  | 'exploration'
  | 'trade'
  | 'missions'
  | 'combat'
  | 'engineering'
  | 'social'
  | 'session'
  | 'background'
  | 'other';

export const CATEGORIES: readonly { id: Category; label: string }[] = [
  { id: 'travel', label: 'Travel' },
  { id: 'station', label: 'Station & ship' },
  { id: 'exploration', label: 'Exploration' },
  { id: 'trade', label: 'Trade & mining' },
  { id: 'missions', label: 'Missions' },
  { id: 'combat', label: 'Combat & crime' },
  { id: 'engineering', label: 'Materials & engineering' },
  { id: 'social', label: 'Comms & crew' },
  { id: 'session', label: 'Session' },
  { id: 'background', label: 'Background' },
  { id: 'other', label: 'Other' },
];

/** Chatter like music changes and wage payments; shown only when asked for. */
export const HIDDEN_BY_DEFAULT: readonly Category[] = ['background'];

/** First match wins, so the more specific rules come first. */
const CATEGORY_RULES: readonly [RegExp, Category][] = [
  [
    /^(Music|ReservoirReplenished|NpcCrewPaidWage|Screenshot|NavRouteClear|FSSSignalDiscovered)$/,
    'background',
  ],
  [
    /^(Fileheader|LoadGame|Commander|NewCommander|ClearSavedGame|Shutdown|GameModeChange|Continued|Rank|Progress|Reputation|Statistics|Missions|Loadout|Promotion|Status)$/,
    'session',
  ],
  [
    /^(Mission|CommunityGoal|Colonisation|CompleteConstruction|Powerplay|CargoDepot|Passengers)/,
    'missions',
  ],
  [
    /^(Engineer|Material|Synthesis|TechnologyBroker|Backpack|ShipLocker|FCMaterials|BuyMicroResources|SellMicroResources|TradeMicroResources|TransferMicroResources|CollectItems|DropItems|UseConsumable|UpgradeSuit|UpgradeWeapon|DeliverPowerMicroResources|RequestPowerMicroResources)/,
    'engineering',
  ],
  [
    /^(Docked|Undocked|Docking|Module|Shipyard|Outfitting|Stored|FetchRemoteModule|MassModuleStore|Carrier(?!Jump)|Refuel|Repair|BuyAmmo|RestockVehicle|Resupply|BuyDrones|SellDrones|SetUserShipName|BuySuit|SellSuit|BuyWeapon|SellWeapon|CreateSuitLoadout|DeleteSuitLoadout|RenameSuitLoadout|SwitchSuitLoadout|SuitLoadout|AfmuRepairs|RebootRepair|RepairDrone)/,
    'station',
  ],
  [
    /^(ReceiveText|SendText|Friends|Wing|Crew|Npc|JoinACrew|QuitACrew|KickCrewMember|EndCrewSession|ChangeCrewRole|.*Squadron)/,
    'social',
  ],
  [
    /^(FSS|SAA|Scan(?!ned)|Codex|DiscoveryScan|NavBeaconScan|SellExplorationData|MultiSellExplorationData|SellOrganicData|DatalinkScan|DataScanned|ScientificResearch|BuyExplorationData)/,
    'exploration',
  ],
  [
    /^(Supercruise|FSD|StartJump|NavRoute|Approach|LeaveBody|Touchdown|Liftoff|Location|CarrierJump|JetCone|USSDrop|BookTaxi|CancelTaxi|BookDropship|CancelDropship|DropshipDeploy|Embark|Disembark|LaunchSRV|DockSRV|SRVDestroyed|LaunchFighter|DockFighter|FighterRebuilt|VehicleSwitch|FuelScoop)/,
    'travel',
  ],
  [
    /^(Market|Cargo$|CollectCargo|EjectCargo|Mining|ProspectedAsteroid|AsteroidCracked|CargoTransfer|BuyTradeData|LaunchDrone)/,
    'trade',
  ],
  [
    /^(Bounty|Died|Interdict|EscapeInterdiction|ShipTargeted|UnderAttack|HullDamage|ShieldState|FactionKillBond|CapShipBond|PVPKill|CommitCrime|CrimeVictim|PayFines|PayBounties|RedeemVoucher|Scanned|Heat|CockpitBreached|SystemsShutdown|FighterDestroyed|Resurrect|SelfDestruct|HoloscreenHacked|ClearImpound|SellShipOnRebuy)/,
    'combat',
  ],
];

export function categoryOf(eventName: string): Category {
  return CATEGORY_RULES.find(([rule]) => rule.test(eventName))?.[1] ?? 'other';
}

type Summarizer<N extends JournalEventName> = (event: JournalEventMap[N]) => string | undefined;

type Part = string | number | false | null | undefined;

/** Joins the parts that exist with " · ". */
export function join(...parts: Part[]): string | undefined {
  const present = parts.filter(
    (part) => part !== false && part !== null && part !== undefined && part !== '',
  );
  return present.length > 0 ? present.join(' · ') : undefined;
}

const cr = (value: number) => `${formatNumber(value, 0)} CR`;
const countOf = (items: { Count: number }[] | undefined) =>
  items?.reduce((sum, item) => sum + item.Count, 0) ?? 0;
const num = (value: number, digits = 2) => formatNumber(value, digits);

/** Localised text if the game gave any, else the raw value unless it's an internal symbol. */
function text(raw: string | undefined, localised?: string): string | undefined {
  if (localised) return localised;
  return raw && !isGameSymbol(raw) ? raw : undefined;
}

const SUMMARIES: { [N in JournalEventName]?: Summarizer<N> } = {
  // Travel
  FSDJump: (e) =>
    join(
      `Jumped to ${e.StarSystem}`,
      `${num(e.JumpDist)} ly`,
      e.FuelUsed >= 0.01 && `${num(e.FuelUsed)} t fuel`,
    ),
  StartJump: (e) =>
    e.JumpType === 'Hyperspace'
      ? join(
          `Charging jump to ${e.StarSystem ?? 'unknown system'}`,
          e.StarClass && `class ${e.StarClass}`,
        )
      : 'Entering supercruise',
  FSDTarget: (e) =>
    join(
      `Target ${e.Name}`,
      `class ${e.StarClass}`,
      e.RemainingJumpsInRoute !== undefined && `${e.RemainingJumpsInRoute} jumps left`,
    ),
  SupercruiseEntry: (e) => `Supercruise in ${e.StarSystem}`,
  SupercruiseExit: (e) => join(`Dropped near ${e.Body}`, humanizeField(e.BodyType)),
  SupercruiseDestinationDrop: (e) =>
    join(
      `Dropped at ${text(e.Type, e.Type_Localised) ?? 'destination'}`,
      e.Threat > 0 && `threat ${e.Threat}`,
    ),
  Location: (e) =>
    join(
      e.StarSystem,
      e.Docked && e.StationName
        ? `docked at ${text(e.StationName, e.StationName_Localised)}`
        : e.Body !== e.StarSystem && `near ${e.Body}`,
    ),
  CarrierJump: (e) => `Carrier jumped to ${e.StarSystem}`,
  ApproachBody: (e) => `Approaching ${e.Body}`,
  LeaveBody: (e) => `Leaving ${e.Body}`,
  ApproachSettlement: (e) => `Approaching ${text(e.Name, e.Name_Localised)} on ${e.BodyName}`,
  Touchdown: (e) =>
    join(
      'Landed',
      e.Body && `on ${e.Body}`,
      text(e.NearestDestination, e.NearestDestination_Localised),
    ),
  Liftoff: (e) =>
    join('Lifted off', e.Body && `from ${e.Body}`, !e.PlayerControlled && 'ship left on its own'),
  // The journal line never lists the systems; route-notes.ts adds them from the recorded route.
  NavRoute: () => 'Route plotted',
  NavRouteClear: () => 'Route cleared',
  FuelScoop: (e) => `+${num(e.Scooped)} t, tank at ${num(e.Total)} t`,
  JetConeBoost: (e) => `FSD boost ×${num(e.BoostValue)}`,
  USSDrop: (e) => join(text(e.USSType, e.USSType_Localised), `threat ${e.USSThreat}`),
  LaunchSRV: (e) => `Deployed ${text(e.SRVType, e.SRVType_Localised) ?? 'SRV'}`,
  DockSRV: (e) => `Recovered ${text(e.SRVType, e.SRVType_Localised) ?? 'SRV'}`,
  LaunchFighter: (e) => `Launched ${text(e.FighterType, e.FighterType_Localised) ?? 'fighter'}`,
  Embark: (e) =>
    join(`Boarded ${e.SRV ? 'SRV' : e.Taxi ? 'taxi' : 'ship'}`, e.StationName ?? e.Body),
  Disembark: (e) =>
    join(`Left ${e.SRV ? 'SRV' : e.Taxi ? 'taxi' : 'ship'}`, e.StationName ?? e.Body),

  // Station & ship
  Docked: (e) =>
    join(
      `Docked at ${text(e.StationName, e.StationName_Localised)}`,
      humanizeEvent(e.StationType),
      e.StarSystem,
      `${num(e.DistFromStarLS, 0)} ls from star`,
    ),
  Undocked: (e) => `Left ${text(e.StationName, e.StationName_Localised)}`,
  DockingRequested: (e) => `Requested docking at ${text(e.StationName, e.StationName_Localised)}`,
  DockingGranted: (e) => `Pad ${e.LandingPad} at ${text(e.StationName, e.StationName_Localised)}`,
  DockingDenied: (e) =>
    `Denied at ${text(e.StationName, e.StationName_Localised)}: ${humanizeField(e.Reason)}`,
  RefuelAll: (e) => `${num(e.Amount)} t for ${cr(e.Cost)}`,
  RefuelPartial: (e) => `${num(e.Amount)} t for ${cr(e.Cost)}`,
  RepairAll: (e) => `Repaired for ${cr(e.Cost)}`,
  Repair: (e) => join(text(e.Item), cr(e.Cost)),
  BuyAmmo: (e) => `Rearmed for ${cr(e.Cost)}`,
  ModuleBuy: (e) => `Bought ${text(e.BuyItem, e.BuyItem_Localised)} for ${cr(e.BuyPrice)}`,
  ModuleSell: (e) => `Sold ${text(e.SellItem, e.SellItem_Localised)} for ${cr(e.SellPrice)}`,
  ModuleStore: (e) => `Stored ${text(e.StoredItem, e.StoredItem_Localised)}`,
  ModuleRetrieve: (e) => `Retrieved ${text(e.RetrievedItem, e.RetrievedItem_Localised)}`,
  ShipyardBuy: (e) => `Bought ${text(e.ShipType, e.ShipType_Localised)} for ${cr(e.ShipPrice)}`,
  ShipyardSwap: (e) => `Switched to ${text(e.ShipType, e.ShipType_Localised)}`,
  ShipyardNew: (e) => `New ship: ${text(e.ShipType, e.ShipType_Localised)}`,
  ShipyardSell: (e) => `Sold ${text(e.ShipType, e.ShipType_Localised)} for ${cr(e.ShipPrice)}`,
  StoredShips: (e) => `${e.ShipsHere.length} ships here, ${e.ShipsRemote.length} elsewhere`,
  Outfitting: (e) => `Outfitting at ${e.StationName}`,
  Shipyard: (e) => `Shipyard at ${e.StationName}`,

  // Exploration
  Scan: (e) =>
    join(
      e.BodyName,
      e.StarType ? `class ${e.StarType}${e.Subclass ?? ''} star` : e.PlanetClass,
      e.Landable && 'landable',
      e.TerraformState && e.TerraformState.toLowerCase(),
      !e.WasDiscovered && 'first discovery',
      `${num(e.DistanceFromArrivalLS, 0)} ls`,
    ),
  FSSDiscoveryScan: (e) =>
    join(
      `${e.BodyCount} bodies`,
      `${e.NonBodyCount} signals`,
      `${num(e.Progress * 100, 0)} % scanned`,
    ),
  FSSSignalDiscovered: (e) =>
    join(
      text(e.SignalName, e.SignalName_Localised) ?? 'Unknown signal',
      e.SignalType && humanizeEvent(e.SignalType),
      text(e.USSType, e.USSType_Localised),
      e.ThreatLevel !== undefined && e.ThreatLevel > 0 && `threat ${e.ThreatLevel}`,
    ),
  FSSAllBodiesFound: (e) => `All ${e.Count} bodies found in ${e.SystemName}`,
  SAAScanComplete: (e) =>
    `Mapped ${e.BodyName} with ${e.ProbesUsed} probes (target ${e.EfficiencyTarget})`,
  SAASignalsFound: (e) =>
    `${e.BodyName}: ${e.Signals.map((s) => `${s.Count} ${text(s.Type, s.Type_Localised) ?? 'signal'}`).join(', ')}`,
  CodexEntry: (e) =>
    join(
      text(e.Name, e.Name_Localised),
      text(e.SubCategory, e.SubCategory_Localised),
      e.IsNewEntry && 'new entry',
    ),
  ScanOrganic: (e) => join(humanizeField(e.ScanType), text(e.Species, e.Species_Localised)),
  SellExplorationData: (e) => `Sold exploration data for ${cr(e.TotalEarnings)}`,
  MultiSellExplorationData: (e) => `Sold exploration data for ${cr(e.TotalEarnings)}`,

  // Trade & mining
  MarketBuy: (e) => `Bought ${e.Count} t ${text(e.Type, e.Type_Localised)} for ${cr(e.TotalCost)}`,
  MarketSell: (e) =>
    join(
      `Sold ${e.Count} t ${text(e.Type, e.Type_Localised)} for ${cr(e.TotalSale)}`,
      e.AvgPricePaid > 0 && `profit ${cr(e.TotalSale - e.AvgPricePaid * e.Count)}`,
    ),
  Cargo: (e) => `${e.Count} t in ${e.Vessel === 'Ship' ? 'ship' : e.Vessel}`,
  CollectCargo: (e) => join(`Scooped ${text(e.Type, e.Type_Localised)}`, e.Stolen && 'stolen'),
  EjectCargo: (e) => `Ejected ${e.Count} t ${text(e.Type, e.Type_Localised)}`,
  MiningRefined: (e) => `Refined ${text(e.Type, e.Type_Localised)}`,
  ProspectedAsteroid: (e) =>
    join(
      text(e.Content, e.Content_Localised),
      e.MotherlodeMaterial &&
        `motherlode: ${text(e.MotherlodeMaterial, e.MotherlodeMaterial_Localised)}`,
      e.Materials.map((m) => `${text(m.Name, m.Name_Localised)} ${num(m.Proportion, 1)} %`).join(
        ', ',
      ),
    ),
  Market: (e) => `Market at ${text(e.StationName, e.StationName_Localised)}`,

  // Missions
  MissionAccepted: (e) =>
    join(
      text(e.Name, e.LocalisedName),
      e.DestinationSystem &&
        `to ${e.DestinationSystem}${e.DestinationStation ? ` / ${e.DestinationStation}` : ''}`,
      e.Reward !== undefined && cr(e.Reward),
    ),
  MissionCompleted: (e) =>
    join(text(e.Name, e.LocalisedName), e.Reward !== undefined && cr(e.Reward)),
  MissionFailed: (e) => join(text(e.Name, e.LocalisedName), e.Fine && `fine ${cr(e.Fine)}`),
  MissionAbandoned: (e) => join(text(e.Name, e.LocalisedName), e.Fine && `fine ${cr(e.Fine)}`),
  CargoDepot: (e) =>
    join(
      humanizeField(e.UpdateType),
      text(e.CargoType, e.CargoType_Localised),
      `${e.ItemsDelivered}/${e.TotalItemsToDeliver} delivered`,
    ),
  Missions: (e) => `${e.Active.length} active missions`,
  ColonisationConstructionDepot: (e) =>
    join(
      `Construction ${num(e.ConstructionProgress * 100, 1)} %`,
      e.ConstructionComplete && 'complete',
      e.ConstructionFailed && 'failed',
    ),
  ColonisationContribution: (e) =>
    `Delivered ${e.Contributions.map((c) => `${c.Amount} t ${text(c.Name, c.Name_Localised)}`).join(', ')}`,

  // Materials & engineering
  MaterialCollected: (e) =>
    `+${e.Count} ${text(e.Name, e.Name_Localised)} (${e.Category.toLowerCase()})`,
  MaterialDiscovered: (e) => `Discovered ${text(e.Name, e.Name_Localised)}`,
  MaterialTrade: (e) =>
    `${e.Paid.Quantity} ${text(e.Paid.Material, e.Paid.Material_Localised)} → ${e.Received.Quantity} ${text(e.Received.Material, e.Received.Material_Localised)}`,
  EngineerCraft: (e) =>
    join(
      `${humanizeEvent(e.BlueprintName)} grade ${e.Level}`,
      e.Engineer,
      text(e.ExperimentalEffect, e.ExperimentalEffect_Localised),
    ),
  Synthesis: (e) => `Synthesised ${e.Name}`,
  // Without contents in the event, the full list is only in ShipLocker.json.
  ShipLocker: (e) =>
    e.Items === undefined
      ? 'Snapshot in ShipLocker.json'
      : (join(
          countOf(e.Items) > 0 && `${countOf(e.Items)} items`,
          countOf(e.Components) > 0 && `${countOf(e.Components)} components`,
          countOf(e.Consumables) > 0 && `${countOf(e.Consumables)} consumables`,
          countOf(e.Data) > 0 && `${countOf(e.Data)} data`,
        ) ?? 'Locker empty'),

  // Combat & crime
  Bounty: (e) =>
    join(
      text(e.Target, e.Target_Localised),
      text(e.VictimFaction, e.VictimFaction_Localised),
      cr(e.TotalReward ?? e.Reward ?? 0),
    ),
  Died: (e) => {
    const killer = text(e.KillerName, e.KillerName_Localised);
    if (killer) return `Killed by ${killer}`;
    return e.Killers ? `Killed by ${e.Killers.length} attackers` : 'Died';
  },
  Interdicted: (e) =>
    `${e.Submitted ? 'Submitted to' : 'Interdicted by'} ${text(e.Interdictor, e.Interdictor_Localised) ?? 'unknown'}${e.IsPlayer ? ' (CMDR)' : ''}`,
  EscapeInterdiction: (e) =>
    `Escaped ${text(e.Interdictor, e.Interdictor_Localised) ?? 'interdiction'}`,
  Interdiction: (e) =>
    `${e.Success ? 'Interdicted' : 'Failed to interdict'} ${text(e.Interdicted, e.Interdicted_Localised) ?? 'target'}`,
  ShipTargeted: (e) =>
    e.TargetLocked
      ? join(
          text(e.Ship, e.Ship_Localised) ?? 'Target locked',
          text(e.PilotName, e.PilotName_Localised),
          e.LegalStatus,
          e.Bounty && `bounty ${cr(e.Bounty)}`,
        )
      : 'Target lost',
  UnderAttack: (e) => (e.Target ? `${humanizeEvent(e.Target)} under attack` : 'Under attack'),
  HullDamage: (e) => `Hull at ${num(e.Health * 100, 0)} %`,
  ShieldState: (e) => (e.ShieldsUp ? 'Shields restored' : 'Shields down'),
  CommitCrime: (e) =>
    join(
      humanizeField(e.CrimeType),
      e.Faction,
      e.Fine && `fine ${cr(e.Fine)}`,
      e.Bounty && `bounty ${cr(e.Bounty)}`,
    ),
  PayFines: (e) => `Paid ${cr(e.Amount)} in fines`,
  RedeemVoucher: (e) => `Redeemed ${humanizeField(e.Type).toLowerCase()} voucher: ${cr(e.Amount)}`,
  Scanned: (e) => `Scanned by someone (${humanizeField(e.ScanType).toLowerCase()})`,
  Resurrect: (e) => join(`Rebuy option: ${e.Option}`, cr(e.Cost)),

  // Comms & crew
  ReceiveText: (e) => {
    const from = text(e.From, e.From_Localised);
    const message = text(e.Message, e.Message_Localised) ?? '';
    return from ? `${from}: ${message}` : message;
  },
  SendText: (e) => `To ${text(e.To, e.To_Localised) ?? e.To}: ${e.Message}`,
  Friends: (e) => `${e.Name} is ${e.Status.toLowerCase()}`,
  NpcCrewPaidWage: (e) => `${e.NpcCrewName} paid ${cr(e.Amount)}`,

  // Session
  Fileheader: (e) =>
    `Game ${e.gameversion} (${e.Odyssey ? 'Odyssey' : 'Horizons'}), log part ${e.part}`,
  LoadGame: (e) =>
    join(
      `CMDR ${e.Commander}`,
      e.ShipName || text(e.Ship, e.Ship_Localised),
      e.GameMode,
      cr(e.Credits),
    ),
  Commander: (e) => `CMDR ${e.Name}`,
  Shutdown: () => 'Game closed',
  GameModeChange: (e) => e.GameMode && humanizeEvent(e.GameMode),
  // Loadout only has the internal ship name (e.g. "explorer_nx"), so show the player's name, if any.
  Loadout: (e) =>
    join(e.ShipName, e.ShipIdent, `${num(e.MaxJumpRange)} ly jump range`, `rebuy ${cr(e.Rebuy)}`),
  Promotion: (e) =>
    Object.entries(e)
      .filter(([key]) => key !== 'timestamp' && key !== 'event')
      .map(([key, rank]) => `${key} rank ${String(rank)}`)
      .join(', '),

  // Background
  Music: (e) => humanizeEvent(e.MusicTrack),
  ReservoirReplenished: (e) =>
    `Main tank ${num(e.FuelMain)} t, reservoir ${num(e.FuelReservoir)} t`,
  Screenshot: (e) => join(`${e.Width}×${e.Height}`, e.Body ?? e.System),
};

/** Events that are only noise in some cases; those cases go to the background category. */
const BACKGROUND_WHEN: { [N in JournalEventName]?: (event: JournalEventMap[N]) => boolean } = {
  // NPC chatter. Messages from players stay in Comms & crew.
  ReceiveText: (e) => e.Channel === 'npc',
  // So little that it shows as "+0 t".
  FuelScoop: (e) => e.Scooped < 0.005,
};

export interface EventDescription {
  title: string;
  summary: string | undefined;
  category: Category;
}

const descriptions = new WeakMap<JournalEvent, EventDescription>();

/** Title, one-line summary and category of an event. Cached per event object. */
export function describeEvent(event: JournalEvent): EventDescription {
  let description = descriptions.get(event);
  if (!description) {
    description = {
      title: humanizeEvent(event.event),
      summary: summarize(event),
      category: isBackground(event) ? 'background' : categoryOf(event.event),
    };
    descriptions.set(event, description);
  }
  return description;
}

function isBackground(event: JournalEvent): boolean {
  // Keyed by event name like SUMMARIES; see summarize() for why the assertion is needed.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const test = BACKGROUND_WHEN[event.event] as ((event: JournalEvent) => boolean) | undefined;
  try {
    return test?.(event) ?? false;
  } catch {
    return false;
  }
}

function summarize(event: JournalEvent): string | undefined {
  // The map is keyed by event name, so the summarizer found always matches this event's type;
  // TypeScript can't correlate the two through the union.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const summarizer = SUMMARIES[event.event] as
    | ((event: JournalEvent) => string | undefined)
    | undefined;
  try {
    return summarizer?.(event) || undefined;
  } catch {
    return undefined; // Payloads aren't validated at runtime; a surprise shape shouldn't break the list.
  }
}
