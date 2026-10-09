import type {
  DataStatus,
  ExobiologyEntry,
  ExobiologyLog,
  HistorySnapshot,
  LedgerSummary,
  PossibleGenus,
  PossibleSpecies,
  SurveyBody,
  SurveyGenus,
  SurveyOrganic,
  ShipLoss,
  ShipLossItem,
  SurveySignal,
  SystemSurvey,
} from '../../shared/history';
import type { JournalEvent } from '../../shared/journal';
import {
  colonyDistance,
  type PlanetFacts,
  predictLife,
  type SpeciesPrediction,
  type StarFacts,
  type SystemFacts,
  type Vec3,
} from './biology/predict';
import { estimateBodyValue, genusValueRange, isTerraformable, organicValue } from './values';

/** Organic samples from a body nobody had set foot on before pay this many times the base price. */
export const FIRST_FOOTFALL_BONUS = 5;

/** How many of a loss's dearest items the journal lists by name. */
const MOST_NOTABLE_LOSSES = 8;

/** Deaths kept per commander; a full backfill can turn up a great many. */
const MAX_LOSSES = 20;

/** Universal Cartographics won't buy data gathered this close (in light years) to where it's sold. */
const UNSELLABLE_WITHIN_LY = 20;

interface ScanInfo {
  kind: 'star' | 'planet';
  starType?: string;
  planetClass?: string;
  terraformState?: string;
  stellarMass?: number;
  massEM?: number;
  distanceLs?: number;
  landable: boolean;
  wasDiscovered?: boolean;
  wasMapped?: boolean;
  wasFootfalled?: boolean;
  /** What the spawn rules look at; see `biology/predict.ts`. */
  luminosity?: string;
  atmosphereType?: string;
  atmosphere?: Record<string, number>;
  volcanism?: string;
  gravity?: number;
  temperature?: number;
  pressure?: number;
  orbitalPeriod?: number;
  materials?: string[];
}

interface OrganicRecord {
  species: string;
  name: string;
  genus: string;
  genusCode: string;
  variant?: string;
  samples: number;
  status: DataStatus;
  /** Set once the third sample is analysed. */
  analysed?: { timestamp: string; jump: number; session: number; newSpecies: boolean };
}

/** A body as it was before the current game session first changed it. */
interface Baseline {
  session: number;
  scanned: boolean;
  mapped: boolean;
  mappedEfficiently: boolean;
}

interface BodyRecord {
  bodyId: number;
  name: string;
  scan?: ScanInfo;
  mapped: boolean;
  mappedEfficiently: boolean;
  status: DataStatus;
  bioSignals: number;
  /** Counts by localised signal type, biological included. */
  signals: Map<string, number>;
  genuses: { code: string; name: string }[];
  organics: Map<string, OrganicRecord>;
  baseline?: Baseline;
}

interface SystemRecord {
  address: number | bigint;
  name?: string;
  position?: Vec3;
  bodyCount?: number;
  nonBodyCount?: number;
  progress?: number;
  allFound: boolean;
  bodies: Map<number, BodyRecord>;
}

interface CommanderRecord {
  name?: string;
  odyssey: boolean;
  /** Unpaid fines by faction. */
  fines: Map<string, number>;
  bounties: number;
  combatBonds: number;
  /** Systems with data still to sell, and the current one. Keyed by address digits. */
  systems: Map<string, SystemRecord>;
  current?: string;
  /** Hyperspace jumps made, from the first journal. */
  jumps: number;
  /** Codex names of every species and genus ever analysed. */
  analysedSpecies: Set<string>;
  analysedGenuses: Set<string>;
  /** Analysed since the last sale to Vista Genomics, oldest first. */
  exobiology: { organic: OrganicRecord; body: BodyRecord; system: SystemRecord }[];
  lastOrganicSale?: { timestamp: string; value: number; species: number };
  /** Ships destroyed, oldest first, and what each took with it. Only the last few are kept. */
  losses: ShipLoss[];
}

/**
 * Follows the journal from the very first file and keeps what spans sessions: money owed to and by
 * each commander, and scan and sample data they haven't sold yet. Events are applied in the order
 * the game wrote them.
 */
