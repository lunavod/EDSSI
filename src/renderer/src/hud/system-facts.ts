import type { SystemExternalInfo } from '../../../shared/edsm';
import type { SurveyBody, SystemSurvey } from '../../../shared/history';
import { bioBodies } from '../../../shared/mission';
import { isScoopableClass } from '../../../shared/nav-routes';
import type { SystemDetails } from '../../../shared/overview';
import { countSignals, shortSignal } from '../../../shared/signals';
import { formatCompact, formatCompactParts, formatCredits, formatNumber } from '../journal/format';
import { join } from '../journal/summaries';
import type { Tone } from './DataTable';

/** One tile of the side panel's grid: a figure, a smaller unit after it, and what it is. */
export interface Fact {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
  title?: string;
}

/** One tag under the grid: something about the system worth a word. */
export interface SystemTag {
  label: string;
  tone: 'warn' | 'good' | 'danger' | 'ghost' | 'accent';
  title?: string;
  /** Drawn with the warning triangle. */
  warning?: boolean;
}

/** Whether a star can be scooped, as the side panel draws its class. */
export interface StarBadge {
  /** The class to print, or `?`. */
  label: string;
  scoopable?: boolean;
  title: string;
}

/** Bodies the commander has scanned, as opposed to ones only known from their signals. */
function scannedBodies(survey: SystemSurvey): SurveyBody[] {
  return survey.bodies.filter((body) => body.kind !== undefined);
}

/** What a tile that needs EDSM shows while it hasn't answered, can't be reached, or knows nothing. */
function edsmGap(info: SystemExternalInfo | undefined): string {
  if (!info) return '…';
  if (info.status === 'ok') return '—';
  return '?';
}

function edsmGapTitle(info: SystemExternalInfo | undefined): string | undefined {
  if (!info) return 'Asking EDSM…';
  if (info.status === 'unavailable') return 'EDSM could not be reached';
  if (info.status === 'unknown') return 'EDSM has no data on this system';
  return undefined;
}

/**
 * The four tiles for the current system. Out in the black: how much of it is found, its life, and
 * what its data is worth. In the bubble: who lives there, how busy it is, and where to dock.
 */
export function systemFacts(
  survey: SystemSurvey | undefined,
  info: SystemExternalInfo | undefined,
  details: SystemDetails | undefined,
): Fact[] {
  const facts = [bodiesFact(survey)];
  if ((details?.population ?? 0) > 0) {
    facts.push(populationFact(details?.population ?? 0), trafficFact(info), starportFact(info));
  } else {
    facts.push(bioFact(survey), cartoFact(survey), exobioFact(survey));
  }
  return facts;
}

/** Bodies scanned against the honk's count. */
export function bodiesFact(survey: SystemSurvey | undefined): Fact {
  const label = 'Bodies';
  if (!survey) return { label, value: '…' };
  const scanned = scannedBodies(survey).length;
  if (survey.bodyCount === undefined) {
    return {
      label,
      value: formatNumber(scanned, 0),
      unit: '/?',
      title: 'The discovery scanner has not been fired in this system',
    };
  }
  const left = survey.bodyCount - scanned;
  return {
    label,
    value: formatNumber(scanned, 0),
    unit: `/${formatNumber(survey.bodyCount, 0)}`,
    title: join(
      survey.allFound || left <= 0 ? 'All bodies found' : `${left} left to resolve in the FSS`,
      survey.nonBodyCount ? `${survey.nonBodyCount} other signals` : undefined,
      survey.progress === undefined
        ? undefined
        : `${formatNumber(survey.progress * 100, 0)}% resolved at the honk`,
    ),
  };
}

function populationFact(population: number): Fact {
  return {
    label: 'Population',
    ...formatCompactParts(population),
    title: formatNumber(population, 0),
  };
}

