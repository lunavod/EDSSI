/**
 * The Mission tab's folding of the history snapshot: life on the current system's bodies, which of
 * them are worth a probe run, and the samples since the last sale split into stops. Shared, so the
 * assistant reads it the same way.
 */

import type {
  DataStatus,
  ExobiologyEntry,
  PossibleGenus,
  SurveyBody,
  SystemSurvey,
} from './history';

/** One system the commander sampled in, and how many jumps it took to get there from the last. */
export interface ExobiologyStop {
  systemAddress: number | bigint;
  systemName: string;
  entries: ExobiologyEntry[];
  /** Jumps since the previous stop; undefined for the first. */
  jumpsBefore?: number;
}

const bodyNameCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Body names in the order the system map lists them: "A 2" before "A 10", a moon ("A 1 a") right
 * after its planet.
 */
export function compareBodyNames(a: string, b: string): number {
  return bodyNameCollator.compare(a, b);
}

/**
 * Folds the log into stops, oldest first, each stop's entries by body and then in the order they
 * were analysed. Coming back to a system after jumping away is a new stop, since the jumps in
 * between are the point.
 */
export function exobiologyStops(entries: readonly ExobiologyEntry[]): ExobiologyStop[] {
  const stops: (ExobiologyStop & { jump: number })[] = [];
  for (const entry of entries) {
    const last = stops.at(-1);
    if (
      last &&
      last.jump === entry.jump &&
      String(last.systemAddress) === String(entry.systemAddress)
    ) {
      last.entries.push(entry);
      continue;
    }
    stops.push({
      systemAddress: entry.systemAddress,
      systemName: entry.systemName,
      entries: [entry],
      jump: entry.jump,
      jumpsBefore: last && entry.jump - last.jump,
    });
  }
  return stops.map(({ jump: _jump, ...stop }) => ({
    ...stop,
    entries: stop.entries.toSorted((a, b) => compareBodyNames(a.bodyName, b.bodyName)),
  }));
}

/** Jumps from the latest stop to where the commander is now. */
export function jumpsSinceLastStop(
  entries: readonly ExobiologyEntry[],
  jumps: number,
): number | undefined {
  const last = entries.at(-1);
  return last && jumps - last.jump;
}

/**
 * One line under a body: a species being or been sampled, a genus not yet started, or what the
 * signals the scanner hasn't named could be.
 */
export interface BioLine {
  key: string;
  name: string;
  variant?: string;
  /** "2/3", "analysed", "sold", "lost", or "—" before sampling starts. */
  progress: string;
  status: DataStatus | 'unsampled' | 'predicted';
  /** A species' price, or the cheapest and dearest of a genus or of the predictions. */
  minValue?: number;
  maxValue?: number;
  isNew: boolean;
  /** Metres between colonies of different species of its genus: how far to go before the next sample. */
  colonyDistance?: number;
  /**
   * What the spawn rules say it could be: species (with their colours) for a named genus, genera
   * (with their price ranges) for unnamed signals.
   */
  candidates?: PredictedCandidate[];
}

export interface PredictedCandidate {
  name: string;
  minValue: number;
  maxValue: number;
  colours: string[];
  isNew: boolean;
}

/** What's worth knowing about a body with life on it. */
export interface BioBody {
  body: SurveyBody;
  lines: BioLine[];
  /** Signals the scanner hasn't named yet: the body hasn't been mapped. */
  unnamed: number;
  /** Payout of what is analysed and unsold. */
  collected: number;
  /** Everything still to be had from the body, as a range. */
  potentialMin: number;
  potentialMax: number;
  /** What a probe run here would add, when the body is one of those worth mapping. */
  mapping?: ProbeTarget;
}

/**
 * Bodies with biological signals or samples, by name, each with its species, and what mapping
 * would add where the body clears `minMappingValue` — the same cutoff as "Worth a probe".
 */
