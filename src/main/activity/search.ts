/**
 * Searching every activity record the commander has, not just a named period: "when did I last
 * visit Colonia", "how many times have I died", "how much have I made from exobiology". The
 * answer is counts, totals and a few examples, never every match. Pure, like `summary.ts`.
 */

import type { ActivityRecord, EarnSource, SpendSource } from '../../shared/activity';
import { recordsIn } from '../../shared/activity';
import { stamp, type TimeRange } from './periods';
import { rankLabel, rankName } from './ranks';

export const RECORD_KINDS = [
  'location',
  'jump',
  'dock',
  'land',
  'on_foot',
  'scan',
  'map',
  'organic',
  'codex',
  'earn',
  'spend',
  'bounty',
  'bond',
  'mission',
  'interdiction',
  'crime',
  'death',
  'promotion',
  'ship',
  'scoop',
] as const satisfies readonly ActivityRecord['kind'][];

export const MONEY_SOURCES = [
  'exploration',
  'exobiology',
  'trade',
  'bounties',
  'combat_bonds',
  'missions',
  'search_and_rescue',
  'other_vouchers',
  'ship_and_module_sales',
  'ships',
  'outfitting',
  'repairs',
  'fuel',
  'ammo_and_restock',
  'rebuy',
  'fines_and_bounties',
  'exploration_data',
] as const satisfies readonly (EarnSource | SpendSource)[];

export interface ActivityQuery {
  kinds?: readonly ActivityRecord['kind'][];
  /** Every word must appear in the record's own text (see `describeRecord`); case is ignored. */
  text?: string;
  /** Part of the system's name. */
  system?: string;
  /** Part of a body's or station's name. */
  place?: string;
  /** Part of a species' or genus' name. */
  species?: string;
  /** Part of a traded commodity's name. */
  commodity?: string;
  /** An earning's or spending's source, e.g. `exobiology`, `repairs`. */
  source?: EarnSource | SpendSource;
}

/** How many matching records come back as examples, newest first. */
export const DEFAULT_EXAMPLES = 10;

/** Every record in `range` that `query` matches, oldest first. */
export function matchRecords(
  records: readonly ActivityRecord[],
  range: TimeRange,
  query: ActivityQuery,
): ActivityRecord[] {
  const kinds = query.kinds?.length ? new Set(query.kinds) : undefined;
  const words = query.text?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  return recordsIn(records, range).filter((record) => {
    if (kinds && !kinds.has(record.kind)) return false;
    if (!has(record.system, query.system)) return false;
    if (query.place !== undefined && !has(placeOf(record), query.place)) return false;
    if (query.species !== undefined) {
      if (record.kind !== 'organic') return false;
      if (!has(record.species, query.species) && !has(record.genus, query.species)) return false;
    }
    if (query.commodity !== undefined) {
      if ((record.kind !== 'earn' && record.kind !== 'spend') || record.source !== 'trade') {
        return false;
      }
      if (!has(record.detail, query.commodity)) return false;
    }
    if (query.source !== undefined) {
      if (record.kind !== 'earn' && record.kind !== 'spend') return false;
      if (record.source !== query.source) return false;
    }
    if (words.length > 0) {
      const text = `${describeRecord(record)} ${record.system ?? ''}`.toLowerCase();
      if (!words.every((word) => text.includes(word))) return false;
    }
    return true;
  });
}

/**
 * What the matches add up to, the way the model reads it: how many, the first and the last, a
 * total per kind, the systems they happened in most, and the latest few.
 */
export function searchActivity(
  records: readonly ActivityRecord[],
  range: TimeRange,
  query: ActivityQuery,
  examples = DEFAULT_EXAMPLES,
): Record<string, unknown> {
  const matches = matchRecords(records, range, query);
  if (matches.length === 0) return { period: range.label, matches: 0 };

  const kinds = new Map<string, { count: number; credits: number; distance: number }>();
  const systems = new Map<string, number>();
  for (const record of matches) {
    const total = kinds.get(record.kind) ?? { count: 0, credits: 0, distance: 0 };
    total.count++;
    total.credits += creditsOf(record) ?? 0;
    if (record.kind === 'jump') total.distance += record.distanceLy;
    kinds.set(record.kind, total);
    if (record.system) systems.set(record.system, (systems.get(record.system) ?? 0) + 1);
  }

  const first = matches[0]!;
  const last = matches.at(-1)!;
  return {
    period: range.label,
    matches: matches.length,
    first: row(first),
    last: matches.length > 1 ? row(last) : undefined,
    by_kind: Object.fromEntries(
      [...kinds].map(([kind, total]) => [
        kind,
        {
          count: total.count,
          credits_cr: total.credits > 0 ? Math.round(total.credits) : undefined,
          distance_ly: total.distance > 0 ? Math.round(total.distance) : undefined,
        },
      ]),
    ),
    systems: systems.size,
    top_systems: [...systems]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([system, count]) => ({ system, matches: count })),
    latest: matches.slice(-examples).toReversed().map(row),
    older_not_shown: Math.max(0, matches.length - examples) || undefined,
    note: CREDIT_NOTE,
  };
}

