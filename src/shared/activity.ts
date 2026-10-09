/**
 * The commander's activity records (made in `main/activity/tracker.ts`), and the tally of a span of
 * them the Mission tab's session strip shows. Shared, so the assistant reads the same numbers.
 */

export type EarnSource =
  | 'exploration'
  | 'exobiology'
  | 'trade'
  | 'bounties'
  | 'combat_bonds'
  | 'missions'
  | 'search_and_rescue'
  | 'other_vouchers'
  | 'ship_and_module_sales';

export type SpendSource =
  | 'ships'
  | 'outfitting'
  | 'trade'
  | 'repairs'
  | 'fuel'
  | 'ammo_and_restock'
  | 'rebuy'
  | 'fines_and_bounties'
  | 'exploration_data';

interface Base {
  /** Milliseconds since the epoch. */
  at: number;
  /** The system the commander was in, when known. */
  system?: string;
}

export type ActivityRecord = Base &
  (
    | { kind: 'location' }
    | {
        kind: 'jump';
        system: string;
        starClass?: string;
        distanceLy: number;
        fromSolLy: number;
        /** The commander had never been to the system before (as far as the journals go). */
        firstVisit: boolean;
      }
    | { kind: 'dock'; station: string; stationType?: string }
    | { kind: 'land'; body: string }
    | { kind: 'on_foot'; body: string }
    | {
        kind: 'scan';
        body: string;
        bodyType: string;
        star: boolean;
        value: number;
        firstDiscovery: boolean;
        terraformable: boolean;
        landable: boolean;
      }
    | { kind: 'map'; body: string; addedValue: number; efficient: boolean }
    | {
        kind: 'organic';
        body: string;
        species: string;
        genus: string;
        value?: number;
        newSpecies: boolean;
      }
    | {
        kind: 'codex';
        name: string;
        category: string;
        /** Stars and planets: every new region has plenty, so they don't make a system memorable. */
        stellar: boolean;
      }
    | { kind: 'earn'; source: EarnSource; amount: number; profit?: number; detail?: string }
    | { kind: 'spend'; source: SpendSource; amount: number; detail?: string }
    | { kind: 'bounty'; reward: number; target?: string }
    | { kind: 'bond'; reward: number }
    | {
        kind: 'mission';
        outcome: 'accepted' | 'completed' | 'failed' | 'abandoned';
        name: string;
        faction?: string;
        reward?: number;
      }
    | { kind: 'interdiction'; escaped: boolean; byPlayer: boolean; interdictor?: string }
    | { kind: 'crime'; crime: string; fine?: number; bounty?: number }
    | { kind: 'death'; killer?: string }
    | { kind: 'promotion'; rank: string; level: number }
    | { kind: 'ship'; ship: string; how: 'bought' | 'swapped' }
    | { kind: 'scoop'; tons: number }
  );

export type RecordOf<K extends ActivityRecord['kind']> = Extract<ActivityRecord, { kind: K }>;

/** A stretch of play without a long silence in the journal. */
export interface PlaySpan {
  from: number;
  to: number;
}

/** Where the tally's earnings came from. */
export const TALLY_SOURCES = [
  'exobiology',
  'cartographics',
  'bounties',
  'trade',
  'missions',
  'other',
] as const;

export type TallySource = (typeof TALLY_SOURCES)[number];

/** Below this much play, a rate per hour says more about luck than about the commander. */
export const MIN_MINUTES_FOR_RATE = 5;

/** What the commander made over a span of play, for a glance at how it's going. */
export interface Tally {
  /** Milliseconds since the epoch, `from` inclusive and `to` exclusive. */
  from: number;
  to: number;
  minutesPlayed: number;
  jumps: number;
  distanceLy: number;
  /**
   * Credits made, by where they came from. Data and vouchers count when they're found or awarded,
   * at their estimated value, not when they're cashed in: an explorer's session is worth what it
   * found, and a sale would count the same scans twice. What went down with the ship before it
   * was cashed in is taken off again.
   */
  earned: number;
  /** Data and vouchers found in the range and lost when the ship was destroyed, in credits. */
  lost: number;
  bySource: Record<TallySource, number>;
  /** `earned` per hour played; undefined before MIN_MINUTES_FOR_RATE minutes of play. */
  perHour?: number;
}

/** Records inside the range, found by binary search: the records are in time order. */
export function recordsIn(
  records: readonly ActivityRecord[],
  range: { from: number; to: number },
): ActivityRecord[] {
  const start = firstAtOrAfter(records, range.from);
  const end = firstAtOrAfter(records, range.to);
  return records.slice(start, end);
}