export function bioBodies(survey: SystemSurvey | undefined, minMappingValue = 0): BioBody[] {
  if (!survey) return [];
  return survey.bodies
    .filter((body) => body.bioSignals > 0 || body.organics.length > 0)
    .toSorted((a, b) => compareBodyNames(a.name, b.name) || a.bodyId - b.bodyId)
    .map((body) => {
      const lines: BioLine[] = [];
      const sampledGenuses = new Set(body.organics.map((organic) => organic.genusCode));
      for (const organic of body.organics) {
        lines.push({
          key: organic.species,
          name: organic.name,
          variant: organic.variant,
          progress: organicProgress(organic.status, organic.samples),
          status: organic.status,
          minValue: organic.value,
          maxValue: organic.value,
          isNew: organic.newSpecies,
          colonyDistance: organic.colonyDistance,
        });
      }
      for (const genus of body.genuses) {
        if (sampledGenuses.has(genus.code)) continue;
        const only = genus.candidates.length === 1 ? genus.candidates[0] : undefined;
        lines.push({
          key: genus.code,
          name: only?.name ?? genus.name,
          variant: only && only.colours.length === 1 ? only.colours[0] : undefined,
          progress: '—',
          status: 'unsampled',
          minValue: genus.minValue,
          maxValue: genus.maxValue,
          isNew: only ? only.newSpecies : genus.newGenus,
          colonyDistance: genus.colonyDistance,
          candidates:
            genus.candidates.length > 0
              ? genus.candidates
                  .map((species) => ({
                    name: species.name,
                    minValue: species.value,
                    maxValue: species.value,
                    colours: species.colours,
                    isNew: species.newSpecies,
                  }))
                  .toSorted(byValueDescending)
              : undefined,
        });
      }
      // Dearest first; the unnamed signals, added below, are a total of several and stay last.
      lines.sort(byValueDescending);

      const namedCodes = new Set([...sampledGenuses, ...body.genuses.map((genus) => genus.code)]);
      const named = namedCodes.size;
      const unnamed = Math.max(0, body.bioSignals - named);
      const possible = body.possibleGenuses?.filter((genus) => !namedCodes.has(genus.code));
      if (unnamed > 0 && possible) lines.push(predictedLine(unnamed, possible));
      let collected = 0;
      let potentialMin = 0;
      let potentialMax = 0;
      for (const line of lines) {
        if (line.status === 'pending' && line.progress === 'analysed') {
          collected += line.minValue ?? 0;
        } else if (line.status !== 'sold' && line.status !== 'lost') {
          potentialMin += line.minValue ?? 0;
          potentialMax += line.maxValue ?? 0;
        }
      }
      return {
        body,
        lines,
        unnamed,
        collected,
        potentialMin,
        potentialMax,
        mapping: mappingTarget(body, minMappingValue),
      };
    });
}

/**
 * What `count` signals nobody has named could be worth: each is a different genus, so at least the
 * cheapest `count` of the possible genera and at most the dearest `count`. Where the rules found
 * fewer genera than signals, the rest are unknown and add nothing.
 */
function predictedLine(count: number, possible: readonly PossibleGenus[]): BioLine {
  const byMin = possible.map((genus) => genus.minValue).toSorted((a, b) => a - b);
  const byMax = possible.map((genus) => genus.maxValue).toSorted((a, b) => b - a);
  const sum = (values: number[]) =>
    values.slice(0, count).reduce((total, value) => total + value, 0);
  return {
    key: 'predicted',
    name: `${count} unnamed`,
    progress: '—',
    status: 'predicted',
    minValue: possible.length > 0 ? sum(byMin) : undefined,
    maxValue: possible.length > 0 ? sum(byMax) : undefined,
    isNew: false,
    candidates: possible
      .map((genus) => ({
        name: genus.name,
        minValue: genus.minValue,
        maxValue: genus.maxValue,
        colours: [],
        isNew: genus.newGenus,
      }))
      .toSorted(byValueDescending),
  };
}

/** Dearest first, by the top of the range and then its bottom; an unpriced line goes last. */
function byValueDescending(
  a: { minValue?: number; maxValue?: number },
  b: { minValue?: number; maxValue?: number },
): number {
  return (b.maxValue ?? -1) - (a.maxValue ?? -1) || (b.minValue ?? -1) - (a.minValue ?? -1);
}

/** A body worth mapping before leaving, for what the probe run pays. */
export interface ProbeTarget {
  body: SurveyBody;
  /** What the probe run adds to the body's value, within the probe target. */
  earns?: number;
  /** What the body is estimated to be worth once mapped. */
  worth: number;
}

/**
 * Mapping multiplies what a body is worth by about six, so the few classes that are worth a lot
 * earn one to four million from a minute's probing; everything else earns tens of thousands.
 */
export function isWorthMapping(body: SurveyBody): boolean {
  if (body.kind !== 'planet') return false;
  return (
    body.terraformable || /^(earthlike body|water world|ammonia world)$/i.test(body.type ?? '')
  );
}

/**
 * What a probe run over this body would earn, or nothing when it is mapped already, of a class
 * mapping doesn't pay for, or not worth `minValue` once mapped.
 */
export function mappingTarget(body: SurveyBody, minValue = 0): ProbeTarget | undefined {
  if (body.mapped || !isWorthMapping(body)) return undefined;
  const target = {
    body,
    earns: body.mappingValue,
    worth: body.value + (body.mappingValue ?? 0),
  };
  return target.worth >= minValue ? target : undefined;
}

/**
 * Below this distance from arrival a detour costs about the same: the loop is decided by what the
 * bodies pay, not by a few light seconds.
 */
const NEAR_LS = 500;

/**
 * The bodies here the commander hasn't mapped and should: of a class that pays for it, and worth
 * at least `minValue` once mapped. Best earnings per light second of detour first, so the order
 * is a sensible loop. Bodies with life aren't listed for that alone; the biology section already
 * says which aren't mapped.
 */
export function probeTargets(survey: SystemSurvey | undefined, minValue = 0): ProbeTarget[] {
  if (!survey) return [];
  const detour = (body: SurveyBody) => Math.max(body.distanceLs ?? 0, NEAR_LS);
  return survey.bodies
    .map((body) => mappingTarget(body, minValue))
    .filter((target) => target !== undefined)
    .toSorted((a, b) => (b.earns ?? 0) / detour(b.body) - (a.earns ?? 0) / detour(a.body));
}

function organicProgress(status: DataStatus, samples: number): string {
  if (status !== 'pending') return status;
  return samples >= 3 ? 'analysed' : `${samples}/3`;
}
