import type { JournalEvent } from '../../../shared/journal';
import type { PlottedRoute } from '../../../shared/nav-routes';
import { formatNumber } from './format';
import { routeNote } from './route-notes';
import type { JournalEntry } from './state';
import { type Category, describeEvent, type EventDescription, join } from './summaries';

/** An entry that passed the view's filters. */
export interface VisibleEntry {
  entry: JournalEntry;
  description: EventDescription;
  category: Category;
}

/** One event's line. */
export interface EventRow {
  kind: 'event';
  key: string;
  item: VisibleEntry;
  summary: string | undefined;
}

/** Related events shown as one line, which expands into theirs. */
export interface GroupRow {
  kind: 'group';
  /** Stays the same as newer events join, so an expanded group stays expanded. */
  key: string;
  title: string;
  summary: string | undefined;
  category: Category;
  /** When the newest of its events happened. */
  timestamp: string;
  /** Newest first, including any background noise logged in between. */
  events: EventRow[];
}

export type JournalRow = EventRow | GroupRow;

interface GroupDescription {
  title: string;
  summary: string | undefined;
  category: Category;
}

interface GroupRule {
  opens(event: JournalEvent): boolean;
  /** Whether `event` belongs with `members` (oldest first, background noise left out). */
  joins(members: readonly JournalEvent[], event: JournalEvent): boolean;
  /** A complete group takes nothing more. */
  isComplete(members: readonly JournalEvent[]): boolean;
  /** Undefined if the members don't add up to a group worth showing. */
  describe(
    members: readonly JournalEvent[],
    routes: readonly PlottedRoute[],
  ): GroupDescription | undefined;
}

type EventOf<N extends JournalEvent['event']> = Extract<JournalEvent, { event: N }>;

function is<N extends JournalEvent['event']>(name: N) {
  return (event: JournalEvent): event is EventOf<N> => event.event === name;
}

const isFsdTarget = is('FSDTarget');
const isFsdJump = is('FSDJump');
const isSupercruiseEntry = is('SupercruiseEntry');
const isScan = is('Scan');
const isAllBodiesFound = is('FSSAllBodiesFound');
const isFuelScoop = is('FuelScoop');

function isJumpStart(jumpType: 'Hyperspace' | 'Supercruise') {
  return (event: JournalEvent): event is EventOf<'StartJump'> =>
    event.event === 'StartJump' && event.JumpType === jumpType;
}
const isHyperspaceStart = isJumpStart('Hyperspace');
const isSupercruiseStart = isJumpStart('Supercruise');

/** Addresses may be numbers or bigints (see parse.ts); compare their digits. */
function sameAddress(a: number | bigint | undefined, b: number | bigint | undefined): boolean {
  return a !== undefined && b !== undefined && String(a) === String(b);
}

/**
 * A hyperspace jump: the target it was aimed at, the countdown, what the game logs mid-jump (the
 * next target on the route, the route clearing before the last arrival) and the arrival.
 */
const hyperspaceJump: GroupRule = {
  opens: (event) => isFsdTarget(event) || isHyperspaceStart(event),
  joins(members, event) {
    const start = members.find(isHyperspaceStart);
    if (!start) {
      // A lone target belongs with the jump to it, if that's what comes next.
      const target = members[0];
      return (
        isHyperspaceStart(event) &&
        target !== undefined &&
        isFsdTarget(target) &&
        sameAddress(target.SystemAddress, event.SystemAddress)
      );
    }
    if (isFsdJump(event)) {
      return (
        sameAddress(start.SystemAddress, event.SystemAddress) ||
        start.StarSystem === event.StarSystem
      );
    }
    return isFsdTarget(event) || event.event === 'NavRouteClear' || event.event === 'HeatWarning';
  },
  isComplete: (members) => members.some(isFsdJump),
  describe(members, routes) {
    const start = members.find(isHyperspaceStart);
    if (!start || members.length < 2) return undefined;
    const arrival = members.find(isFsdJump);
    const next = members.slice(members.indexOf(start) + 1).findLast(isFsdTarget);
    const summary = arrival
      ? join(
          describeEvent(arrival).summary,
          start.StarClass && `class ${start.StarClass}`,
          routeNote(arrival, routes),
          next && `next ${next.Name}`,
        )
      : describeEvent(start).summary;
    return { title: 'FSD Jump', summary, category: 'travel' };
  },
};

/** Entering supercruise: the countdown and the entry, often with the selected target between. */
const supercruiseEntry: GroupRule = {
  opens: isSupercruiseStart,
  joins: (_members, event) => isSupercruiseEntry(event) || isFsdTarget(event),
  isComplete: (members) => members.some(isSupercruiseEntry),
  describe(members) {
    const entry = members.find(isSupercruiseEntry);
    return (
      entry && { title: 'Supercruise', summary: describeEvent(entry).summary, category: 'travel' }
    );
  },
};

type SurveyEvent = EventOf<
  'Scan' | 'ScanBaryCentre' | 'FSSDiscoveryScan' | 'FSSAllBodiesFound' | 'FSSBodySignals'