export class HistoryTracker {
  readonly #commanders = new Map<string, CommanderRecord>();
  #commander: CommanderRecord = this.#commanderFor('');
  #version = 0;
  /** Goes up each time the game is launched, as the journal service counts sessions. */
  #session = 0;

  get version(): number {
    return this.#version;
  }

  /** Applies an event; returns whether it could have changed the snapshot. */
  apply(event: JournalEvent): boolean {
    const changed = this.#apply(event);
    if (changed) this.#version++;
    return changed;
  }

  snapshot(ready: boolean): HistorySnapshot {
    const commander = this.#commander;
    const current =
      commander.current === undefined ? undefined : commander.systems.get(commander.current);
    return {
      version: this.#version,
      ready,
      ledger: this.#ledger(),
      ...(current && { survey: this.#survey(current) }),
      exobiology: this.#exobiologyLog(),
      losses: commander.losses,
    };
  }

  #apply(event: JournalEvent): boolean {
    const commander = this.#commander;
    switch (event.event) {
      case 'Fileheader':
        if (event.part !== 1) return false;
        this.#session++;
        return true;
      case 'Commander':
        this.#commander = this.#commanderFor(event.FID, event.Name);
        return true;
      case 'LoadGame':
        this.#commander = this.#commanderFor(event.FID, event.Commander);
        this.#commander.odyssey = event.Odyssey === true;
        return true;

      case 'Location':
      case 'FSDJump':
      case 'CarrierJump': {
        const key = String(event.SystemAddress);
        const system = this.#systemFor(event.SystemAddress);
        system.name = event.StarSystem;
        system.position = event.StarPos;
        const previous = commander.current;
        commander.current = key;
        if (event.event === 'FSDJump') commander.jumps++;
        if (previous !== undefined && previous !== key) this.#prune();
        return true;
      }

      case 'Scan': {
        // Belt clusters are worth nothing and clutter the list.
        if (event.StarType === undefined && event.PlanetClass === undefined) return false;
        const system = this.#systemFor(event.SystemAddress);
        if (event.StarSystem) system.name ??= event.StarSystem;
        const body = this.#bodyFor(system, event.BodyID, event.BodyName);
        this.#touch(body);
        const scan: ScanInfo = {
          kind: event.StarType === undefined ? 'planet' : 'star',
          starType: event.StarType,
          planetClass: event.PlanetClass,
          terraformState: event.TerraformState,
          stellarMass: event.StellarMass,
          massEM: event.MassEM,
          distanceLs: event.DistanceFromArrivalLS,
          landable: event.Landable === true,
          // Later scans of the same body report the commander's own discovery, so keep the first.
          wasDiscovered: body.scan ? body.scan.wasDiscovered : event.WasDiscovered,
          wasMapped: body.scan ? body.scan.wasMapped : event.WasMapped,
          wasFootfalled: body.scan ? body.scan.wasFootfalled : event.WasFootfalled,
          luminosity: event.Luminosity,
          atmosphereType: event.AtmosphereType,
          atmosphere: event.AtmosphereComposition
            ? Object.fromEntries(event.AtmosphereComposition.map((gas) => [gas.Name, gas.Percent]))
            : undefined,
          volcanism: event.Volcanism,
          gravity: event.SurfaceGravity,
          temperature: event.SurfaceTemperature,
          pressure: event.SurfacePressure,
          orbitalPeriod: event.OrbitalPeriod,
          materials: event.Materials?.map((material) => material.Name),
        };
        body.scan = scan;
        return true;
      }
      case 'SAAScanComplete': {
        const body = this.#bodyFor(
          this.#systemFor(event.SystemAddress),
          event.BodyID,
          event.BodyName,
        );
        this.#touch(body);
        body.mapped = true;
        body.mappedEfficiently = event.ProbesUsed <= event.EfficiencyTarget;
        return true;
      }
      case 'FSSDiscoveryScan': {
        const system = this.#systemFor(event.SystemAddress);
        system.name ??= event.SystemName;
        system.bodyCount = event.BodyCount;
        system.nonBodyCount = event.NonBodyCount;
        system.progress = event.Progress;
        return true;
      }
      case 'FSSAllBodiesFound':
        this.#systemFor(event.SystemAddress).allFound = true;
        return true;
      case 'FSSBodySignals':
      case 'SAASignalsFound': {
        const body = this.#bodyFor(
          this.#systemFor(event.SystemAddress),
          event.BodyID,
          event.BodyName,
        );
        body.bioSignals =
          event.Signals.find((signal) => /Biological/i.test(signal.Type))?.Count ?? body.bioSignals;
        // Each event lists the whole body, but a later one can be narrower, so merge rather
        // than replace: a count the game stops mentioning is still a count it once gave.
        for (const signal of event.Signals) body.signals.set(signalName(signal), signal.Count);
        if (event.event === 'SAASignalsFound' && event.Genuses) {
          body.genuses = event.Genuses.map((genus) => ({
            code: genus.Genus,
            name: genus.Genus_Localised ?? genus.Genus,
          }));
        }
        return true;
      }
      case 'ScanOrganic':
        this.#sample(event);
        return true;

      case 'SellExplorationData':
        this.#sellSystems(event.Systems);
        return true;
      case 'MultiSellExplorationData':
        // The game sells everything it will buy, but `Discovered` can name only some of it: one
        // sale paid 11.7M while naming four systems worth 27k between them.
        this.#sellSystems(event.Discovered.map((system) => system.SystemName));
        this.#sellAllFarAway();
        return true;
      case 'SellOrganicData':
        commander.lastOrganicSale = {
          timestamp: event.timestamp,
          value: event.BioData.reduce((sum, sold) => sum + sold.Value + sold.Bonus, 0),
          species: event.BioData.length,
        };
        for (const sold of event.BioData) {
          const organic = this.#organics().find(
            (candidate) =>
              candidate.species === sold.Species &&
              candidate.status === 'pending' &&
              candidate.samples === 3,
          );
          if (organic) organic.status = 'sold';
        }
        // Samples lost before this sale belong to a trip that is over.
        commander.exobiology = commander.exobiology.filter(
          ({ organic }) => organic.status === 'pending',
        );
        this.#prune();
        return true;