/** Ships EDSM users saw in the last day; busy systems are where gankers go. */
export function trafficFact(info: SystemExternalInfo | undefined): Fact {
  const label = 'Traffic 24 h';
  const traffic = info?.traffic;
  if (!traffic) return { label, value: edsmGap(info), title: edsmGapTitle(info) };
  return {
    label,
    value: formatNumber(traffic.day, 0),
    tone: traffic.day > 100 ? 'danger' : traffic.day > 10 ? 'warning' : undefined,
    title: `${formatNumber(traffic.week, 0)} this week`,
  };
}

function starportFact(info: SystemExternalInfo | undefined): Fact {
  const label = 'Starport';
  const port = info?.closestStarport;
  if (!port) {
    return {
      label,
      value: info?.status === 'ok' ? 'None' : edsmGap(info),
      title: edsmGapTitle(info),
    };
  }
  return {
    label,
    value: formatNumber(port.distanceLs, 0),
    unit: ' ls',
    title: `${port.name} (${port.type})`,
  };
}

/** Biological signals found so far, on how many bodies, and the genuses the scanner named. */
export function bioFact(survey: SystemSurvey | undefined): Fact {
  const label = 'Bio signals';
  const withBio = survey?.bodies.filter((body) => body.bioSignals > 0) ?? [];
  if (withBio.length === 0) return { label, value: survey ? '0' : '…' };
  const signals = withBio.reduce((sum, body) => sum + body.bioSignals, 0);
  const genuses = [...new Set(withBio.flatMap((body) => body.genuses.map((genus) => genus.name)))];
  return {
    label,
    value: formatNumber(signals, 0),
    unit: ` on ${withBio.length}`,
    tone: 'good',
    title: join(
      genuses.length > 0 ? genuses.join(', ') : undefined,
      withBio[0] && `Closest: ${withBio[0].name}`,
    ),
  };
}

/** What this system's unsold scan data is worth, so far. */
export function cartoFact(survey: SystemSurvey | undefined): Fact {
  const label = 'Carto value';
  const pending = survey?.bodies.filter((body) => body.status === 'pending') ?? [];
  const value = pending.reduce((sum, body) => sum + body.value, 0);
  if (value <= 0) return { label, value: survey ? '—' : '…' };
  return {
    label,
    ...formatCompactParts(value),
    title: `${formatCredits(value)}, estimated from ${pending.length} unsold ${pending.length === 1 ? 'scan' : 'scans'}`,
  };
}

/**
 * What the system's life is worth unsold: species analysed, plus the range still to be had from
 * those started and the genuses named.
 */
export function exobioFact(survey: SystemSurvey | undefined): Fact {
  const label = 'Exobio value';
  const bodies = bioBodies(survey);
  if (bodies.length === 0) return { label, value: survey ? '—' : '…' };
  const collected = bodies.reduce((sum, bio) => sum + bio.collected, 0);
  const min = collected + bodies.reduce((sum, bio) => sum + bio.potentialMin, 0);
  const max = collected + bodies.reduce((sum, bio) => sum + bio.potentialMax, 0);
  const unnamed = bodies.reduce((sum, bio) => sum + bio.unnamed, 0);
  return {
    label,
    ...(max <= 0 ? { value: '?' } : compactRange(min, max)),
    title: join(
      collected > 0 && `${formatCredits(collected)} analysed`,
      unnamed > 0 && `${unnamed} ${unnamed === 1 ? 'signal' : 'signals'} not yet named`,
    ),
  };
}

/** "218.2–412.5" and "M" when both ends share a unit, so it is set smaller once; else both whole. */
function compactRange(min: number, max: number): { value: string; unit?: string } {
  const low = formatCompactParts(min);
  if (min === max) return low;
  const high = formatCompactParts(max);
  if (low.unit === high.unit) return { value: `${low.value}–${high.value}`, unit: high.unit };
  return { value: `${formatCompact(min)}–${formatCompact(max)}` };
}