const CREDIT_NOTE =
  'credits_cr: scans, maps and samples at their estimated value when found; earn and spend at ' +
  'what changed hands; missions at the reward offered.';

function row(record: ActivityRecord): Record<string, unknown> {
  return { when: stamp(record.at), what: describeRecord(record), system: record.system };
}

/** Whether `value` contains `needle`, ignoring case; true when there is no needle. */
function has(value: string | undefined, needle: string | undefined): boolean {
  return needle === undefined || (value?.toLowerCase().includes(needle.toLowerCase()) ?? false);
}

/** The body or station a record happened at, if any. */
function placeOf(record: ActivityRecord): string | undefined {
  switch (record.kind) {
    case 'dock':
      return record.station;
    case 'land':
    case 'on_foot':
    case 'scan':
    case 'map':
    case 'organic':
      return record.body;
    default:
      return undefined;
  }
}

/** Credits a record is worth, for the totals; undefined for one with none. */
function creditsOf(record: ActivityRecord): number | undefined {
  switch (record.kind) {
    case 'scan':
      return record.value;
    case 'map':
      return record.addedValue;
    case 'organic':
      return record.value;
    case 'earn':
    case 'spend':
      return record.amount;
    case 'bounty':
    case 'bond':
      return record.reward;
    case 'mission':
      return record.outcome === 'completed' ? record.reward : undefined;
    case 'crime':
      return record.fine;
    default:
      return undefined;
  }
}

function cr(value: number): string {
  return `${Math.round(value).toLocaleString('en-GB')} cr`;
}

/** One line for a record: what the free-text search matches, and what the model reads. */
export function describeRecord(record: ActivityRecord): string {
  switch (record.kind) {
    case 'location':
      return `Was in ${record.system ?? 'an unknown system'}`;
    case 'jump':
      return (
        `Jumped to ${record.system} (${record.distanceLy.toFixed(1)} ly` +
        (record.starClass ? `, class ${record.starClass} star` : '') +
        (record.firstVisit ? ', first visit' : '') +
        ')'
      );
    case 'dock':
      return `Docked at ${record.station}${record.stationType ? ` (${record.stationType})` : ''}`;
    case 'land':
      return `Landed on ${record.body}`;
    case 'on_foot':
      return `Stepped out on ${record.body}`;
    case 'scan':
      return (
        `Scanned ${record.body}, ${record.bodyType}` +
        (record.firstDiscovery ? ', first discovery' : '') +
        (record.terraformable ? ', terraformable' : '') +
        (record.landable ? ', landable' : '') +
        `, ${cr(record.value)}`
      );
    case 'map':
      return `Mapped ${record.body}${record.efficient ? ' efficiently' : ''}, +${cr(record.addedValue)}`;
    case 'organic':
      return (
        `Analysed ${record.species} (${record.genus}) on ${record.body}` +
        (record.newSpecies ? ', new species' : '') +
        (record.value === undefined ? '' : `, ${cr(record.value)}`)
      );
    case 'codex':
      return `New codex entry: ${record.name} (${record.category})`;
    case 'earn':
      return `Earned ${cr(record.amount)} from ${record.source.replaceAll('_', ' ')}${record.detail ? `: ${record.detail}` : ''}`;
    case 'spend':
      return `Spent ${cr(record.amount)} on ${record.source.replaceAll('_', ' ')}${record.detail ? `: ${record.detail}` : ''}`;
    case 'bounty':
      return `Bounty of ${cr(record.reward)}${record.target ? ` on ${record.target}` : ''}`;
    case 'bond':
      return `Combat bond of ${cr(record.reward)}`;
    case 'mission':
      return (
        `Mission ${record.outcome}: ${record.name}` +
        (record.faction ? ` for ${record.faction}` : '') +
        (record.reward ? `, ${cr(record.reward)}` : '')
      );
    case 'interdiction':
      return (
        `Interdicted${record.interdictor ? ` by ${record.interdictor}` : ''}` +
        (record.byPlayer ? ' (a player)' : '') +
        (record.escaped ? ', escaped' : ', submitted or lost')
      );
    case 'crime':
      return (
        `Crime: ${record.crime}${record.fine ? `, fined ${cr(record.fine)}` : ''}` +
        (record.bounty ? `, bounty ${cr(record.bounty)}` : '')
      );
    case 'death':
      return `Died${record.killer ? `, killed by ${record.killer}` : ''}`;
    case 'promotion':
      return `Promoted to ${rankName(record.rank, record.level)} in ${rankLabel(record.rank)}`;
    case 'ship':
      return `${record.how === 'bought' ? 'Bought' : 'Swapped to'} a ${record.ship}`;
    case 'scoop':
      return `Scooped ${record.tons.toFixed(1)} t of fuel`;
  }
}