      case 'Died':
        // Unsold data and uncashed vouchers go down with the ship. Note what they were worth
        // before writing them off, so the journal can say what the death cost.
        this.#recordLoss(event.timestamp);
        commander.bounties = 0;
        commander.combatBonds = 0;
        for (const system of commander.systems.values()) {
          for (const body of system.bodies.values()) {
            if (body.status === 'pending') body.status = 'lost';
            for (const organic of body.organics.values()) {
              if (organic.status === 'pending') organic.status = 'lost';
            }
          }
        }
        this.#prune();
        return true;
      case 'Resurrect':
        // Outstanding fines are settled with the rebuy.
        commander.fines.clear();
        return true;

      case 'CommitCrime':
        if (!event.Fine) return false;
        commander.fines.set(event.Faction, (commander.fines.get(event.Faction) ?? 0) + event.Fine);
        return true;
      case 'PayFines':
        if (event.Faction !== undefined) commander.fines.delete(event.Faction);
        else if (event.AllFines) commander.fines.clear();
        else payDown(commander.fines, event.Amount);
        return true;
      case 'Bounty':
        commander.bounties += event.TotalReward ?? event.Reward ?? 0;
        return true;
      case 'FactionKillBond':
      case 'CapShipBond':
        commander.combatBonds += event.Reward;
        return true;
      case 'RedeemVoucher': {
        // Amount is what the commander received; a broker keeps a cut of the voucher's worth.
        const worth = event.Amount / (1 - (event.BrokerPercentage ?? 0) / 100);
        if (/^bounty$/i.test(event.Type)) {
          commander.bounties = Math.max(0, commander.bounties - worth);
        } else if (/^combatbond$/i.test(event.Type)) {
          commander.combatBonds = Math.max(0, commander.combatBonds - worth);
        } else {
          return false;
        }
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * Organic sampling goes Log, Sample, Sample, then Analyse once the third sample is in. Only
   * Analyse completes it. Starting on another species throws away a sample in progress.
   */
  #sample(event: Extract<JournalEvent, { event: 'ScanOrganic' }>): void {
    const system = this.#systemFor(event.SystemAddress);
    const body = this.#bodyFor(system, event.Body);
    let organic = body.organics.get(event.Species);
    if (!organic) {
      organic = {
        species: event.Species,
        name: event.Species_Localised ?? event.Species,
        genus: event.Genus_Localised ?? event.Genus,
        genusCode: event.Genus,
        variant: event.Variant_Localised ?? event.Variant,
        samples: 0,
        status: 'pending',
      };
      body.organics.set(event.Species, organic);
    }
    if (/^log$/i.test(event.ScanType)) {
      for (const other of this.#organics()) {
        if (other !== organic && other.status === 'pending' && other.samples < 3) other.samples = 0;
      }
      organic.samples = 1;
    } else if (/^sample$/i.test(event.ScanType)) {
      // The third sample only counts once it's analysed, a few seconds on; boarding the ship
      // before then loses it, with no line to say so.
      organic.samples = Math.min(organic.samples + 1, 2);
    } else if (/^analyse$/i.test(event.ScanType)) {
      organic.samples = 3;
    }
    organic.variant = event.Variant_Localised ?? event.Variant ?? organic.variant;

    const commander = this.#commander;
    if (organic.samples === 3 && !organic.analysed) {
      organic.analysed = {
        timestamp: event.timestamp,
        jump: commander.jumps,
        session: this.#session,
        newSpecies: !commander.analysedSpecies.has(organic.species),
      };
      commander.analysedSpecies.add(organic.species);
      commander.analysedGenuses.add(organic.genusCode);
      commander.exobiology.push({ organic, body, system });
    }
  }

