import { type Tally, TALLY_SOURCES, type TallySource } from '../../../shared/activity';
import type { BioBody, ProbeTarget } from '../../../shared/mission';
import type { ViewOptionValue } from '../../../shared/view-options';
import { formatCompact } from '../journal/format';

export {
  type BioBody,
  type BioLine,
  bioBodies,
  type ExobiologyStop,
  exobiologyStops,
  jumpsSinceLastStop,
  type ProbeTarget,
  probeTargets,
} from '../../../shared/mission';

/** "16.2M CR": the Mission tab is a glance, not an invoice. */
export function formatShortCredits(value: number): string {
  return `${formatCompact(value)} CR`;
}

/** "1.2M CR", or "1M–8.4M CR" for a range. */
export function formatCreditRange(min: number | undefined, max: number | undefined): string {
  if (min === undefined || max === undefined) return '?';
  if (min === max) return formatShortCredits(min);
  return `${formatCompact(min)}–${formatShortCredits(max)}`;
}

/**
 * What a body with life is worth: what has been analysed so far out of the whole, e.g.
 * "4.2M / 12M–30M CR". The whole counts what is analysed plus everything still to be had; before
 * anything is analysed it is only the whole.
 */
export function formatBodyValue(bio: BioBody): string | undefined {
  const { collected, potentialMin, potentialMax } = bio;
  if (collected <= 0 && potentialMax <= 0) return undefined;
  const total = formatCreditRange(collected + potentialMin, collected + potentialMax);
  if (collected <= 0) return total;
  return `${formatCompact(collected)} / ${total}`;
}

export type BioSort = ViewOptionValue<'mission.bio_sort'>;

export const BIO_SORTS: readonly { id: BioSort; label: string; title: string }[] = [
  { id: 'name', label: 'Name', title: 'By name, as the system map lists them' },
  { id: 'distance', label: 'Distance', title: 'Nearest the arrival star first' },
  { id: 'value', label: 'Value', title: 'Most to be had first, at best' },
];

/**
 * Bodies with life in the chosen order. `bioBodies` gives them by name, which breaks ties; a body
 * whose distance isn't known goes last.
 */
export function sortBioBodies(bodies: readonly BioBody[], sort: BioSort): BioBody[] {
  switch (sort) {
    case 'name':
      return [...bodies];
    case 'distance':
      return bodies.toSorted(
        (a, b) => (a.body.distanceLs ?? Infinity) - (b.body.distanceLs ?? Infinity),
      );
    case 'value':
      return bodies.toSorted(
        (a, b) => b.collected + b.potentialMax - (a.collected + a.potentialMax),
      );
  }
}

/**
 * What a probe run earns, "+1.8M CR", or "?" for a body whose class says it's worth it but whose
 * figure isn't in.
 */
export function formatProbeEarnings(target: ProbeTarget): string {
  return target.earns === undefined ? '?' : `+${formatShortCredits(target.earns)}`;
}

/**
 * What mapping a body with life on it would add, next to its other tags: "+1.8M CR to map", or
 * "worth mapping" for a body whose figure isn't in.
 */
export function formatMappingTag(target: ProbeTarget): string {
  return target.earns === undefined
    ? 'worth mapping'
    : `+${formatShortCredits(target.earns)} to map`;
}

/** "2h 05m", or "45m" under an hour. */
export function formatPlayed(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

const SOURCE_LABELS: Record<TallySource, string> = {
  exobiology: 'Exobiology',
  cartographics: 'Cartographics',
  bounties: 'Bounties',
  trade: 'Trade',
  missions: 'Missions',
  other: 'Other',
};

export interface SourceShare {
  source: TallySource;
  label: string;
  value: number;
  /** Of everything earned, 0–1. */
  share: number;
}

/**
 * Where the earnings came from, largest first, leaving out what made nothing. A trade at a loss
 * is shown but takes no share, so the shares still add up to the whole.
 */
export function sourceShares(tally: Tally): SourceShare[] {
  const positive = TALLY_SOURCES.reduce(
    (sum, source) => sum + Math.max(0, tally.bySource[source]),
    0,
  );
  return TALLY_SOURCES.filter((source) => tally.bySource[source] !== 0)
    .map((source) => {
      const value = tally.bySource[source];
      return {
        source,
        label: SOURCE_LABELS[source],
        value,
        share: positive > 0 ? Math.max(0, value) / positive : 0,
      };
    })
    .toSorted((a, b) => b.value - a.value);
}
