/**
 * What EDSSI works out from the whole journal history: money the commander is owed or owes, and
 * what they know about the system they're in.
 */

export interface LedgerSummary {
  commander?: string;
  /** Unpaid fines, in credits. */
  fines: number;
  /** Bounty vouchers earned but not cashed in. */
  bounties: number;
  /** Combat bond vouchers earned but not cashed in. */
  combatBonds: number;
  /**
   * Scan data not yet sold to Universal Cartographics, at estimated value. `sessionValue` is the
   * part of it earned since the game was launched.
   */
  cartographics: { value: number; sessionValue: number; bodies: number; systems: number };
  /** Completed organic samples not yet sold to Vista Genomics, at estimated value. */
  exobiology: { value: number; sessionValue: number; species: number };
}

/** Data the commander is carrying (`pending`), has sold, or lost when their ship was destroyed. */
export type DataStatus = 'pending' | 'sold' | 'lost';

/** An organism on a body: how far its sampling has got and what it's worth. */
export interface SurveyOrganic {
  status: DataStatus;
  /** The game's codex name, e.g. `$Codex_Ent_Bacterial_04_Name;`. */
  species: string;
  name: string;
  /** Localised, e.g. `Bacterium`. */
  genus: string;
  /** The game's codex name, e.g. `$Codex_Ent_Bacterial_Genus_Name;`. */
  genusCode: string;
  /** Metres between colonies of different species of its genus, where the rules know it. */
  colonyDistance?: number;
  variant?: string;
  /** Samples taken, 0–3; 3 means analysed. */
  samples: number;
  /** Estimated payout for a complete sample, including any first footfall bonus. */
  value?: number;
  /** The commander had never analysed this species before (or still hasn't). */
  newSpecies: boolean;
}

/** A genus the surface scanner found on a body, and what its species pay. */
export interface SurveyGenus {
  /** The game's codex name, e.g. `$Codex_Ent_Bacterial_Genus_Name;`. */
  code: string;
  /** Localised, e.g. `Bacterium`. */
  name: string;
  /**
   * Cheapest and dearest species that could be the one here, with any first footfall bonus: the
   * predicted species where the spawn rules found any, else every species of the genus. Unknown
   * genuses have none.
   */
  minValue?: number;
  maxValue?: number;
  /** The commander has never analysed a species of this genus. */
  newGenus: boolean;
  /** Metres between colonies of different species, where the rules know the genus. */
  colonyDistance?: number;
  /** The species the spawn rules say it could be, cheapest first; empty when they found none. */
  candidates: PossibleSpecies[];
}

/** A species the spawn rules say could grow on a body. A prediction, and sometimes wrong. */
export interface PossibleSpecies {
  /** Codex name, e.g. `$Codex_Ent_Stratum_02_Name;`. */
  species: string;
  /** In English, e.g. `Stratum Paleas`. */
  name: string;
  /** Estimated payout, including any first footfall bonus. */
  value: number;
  /** Colours it could come in on this body; empty for a species without colour variants. */
  colours: string[];
  /** The commander has never analysed it. */
  newSpecies: boolean;
}

/** A genus the spawn rules say could grow on a body, before the surface scanner has named any. */
export interface PossibleGenus {
  code: string;
  /** In English, e.g. `Stratum`. */
  name: string;
  /** Metres between colonies of different species. */
  colonyDistance: number;
  minValue: number;
  maxValue: number;
  newGenus: boolean;
  /** Cheapest first. */
  species: PossibleSpecies[];
}

/** One kind of surface signal on a body, as the FSS or the surface scanner counted it. */
export interface SurveySignal {
  /** Localised where the game said, e.g. `Geological`, `Planetary Mining Location`. */
  type: string;
  count: number;
}