/**
 * The arrival star's class and whether a scoop works there: from the journal (or a lookup), else
 * what a route says (`routeSays`: a CSV route's Refuel column, which only ever says yes), else
 * EDSM's primary star.
 */
export function starBadge(
  starClass: string | undefined,
  info: SystemExternalInfo | undefined,
  routeSays?: true,
): StarBadge {
  if (starClass !== undefined) {
    const scoopable = isScoopableClass(starClass);
    return {
      label: starClass,
      scoopable,
      title: `Class ${starClass} · ${scoopable ? 'scoopable' : 'not scoopable'}`,
    };
  }
  if (routeSays) return { label: '?', scoopable: true, title: 'Scoopable, the route says' };
  const star = info?.primaryStar;
  if (star) {
    return {
      label: star.type.charAt(0),
      scoopable: star.scoopable,
      title: `${star.type} (EDSM) · ${star.scoopable ? 'scoopable' : 'not scoopable'}`,
    };
  }
  return { label: '?', title: edsmGapTitle(info) ?? 'Star class unknown' };
}

/** What else is worth a word about the system, most pressing first. */
export function systemTags(
  starClass: string | undefined,
  survey: SystemSurvey | undefined,
  info: SystemExternalInfo | undefined,
): SystemTag[] {
  const tags: SystemTag[] = [];
  const star = starBadge(starClass, info);
  if (star.scoopable === false) {
    tags.push({
      label: `Not scoopable · ${star.label}`,
      tone: 'warn',
      warning: true,
      title: star.title,
    });
  }
  const deaths = info?.deaths?.day ?? 0;
  if (deaths > 0) {
    tags.push({
      label: deaths >= 5 ? 'Threat high' : 'Threat medium',
      tone: deaths >= 5 ? 'danger' : 'warn',
      warning: true,
      title: `${deaths} ships lost here in the last 24 hours, ${info?.deaths?.week ?? 0} this week (EDSM)`,
    });
  }
  if (survey) {
    const scanned = scannedBodies(survey);
    if (survey.bodyCount === undefined) {
      tags.push({
        label: 'Not honked',
        tone: 'warn',
        title: 'The discovery scanner has not been fired in this system',
      });
    }
    const arrival = survey.bodies.find((body) => body.kind === 'star');
    const firsts = scanned.filter((body) => body.firstDiscovery).length;
    if (arrival?.firstDiscovery) {
      tags.push({
        label: 'Undiscovered',
        tone: 'good',
        title: `Nobody had scanned ${arrival.name}. ${firsts} of ${scanned.length} scanned bodies are first discoveries`,
      });
    } else if (firsts > 0) {
      tags.push({
        label: `${firsts} new`,
        tone: 'accent',
        title: `${firsts} of ${scanned.length} scanned bodies are first discoveries`,
      });
    }
  }
  if (!survey?.bodies.some((body) => body.kind === 'star') && info?.status === 'unknown') {
    tags.push({ label: 'Not in EDSM', tone: 'good', title: 'Nobody has uploaded this system' });
  }
  const signals = [...countSignals(survey?.bodies ?? [], (type) => !/biolog|mining/i.test(type))];
  for (const [type, count] of signals) {
    tags.push({
      label: `${shortSignal(type)} ${count}`,
      tone: /thargoid|guardian/i.test(type) ? 'warn' : 'ghost',
      title: `${count} ${type.toLowerCase()} ${count === 1 ? 'signal' : 'signals'}`,
    });
  }
  const landable = survey?.bodies.filter((body) => body.landable) ?? [];
  if (landable.length > 0) {
    const closest = landable[0];
    tags.push({
      label: `${landable.length} landable`,
      tone: 'ghost',
      title: join(
        closest?.distanceLs === undefined
          ? undefined
          : `Closest ${closest.name} at ${formatNumber(closest.distanceLs, 0)} ls`,
        landable.some((body) => body.firstFootfall) ? 'Some never walked on' : undefined,
      ),
    });
  }
  return tags;
}