  /** Notes what a body was like before this game session first changes it. */
  #touch(body: BodyRecord): void {
    if (body.baseline?.session === this.#session) return;
    body.baseline = {
      session: this.#session,
      scanned: body.scan !== undefined,
      mapped: body.mapped,
      mappedEfficiently: body.mappedEfficiently,
    };
  }

  #sellSystems(names: readonly string[]): void {
    const sold = new Set(names.map((name) => name.toLowerCase()));
    for (const system of this.#commander.systems.values()) {
      if (system.name === undefined || !sold.has(system.name.toLowerCase())) continue;
      for (const body of system.bodies.values()) {
        if (body.status === 'pending') body.status = 'sold';
      }
    }
    this.#prune();
  }

  /**
   * Marks sold every system's data that Universal Cartographics would buy here: everything but
   * what was gathered within `UNSELLABLE_WITHIN_LY` of the current system. With no position to go
   * by, only the current system is held back.
   */
  #sellAllFarAway(): void {
    const commander = this.#commander;
    const here =
      commander.current === undefined ? undefined : commander.systems.get(commander.current);
    for (const [key, system] of commander.systems) {
      if (key === commander.current) continue;
      if (here?.position && system.position) {
        const [x, y, z] = here.position;
        const [sx, sy, sz] = system.position;
        if (Math.hypot(x - sx, y - sy, z - sz) < UNSELLABLE_WITHIN_LY) continue;
      }
      for (const body of system.bodies.values()) {
        if (body.status === 'pending') body.status = 'sold';
      }
    }
    this.#prune();
  }

  /**
   * Adds up everything still unsold at the moment of a `Died`, so the journal can show what the
   * ship took down with it. Call it before the pending data is written off as lost.
   */
  #recordLoss(timestamp: string): void {
    const commander = this.#commander;
    const here =
      commander.current === undefined ? undefined : commander.systems.get(commander.current)?.name;
    let cartographicValue = 0;
    let bodies = 0;
    let exobiologyValue = 0;
    let species = 0;
    const systems = new Set<SystemRecord>();
    const notable: ShipLossItem[] = [];
    for (const system of commander.systems.values()) {
      for (const body of system.bodies.values()) {
        if (body.scan && body.status === 'pending') {
          const value = this.#bodyValue(body);
          cartographicValue += value;
          bodies++;
          systems.add(system);
          notable.push({ kind: 'body', name: body.name, systemName: system.name, value });
        }
        for (const organic of body.organics.values()) {
          if (organic.status !== 'pending' || organic.samples < 3) continue;
          const payout = organicPayout(body, organic) ?? 0;
          exobiologyValue += payout;
          species++;
          notable.push({
            kind: 'organic',
            name: organic.name,
            bodyName: body.name,
            systemName: system.name,
            value: payout,
          });
        }
      }
    }
    const loss: ShipLoss = {
      timestamp,
      ...(here !== undefined && { systemName: here }),
      cartographics: { value: cartographicValue, bodies, systems: systems.size },
      exobiology: { value: exobiologyValue, species },
      bounties: Math.round(commander.bounties),
      combatBonds: Math.round(commander.combatBonds),
      notable: notable.toSorted((a, b) => b.value - a.value).slice(0, MOST_NOTABLE_LOSSES),
    };
    // A death that cost nothing is not worth a line of its own.
    if (
      loss.cartographics.value === 0 &&
      loss.exobiology.value === 0 &&
      loss.bounties === 0 &&
      loss.combatBonds === 0
    ) {
      return;
    }
    commander.losses.push(loss);
    // Backfilling a long history would otherwise keep every death the commander ever had.
    if (commander.losses.length > MAX_LOSSES) commander.losses.shift();
  }

  /** Forgets systems with nothing left to sell, other than the current one. */
  #prune(): void {
    const commander = this.#commander;
    for (const [key, system] of commander.systems) {
      if (key === commander.current) continue;
      const pending = [...system.bodies.values()].some(
        (body) =>
          (body.scan !== undefined && body.status === 'pending') ||
          [...body.organics.values()].some((organic) => organic.status === 'pending'),
      );
      if (!pending) commander.systems.delete(key);
    }
  }

  #organics(): OrganicRecord[] {
    const organics: OrganicRecord[] = [];
    for (const system of this.#commander.systems.values()) {
      for (const body of system.bodies.values()) organics.push(...body.organics.values());
    }
    return organics;
  }

  #commanderFor(fid: string, name?: string): CommanderRecord {
    let commander = this.#commanders.get(fid);
    if (!commander) {
      commander = {
        odyssey: true,
        fines: new Map(),
        bounties: 0,
        combatBonds: 0,
        systems: new Map(),
        jumps: 0,
        analysedSpecies: new Set(),
        analysedGenuses: new Set(),
        exobiology: [],
        losses: [],
      };
      this.#commanders.set(fid, commander);
    }
    if (name) commander.name = name;
    return commander;
  }

  #systemFor(address: number | bigint): SystemRecord {
    const key = String(address);
    let system = this.#commander.systems.get(key);
    if (!system) {
      system = { address, allFound: false, bodies: new Map() };
      this.#commander.systems.set(key, system);
    }
    return system;
  }

  #bodyFor(system: SystemRecord, bodyId: number, name?: string): BodyRecord {
    let body = system.bodies.get(bodyId);
    if (!body) {
      body = {
        bodyId,
        name: name ?? `Body ${bodyId}`,
        mapped: false,
        mappedEfficiently: false,
        status: 'pending',
        bioSignals: 0,
        genuses: [],
        signals: new Map(),
        organics: new Map(),
      };
      system.bodies.set(bodyId, body);
    } else if (name) {
      body.name = name;
    }
    return body;
  }

  #ledger(): LedgerSummary {
    const commander = this.#commander;
    let cartographicValue = 0;
    let cartographicSession = 0;
    let bodies = 0;
    let exobiologyValue = 0;
    let exobiologySession = 0;
    let species = 0;
    const systems = new Set<SystemRecord>();
    for (const system of commander.systems.values()) {
      for (const body of system.bodies.values()) {
        if (body.scan && body.status === 'pending') {
          cartographicValue += this.#bodyValue(body);
          cartographicSession += this.#sessionValue(body);
          bodies++;
          systems.add(system);
        }
        for (const organic of body.organics.values()) {
          if (organic.status !== 'pending' || organic.samples < 3) continue;
          const payout = organicPayout(body, organic) ?? 0;
          exobiologyValue += payout;
          if (organic.analysed?.session === this.#session) exobiologySession += payout;
          species++;
        }
      }
    }
    return {
      commander: commander.name,
      fines: [...commander.fines.values()].reduce((sum, fine) => sum + fine, 0),
      bounties: Math.round(commander.bounties),
      combatBonds: Math.round(commander.combatBonds),
      cartographics: {
        value: cartographicValue,
        sessionValue: cartographicSession,
        bodies,
        systems: systems.size,
      },
      exobiology: { value: exobiologyValue, sessionValue: exobiologySession, species },
    };
  }

  #survey(system: SystemRecord): SystemSurvey {
    const facts = systemFacts(system);
    const bodies = [...system.bodies.values()]
      .filter((body) => body.scan || body.bioSignals > 0 || body.organics.size > 0)
      .map((body): SurveyBody => {
        const scan = body.scan;
        const bonus = footfallBonus(body);
        const hasLife = body.bioSignals > 0 || body.genuses.length > 0;
        const planet = hasLife ? planetFacts(body) : undefined;
        const predicted = planet ? predictLife(facts, planet) : [];
        const possible = (species: SpeciesPrediction): PossibleSpecies => ({
          species: species.code,
          name: species.name,
          value: species.value * bonus,
          colours: species.colours,
          newSpecies: !this.#commander.analysedSpecies.has(species.code),
        });
        return {
          bodyId: body.bodyId,
          name: body.name,
          kind: scan?.kind,
          type: scan?.starType ?? scan?.planetClass,
          distanceLs: scan?.distanceLs,
          gravity: scan?.gravity,
          landable: scan?.landable ?? false,
          terraformable: isTerraformable(scan?.terraformState),
          firstDiscovery: scan?.wasDiscovered === false,
          mapped: body.mapped,
          mappedEfficiently: body.mappedEfficiently,
          firstFootfall: scan?.wasFootfalled === undefined ? undefined : !scan.wasFootfalled,
          value: scan ? this.#bodyValue(body) : 0,
          mappingValue:
            scan?.kind === 'planet' && !body.mapped
              ? this.#bodyValue(body, { mapped: true, mappedEfficiently: true }) -
                this.#bodyValue(body)
              : undefined,
          status: body.status,
          bioSignals: body.bioSignals,
          signals: [...body.signals].map(([type, count]): SurveySignal => ({ type, count })),
          genuses: body.genuses.map((genus): SurveyGenus => {
            const candidates = (
              predicted.find((prediction) => prediction.code === genus.code)?.species ?? []
            ).map(possible);
            const all = genusValueRange(genus.code);
            return {
              code: genus.code,
              name: genus.name,
              minValue: candidates[0]?.value ?? (all && all.min * bonus),
              maxValue: candidates.at(-1)?.value ?? (all && all.max * bonus),
              newGenus: !this.#commander.analysedGenuses.has(genus.code),
              colonyDistance: colonyDistance(genus.code),
              candidates,
            };
          }),
          possibleGenuses: planet
            ? predicted.map((prediction): PossibleGenus => {
                const species = prediction.species.map(possible);
                return {
                  code: prediction.code,
                  name: prediction.name,
                  colonyDistance: prediction.colonyDistance,
                  minValue: species[0]!.value,
                  maxValue: species.at(-1)!.value,
                  newGenus: !this.#commander.analysedGenuses.has(prediction.code),
                  species,
                };
              })
            : undefined,
          organics: [...body.organics.values()].map((organic): SurveyOrganic => ({
            status: organic.status,
            species: organic.species,
            name: organic.name,
            genus: organic.genus,
            genusCode: organic.genusCode,
            colonyDistance: colonyDistance(organic.genusCode),
            variant: organic.variant,
            samples: organic.samples,
            value: organicPayout(body, organic),
            newSpecies:
              organic.analysed?.newSpecies ?? !this.#commander.analysedSpecies.has(organic.species),
          })),
        };
      })
      .toSorted(
        (a, b) =>
          (a.distanceLs ?? Number.POSITIVE_INFINITY) - (b.distanceLs ?? Number.POSITIVE_INFINITY) ||
          a.bodyId - b.bodyId,
      );
    return {
      systemAddress: system.address,
      systemName: system.name ?? 'Unknown system',
      bodyCount: system.bodyCount,
      nonBodyCount: system.nonBodyCount,
      progress: system.progress,
      allFound: system.allFound,
      bodies,
    };
  }

  #exobiologyLog(): ExobiologyLog {
    const commander = this.#commander;
    return {
      lastSale: commander.lastOrganicSale,
      jumps: commander.jumps,
      entries: commander.exobiology.flatMap(({ organic, body, system }): ExobiologyEntry[] => {
        const analysed = organic.analysed;
        if (!analysed) return [];
        return [
          {
            timestamp: analysed.timestamp,
            systemAddress: system.address,
            systemName: system.name ?? 'Unknown system',
            bodyName: body.name,
            species: organic.species,
            name: organic.name,
            genus: organic.genus,
            variant: organic.variant,
            value: organicPayout(body, organic),
            status: organic.status,
            newSpecies: analysed.newSpecies,
            jump: analysed.jump,
            thisSession: analysed.session === this.#session,
          },
        ];
      }),
    };
  }

  /** What a body is worth now, or as `state` had it mapped. */
  #bodyValue(
    body: BodyRecord,
    state: Pick<Baseline, 'mapped' | 'mappedEfficiently'> = body,
  ): number {
    const scan = body.scan;
    if (!scan) return 0;
    return estimateBodyValue({
      ...scan,
      mapped: state.mapped,
      mappedEfficiently: state.mappedEfficiently,
      odyssey: this.#commander.odyssey,
    });
  }

  /** How much of a body's value this game session added: all of it, or only the mapping. */
  #sessionValue(body: BodyRecord): number {
    const baseline = body.baseline;
    if (baseline?.session !== this.#session) return 0;
    const before = baseline.scanned ? this.#bodyValue(body, baseline) : 0;
    return Math.max(0, this.#bodyValue(body) - before);
  }
}