export interface SurveyBody {
  bodyId: number;
  name: string;
  /** Undefined for a body only known from its signals, before it has been scanned. */
  kind?: 'star' | 'planet';
  /** Star type (`K`, `DA`…) or planet class (`High metal content body`…). */
  type?: string;
  distanceLs?: number;
  /** Surface gravity in m/s², as the Scan gives it; undefined for stars and unscanned bodies. */
  gravity?: number;
  landable: boolean;
  terraformable: boolean;
  /** Nobody had discovered it before the commander scanned it. */
  firstDiscovery: boolean;
  /** Mapped by the commander with the surface scanner. */
  mapped: boolean;
  mappedEfficiently: boolean;
  /** Nobody had set foot on it before; undefined when the game didn't say. */
  firstFootfall?: boolean;
  /** Estimated Universal Cartographics value. */
  value: number;
  /**
   * What mapping it with the surface scanner would add to `value`, within the probe target; set
   * for scanned planets the commander hasn't mapped.
   */
  mappingValue?: number;
  /** Whether its scan data is still to be sold. */
  status: DataStatus;
  bioSignals: number;
  /** Every surface signal, biological included. Most bodies have none. */
  signals: SurveySignal[];
  /** Genuses the surface scanner found. */
  genuses: SurveyGenus[];
  /**
   * Every genus the spawn rules say could grow here, for a planet with biological signals.
   * Undefined until the planet itself has been scanned, as the rules need its atmosphere and
   * surface. Only as good as the rules: a genus can be missing, and most listed won't be there.
   */
  possibleGenuses?: PossibleGenus[];
  organics: SurveyOrganic[];
  /** The commander's personal bests it holds, e.g. `Largest water world`. */
  records?: string[];
}

/** What the commander knows about the system they're in. */
export interface SystemSurvey {
  systemAddress: number | bigint;
  systemName: string;
  /** From the discovery scan (honk); undefined until then. */
  bodyCount?: number;
  /** Signals that aren't bodies — stations, beacons, USS. From the honk. */
  nonBodyCount?: number;
  /** Share of the system already resolved when the honk went off, 0–1. */
  progress?: number;
  allFound: boolean;
  /** Closest to the arrival star first. */
  bodies: SurveyBody[];
}

/** Whether `next` should replace `current`: a later version, or the same one once the replay is done. */
export function isNewerSnapshot(
  current: HistorySnapshot | undefined,
  next: HistorySnapshot,
): boolean {
  if (!current) return true;
  return (
    next.version > current.version ||
    (next.version === current.version && next.ready && !current.ready)
  );
}

export interface HistorySnapshot {
  /** Goes up with every change, so a window can ignore an older snapshot that arrives late. */
  version: number;
  /** False while EDSSI is still reading older journals. */
  ready: boolean;
  ledger: LedgerSummary;
  survey?: SystemSurvey;
  exobiology: ExobiologyLog;
  /** Ships destroyed, and what unsold data went down with each. Oldest first. */
  losses: ShipLoss[];
}

/**
 * What a commander lost when their ship was destroyed: data they hadn't sold and vouchers they
 * hadn't cashed in. Valued as the ledger valued it the moment before the `Died` line.
 */
export interface ShipLoss {
  /** The `Died` event's timestamp, which is what ties this to that line in the journal. */
  timestamp: string;
  /** Where it happened, when the journal had said. */
  systemName?: string;
  /** Scan data that never reached Universal Cartographics. */
  cartographics: { value: number; bodies: number; systems: number };
  /** Analysed samples that never reached Vista Genomics. */
  exobiology: { value: number; species: number };
  /** Uncashed bounty vouchers, in credits. */
  bounties: number;
  /** Uncashed combat bonds, in credits. */
  combatBonds: number;
  /** The dearest of what went down, dearest first, at most a handful. */
  notable: ShipLossItem[];
}

export interface ShipLossItem {
  kind: 'body' | 'organic';
  /** A body's name, or a species'. */
  name: string;
  /** For a sample, the body it grew on. */
  bodyName?: string;
  systemName?: string;
  value: number;
}

/** Organic samples analysed since the commander last sold to Vista Genomics. */
export interface ExobiologyLog {
  lastSale?: { timestamp: string; value: number; species: number };
  /** Hyperspace jumps the commander has made, counted from the first journal. */
  jumps: number;
  /** Still unsold, or lost with the ship since the last sale. Oldest first. */
  entries: ExobiologyEntry[];
}

export interface ExobiologyEntry {
  /** When the last sample went in. */
  timestamp: string;
  systemAddress: number | bigint;
  systemName: string;
  bodyName: string;
  species: string;
  name: string;
  genus: string;
  variant?: string;
  value?: number;
  status: DataStatus;
  newSpecies: boolean;
  /** `ExobiologyLog.jumps` as it stood then, so the jumps between two entries are a subtraction. */
  jump: number;
  /** Analysed since the game was launched. */
  thisSession: boolean;
}