>;
const SURVEY_EVENTS: ReadonlySet<string> = new Set<SurveyEvent['event']>([
  'Scan',
  'ScanBaryCentre',
  'FSSDiscoveryScan',
  'FSSAllBodiesFound',
  'FSSBodySignals',
]);
function isSurvey(event: JournalEvent): event is SurveyEvent {
  return SURVEY_EVENTS.has(event.event);
}

/** Planet classes worth calling out, by the game's name for them. */
const NOTABLE_PLANETS: Readonly<Record<string, string>> = {
  'Earthlike body': 'Earth-like world',
  'Water world': 'water world',
  'Ammonia world': 'ammonia world',
};

/** Bodies scanned in one system (arrival auto-scans, nav beacon data, FSS), with its survey events. */
const systemSurvey: GroupRule = {
  opens: isSurvey,
  joins: (members, event) => {
    const first = members[0];
    return (
      first !== undefined &&
      isSurvey(first) &&
      isSurvey(event) &&
      sameAddress(first.SystemAddress, event.SystemAddress)
    );
  },
  isComplete: () => false,
  describe(members) {
    const scans = members.filter(isScan);
    if (scans.length < 2) return undefined;
    const countOf = (test: (scan: EventOf<'Scan'>) => boolean) => scans.filter(test).length;
    const discoveries = countOf((scan) => !scan.WasDiscovered);
    const terraformable = countOf((scan) => scan.TerraformState === 'Terraformable');
    const landable = countOf((scan) => scan.Landable === true);
    const notable = new Set(scans.flatMap((scan) => NOTABLE_PLANETS[scan.PlanetClass ?? ''] ?? []));
    const system = scans.find((scan) => scan.StarSystem)?.StarSystem;
    return {
      title: 'Scans',
      summary: join(
        `${scans.length} bodies${system ? ` in ${system}` : ''}`,
        members.some(isAllBodiesFound) && 'all found',
        discoveries > 0 &&
          `${discoveries} first ${discoveries === 1 ? 'discovery' : 'discoveries'}`,
        terraformable > 0 && `${terraformable} terraformable`,
        landable > 0 && `${landable} landable`,
        ...notable,
      ),
      category: 'exploration',
    };
  },
};

/** Scooping at one star, which the game logs in several steps. */
const fuelScooping: GroupRule = {
  opens: isFuelScoop,
  joins: (_members, event) => isFuelScoop(event),
  isComplete: () => false,
  describe(members) {
    const scoops = members.filter(isFuelScoop);
    const last = scoops.at(-1);
    if (scoops.length < 2 || !last) return undefined;
    const scooped = scoops.reduce((sum, scoop) => sum + scoop.Scooped, 0);
    return {
      title: 'Fuel Scoop',
      summary: `+${formatNumber(scooped)} t over ${scoops.length} scoops, tank at ${formatNumber(last.Total)} t`,
      category: 'travel',
    };
  },
};

const RULES: readonly GroupRule[] = [hyperspaceJump, supercruiseEntry, systemSurvey, fuelScooping];

/**
 * Turns the visible entries (newest first) into rows, folding runs of related events into groups.
 * Events next to each other belong together; background noise between them doesn't break a group.
 */
export function groupEntries(
  visible: readonly VisibleEntry[],
  routes: readonly PlottedRoute[],
): JournalRow[] {
  const items = visible.toReversed(); // Rules read events in the order they happened.
  const rows: JournalRow[] = [];
  let index = 0;
  while (index < items.length) {
    const group = groupAt(items, index, routes);
    if (group) {
      rows.push(group.row);
      index = group.next;
    } else {
      rows.push(eventRow(items[index]!, routes));
      index++;
    }
  }
  return rows.toReversed();
}

function groupAt(
  items: readonly VisibleEntry[],
  start: number,
  routes: readonly PlottedRoute[],
): { row: GroupRow; next: number } | undefined {
  const first = items[start]!;
  for (const rule of RULES) {
    if (!rule.opens(first.entry.event)) continue;
    const members = [first.entry.event];
    let last = start;
    for (let index = start + 1; index < items.length && !rule.isComplete(members); index++) {
      const item = items[index]!;
      if (rule.joins(members, item.entry.event)) {
        members.push(item.entry.event);
        last = index;
      } else if (item.category !== 'background') {
        break;
      }
    }

    let description: GroupDescription | undefined;
    try {
      description = rule.describe(members, routes);
    } catch {
      // Payloads aren't validated at runtime; show the events one by one instead.
    }
    if (!description) continue;
    return {
      row: {
        kind: 'group',
        key: `g${first.entry.id}`,
        ...description,
        timestamp: items[last]!.entry.event.timestamp,
        events: items
          .slice(start, last + 1)
          .map((item) => eventRow(item, routes))
          .toReversed(),
      },
      next: last + 1,
    };
  }
  return undefined;
}

function eventRow(item: VisibleEntry, routes: readonly PlottedRoute[]): EventRow {
  return {
    kind: 'event',
    key: `e${item.entry.id}`,
    item,
    summary: join(item.description.summary, routeNote(item.entry.event, routes)),
  };
}