/** `$SAA_SignalType_Geological;` reads as "Geological" when the game didn't localise it. */
function signalName(signal: { Type: string; Type_Localised?: string }): string {
  if (signal.Type_Localised) return signal.Type_Localised;
  return /^\$SAA_SignalType_(\w+);$/.exec(signal.Type)?.[1] ?? signal.Type;
}

/** What the spawn rules need to know about a system: where it is, and what has been scanned. */
function systemFacts(system: SystemRecord): SystemFacts {
  const stars: StarFacts[] = [];
  const planetClasses: string[] = [];
  for (const body of system.bodies.values()) {
    const scan = body.scan;
    if (scan?.starType !== undefined) {
      stars.push({
        bodyName: body.name,
        starType: scan.starType,
        luminosity: scan.luminosity,
        distanceLs: scan.distanceLs,
      });
    }
    if (scan?.planetClass !== undefined) planetClasses.push(scan.planetClass);
  }
  return { name: system.name ?? '', position: system.position, stars, planetClasses };
}

/** A scanned planet as the spawn rules see it; undefined before its scan. */
function planetFacts(body: BodyRecord): PlanetFacts | undefined {
  const scan = body.scan;
  if (scan?.planetClass === undefined) return undefined;
  return {
    bodyName: body.name,
    planetClass: scan.planetClass,
    atmosphereType: scan.atmosphereType,
    atmosphere: scan.atmosphere,
    volcanism: scan.volcanism,
    gravity: scan.gravity,
    temperature: scan.temperature,
    pressure: scan.pressure,
    distanceLs: scan.distanceLs,
    orbitalPeriod: scan.orbitalPeriod,
    materials: scan.materials,
  };
}

function organicPayout(body: BodyRecord, organic: OrganicRecord): number | undefined {
  const value = organicValue(organic.species);
  return value === undefined ? undefined : value * footfallBonus(body);
}

function footfallBonus(body: BodyRecord): number {
  return body.scan?.wasFootfalled === false ? FIRST_FOOTFALL_BONUS : 1;
}

/** Pays down fines oldest faction first when the game didn't say whose they were. */
function payDown(fines: Map<string, number>, amount: number): void {
  let left = amount;
  for (const [faction, fine] of fines) {
    if (left <= 0) break;
    if (fine <= left) fines.delete(faction);
    else fines.set(faction, fine - left);
    left -= fine;
  }
}