function firstAtOrAfter(records: readonly ActivityRecord[], at: number): number {
  let low = 0;
  let high = records.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (records[middle]!.at < at) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Minutes played inside the range. */
export function minutesPlayed(
  spans: readonly PlaySpan[],
  range: { from: number; to: number },
): number {
  let ms = 0;
  for (const span of spans) {
    if (span.to <= range.from || span.from >= range.to) continue;
    ms += Math.min(span.to, range.to) - Math.max(span.from, range.from);
  }
  return Math.round(ms / 60_000);
}

/**
 * Where a record's credits came from, and how many, or undefined for one that made none. Selling
 * exploration or organic data and cashing in bounties and bonds are left out: those were counted
 * when found. So are ship and module sales, which are the commander's own money coming back.
 */
function earning(record: ActivityRecord): [TallySource, number] | undefined {
  switch (record.kind) {
    case 'scan':
      return ['cartographics', record.value];
    case 'map':
      return ['cartographics', record.addedValue];
    case 'organic':
      return record.value === undefined ? undefined : ['exobiology', record.value];
    case 'bounty':
    case 'bond':
      return ['bounties', record.reward];
    case 'earn':
      switch (record.source) {
        case 'trade':
          return ['trade', record.profit ?? 0];
        case 'missions':
          return ['missions', record.amount];
        case 'search_and_rescue':
        case 'other_vouchers':
          return ['other', record.amount];
        default:
          return undefined;
      }
    default:
      return undefined;
  }
}

/** The sales that cash in what a death would otherwise take. */
const CASHES_IN: Partial<Record<EarnSource, 'cartographics' | 'exobiology' | 'bounties'>> = {
  exploration: 'cartographics',
  exobiology: 'exobiology',
  bounties: 'bounties',
  combat_bonds: 'bounties',
};

/** Adds up the records and play inside `range`. */
export function tally(
  records: readonly ActivityRecord[],
  spans: readonly PlaySpan[],
  range: { from: number; to: number },
): Tally {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every source is filled in
  const bySource = Object.fromEntries(TALLY_SOURCES.map((source) => [source, 0])) as Record<
    TallySource,
    number
  >;
  // What was found in the range and not yet cashed in, which a death takes away again. A sale
  // clears the lot, as selling everything is what commanders do; a partial sale is rare.
  const uncashed: Record<'cartographics' | 'exobiology' | 'bounties', number> = {
    cartographics: 0,
    exobiology: 0,
    bounties: 0,
  };
  let jumps = 0;
  let distanceLy = 0;
  let lost = 0;
  for (const record of recordsIn(records, range)) {
    if (record.kind === 'jump') {
      jumps++;
      distanceLy += record.distanceLy;
    } else if (record.kind === 'death') {
      for (const source of ['cartographics', 'exobiology', 'bounties'] as const) {
        bySource[source] -= uncashed[source];
        lost += uncashed[source];
        uncashed[source] = 0;
      }
    } else if (record.kind === 'earn') {
      const cashed = CASHES_IN[record.source];
      if (cashed) uncashed[cashed] = 0;
    }
    const made = earning(record);
    if (!made) continue;
    const [source, amount] = made;
    bySource[source] += amount;
    if (source === 'cartographics' || source === 'exobiology' || source === 'bounties') {
      uncashed[source] += amount;
    }
  }
  for (const source of TALLY_SOURCES) bySource[source] = Math.round(bySource[source]);
  const earned = TALLY_SOURCES.reduce((total, source) => total + bySource[source], 0);
  const played = minutesPlayed(spans, range);
  return {
    from: range.from,
    to: range.to,
    minutesPlayed: played,
    jumps,
    distanceLy,
    earned,
    lost: Math.round(lost),
    bySource,
    perHour: played >= MIN_MINUTES_FOR_RATE ? Math.round((earned * 60) / played) : undefined,
  };
}

/** The strip along the bottom of the Mission tab: today, this game session, and this trip. */
export interface ActivityTallies {
  /** Goes up with every change, so a window can ignore an older one that arrives late. */
  version: number;
  /** False while EDSSI is still reading older journals. */
  ready: boolean;
  /** The commander's day, from 06:00 local time (see `days.ts`), so late at night it is still
   * the evening before. */
  today: Tally;
  /** Since the latest game session began; undefined before any has. */
  session?: Tally;
  /**
   * Since the last sale of exploration or organic data. `sinceSale` is false when nothing has
   * ever been sold, and the trip runs from the first journal.
   */
  trip: Tally & { sinceSale: boolean };
}

/** Whether `next` should replace `current`: a later version, or the same one once the replay is done. */
export function isNewerTallies(current: ActivityTallies | undefined, next: ActivityTallies) {
  if (!current) return true;
  return (
    next.version > current.version ||
    (next.version === current.version && next.ready && !current.ready)
  );
}
