/**
 * Adds a commander's activity records up over a span of time, already worked out the way the
 * assistant needs it: totals and highlights, not rows. Every function here is pure.
 */

import { minutesPlayed, recordsIn, tally } from '../../shared/activity';
import type { TimeRange } from './periods';
import { stamp } from './periods';
import { rankLabel, rankName } from './ranks';
import type {
  ActivityRecord,
  CommanderActivity,
  EarnSource,
  RecordOf,
  SpendSource,
} from './tracker';

export { minutesPlayed, recordsIn };

/** A body worth more than this, or a planet of these classes, is worth mentioning by name. */
const NOTABLE_BODY_CR = 1_000_000;
const NOTABLE_CLASSES = /earthlike|water world|ammonia world/i;

function of<K extends ActivityRecord['kind']>(
  records: readonly ActivityRecord[],
  kind: K,
): RecordOf<K>[] {
  return records.filter((record): record is RecordOf<K> => record.kind === kind);
}

function sum<T>(items: readonly T[], value: (item: T) => number | undefined): number {
  return items.reduce((total, item) => total + (value(item) ?? 0), 0);
}

/** Leaves out zeroes, empty lists and undefined, so the model only reads what happened. */
function compact<T extends Record<string, unknown>>(object: T): Partial<T> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only entries were dropped
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (value === undefined || value === 0 || value === false) return false;
      if (Array.isArray(value)) return value.length > 0;
      if (value && typeof value === 'object') return Object.keys(value).length > 0;
      return true;
    }),
  ) as Partial<T>;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function byKey<K extends string>(
  items: readonly { key: K; amount: number }[],
): Partial<Record<K, number>> {
  const totals: Partial<Record<K, number>> = {};
  for (const { key, amount } of items) totals[key] = Math.round((totals[key] ?? 0) + amount);
  return totals;
}

/** Everything the commander did in a span of time, as totals and a few highlights. */
export function summarise(commander: CommanderActivity, range: TimeRange): Record<string, unknown> {
  const records = recordsIn(commander.records, range);
  const played = minutesPlayed(commander.spans, range);
  if (records.length === 0 && played === 0) {
    return { period: range.label, nothing_happened: true };
  }
  const made = tally(commander.records, commander.spans, range);

  const jumps = of(records, 'jump');
  const scans = of(records, 'scan');
  const maps = of(records, 'map');
  const organics = of(records, 'organic');
  const earned = of(records, 'earn');
  const spent = of(records, 'spend');
  const missions = of(records, 'mission');
  const docks = of(records, 'dock');
  const bounties = of(records, 'bounty');

  const earnedTotal = sum(earned, (record) => record.amount);
  const spentTotal = sum(spent, (record) => record.amount);
  const longest = jumps.reduce<RecordOf<'jump'> | undefined>(
    (best, jump) => (!best || jump.distanceLy > best.distanceLy ? jump : best),
    undefined,
  );
  const farthest = jumps.reduce<RecordOf<'jump'> | undefined>(
    (best, jump) => (!best || jump.fromSolLy > best.fromSolLy ? jump : best),
    undefined,
  );
  const before = recordsIn(commander.records, { from: 0, to: range.from }).findLast(
    (record) => record.kind === 'jump' || record.kind === 'location',
  );
  const lastPlace = records.findLast(
    (record) => record.kind === 'jump' || record.kind === 'location',
  );

  return compact({
    period: range.label,
    minutes_played: played,
    first_activity: records[0] && stamp(records[0].at),
    last_activity: records.at(-1) && stamp(records.at(-1)!.at),
    travel: compact({
      started_in: (before ?? records.find((record) => record.system))?.system,
      ended_in: lastPlace?.system,
      jumps: jumps.length,
      distance_ly: Math.round(sum(jumps, (jump) => jump.distanceLy)),
      systems_visited: new Set(jumps.map((jump) => jump.system)).size,
      never_visited_before: jumps.filter((jump) => jump.firstVisit).length,
      longest_jump: longest && `${round(longest.distanceLy)} ly to ${longest.system}`,
      farthest_from_sol: farthest && `${Math.round(farthest.fromSolLy)} ly, at ${farthest.system}`,
      fuel_scooped_t: Math.round(sum(of(records, 'scoop'), (scoop) => scoop.tons)),
      docked: docks.length,
      stations: [...new Set(docks.map((dock) => dock.station))].slice(0, 10),
      planet_landings: of(records, 'land').length,
      on_foot_on: [...new Set(of(records, 'on_foot').map((record) => record.body))].slice(0, 10),
    }),
    exploration: compact({
      bodies_scanned: scans.length,
      first_discoveries: scans.filter((scan) => scan.firstDiscovery).length,
      bodies_mapped: maps.length,
      mapped_efficiently: maps.filter((map) => map.efficient).length,
      scan_data_found_cr: Math.round(
        sum(scans, (scan) => scan.value) + sum(maps, (map) => map.addedValue),
      ),
      notable_bodies: notableBodies(scans, maps),
      new_codex_entries: codexCount(records),
      notable_codex_entries: notableCodex(records).map(
        (codex) => `${codex.name} (${codex.system})`,
      ),
    }),
    exobiology: compact({
      species_analysed: organics.length,
      new_species: organics.filter((organic) => organic.newSpecies).length,
      value_cr: Math.round(sum(organics, (organic) => organic.value)),
      best: organics
        .toSorted((a, b) => (b.value ?? 0) - (a.value ?? 0))
        .slice(0, 3)
        .map((organic) => `${organic.species} on ${organic.body}`),
    }),
    money: compact({
      earned_cr: Math.round(earnedTotal),
      earned_by: byKey<EarnSource>(
        earned.map((record) => ({ key: record.source, amount: record.amount })),
      ),
      trade_profit_cr: Math.round(sum(earned, (record) => record.profit)),
      spent_cr: Math.round(spentTotal),
      spent_by: byKey<SpendSource>(
        spent.map((record) => ({ key: record.source, amount: record.amount })),
      ),
      net_cr: Math.round(earnedTotal - spentTotal),
      biggest_payday: earned
        .toSorted((a, b) => b.amount - a.amount)
        .slice(0, 1)
        .map(
          (record) => `${Math.round(record.amount)} CR from ${record.source}, ${stamp(record.at)}`,
        )[0],
    }),
    // The Mission tab's session strip shows the same numbers.
    income: compact({
      made_cr: made.earned,
      per_hour_cr: made.perHour,
      lost_with_the_ship_cr: made.lost,
      by_source_cr: compact(made.bySource),
    }),
    missions: compact({
      accepted: missions.filter((mission) => mission.outcome === 'accepted').length,
      completed: missions.filter((mission) => mission.outcome === 'completed').length,
      failed: missions.filter((mission) => mission.outcome === 'failed').length,
      abandoned: missions.filter((mission) => mission.outcome === 'abandoned').length,
      rewards_cr: sum(
        missions.filter((mission) => mission.outcome === 'completed'),
        (mission) => mission.reward,
      ),
    }),
    combat: compact({
      bounties_earned: bounties.length,
      bounty_vouchers_cr: sum(bounties, (bounty) => bounty.reward),
      combat_bonds_cr: sum(of(records, 'bond'), (bond) => bond.reward),
      interdicted: of(records, 'interdiction').filter((record) => !record.escaped).length,
      escaped_interdictions: of(records, 'interdiction').filter((record) => record.escaped).length,
      crimes: of(records, 'crime').length,
      deaths: of(records, 'death').map(
        (death) =>
          `${stamp(death.at)} in ${death.system ?? 'unknown system'}${death.killer ? `, by ${death.killer}` : ''}`,
      ),
    }),
    promotions: of(records, 'promotion').map(
      (promotion) => `${rankName(promotion.rank, promotion.level)} in ${rankLabel(promotion.rank)}`,
    ),
    ships: of(records, 'ship')
      .slice(-5)
      .map((ship) => `${ship.how} ${ship.ship}`),
  });
}

function codexCount(records: readonly ActivityRecord[]): number {
  return of(records, 'codex').length;
}

/** New codex entries other than stars and planets, the latest ten. */
function notableCodex(records: readonly ActivityRecord[]): RecordOf<'codex'>[] {
  return of(records, 'codex')
    .filter((codex) => !codex.stellar)
    .slice(-10);
}

function notableBodies(scans: readonly RecordOf<'scan'>[], maps: readonly RecordOf<'map'>[]) {
  const mapped = new Map(maps.map((map) => [map.body, map.addedValue]));
  return scans
    .map((scan) => ({ scan, value: scan.value + (mapped.get(scan.body) ?? 0) }))
    .filter(
      ({ scan, value }) =>
        value >= NOTABLE_BODY_CR || NOTABLE_CLASSES.test(scan.bodyType) || scan.terraformable,
    )
    .toSorted((a, b) => b.value - a.value)
    .slice(0, 5)
    .map(({ scan, value }) =>
      compact({
        body: scan.body,
        type: scan.bodyType,
        value_cr: Math.round(value),
        terraformable: scan.terraformable,
        first_discovery: scan.firstDiscovery,
        mapped: mapped.has(scan.body),
      }),
    );
}

/** A system where the commander did something, rather than just passing through. */
export interface Stop {
  type: 'stop';
  system: string;
  arrived: number;
  left?: number;
  records: ActivityRecord[];
}

/** Jumps with nothing much between them: a leg of the journey. */
export interface Transit {
  type: 'transit';
  from?: string;
  to: string;
  started: number;
  ended: number;
  jumps: number;
  distanceLy: number;
  /** Bodies scanned on the way, which on their own don't make a stop. */
  scanned: number;
}

export type Segment = Stop | Transit;

/** Whether what happened in a system is worth a stop of its own. */
function worthStopping(records: readonly ActivityRecord[]): boolean {
  const scanValue = sum(of(records, 'scan'), (scan) => scan.value);
  return (
    scanValue >= NOTABLE_BODY_CR ||
    notableCodex(records).length > 0 ||
    records.some((record) =>
      [
        'dock',
        'land',
        'on_foot',
        'map',
        'organic',
        'earn',
        'mission',
        'bounty',
        'bond',
        'death',
        'interdiction',
        'promotion',
        'ship',
      ].includes(record.kind),
    )
  );
}

/**
 * The journey in a span, oldest first: the systems where something happened, and the legs of
 * jumps between them folded into one line each.
 */
export function journey(commander: CommanderActivity, range: TimeRange): Segment[] {
  const records = recordsIn(commander.records, range);
  const segments: Segment[] = [];
  let here: { system?: string; arrived: number; records: ActivityRecord[] } = {
    system: recordsIn(commander.records, { from: 0, to: range.from }).findLast(
      (record) => record.kind === 'jump' || record.kind === 'location',
    )?.system,
    arrived: range.from,
    records: [],
  };

  const settle = (leftAt: number | undefined) => {
    if (here.system === undefined) return;
    if (worthStopping(here.records)) {
      segments.push({
        type: 'stop',
        system: here.system,
        arrived: here.arrived,
        left: leftAt,
        records: here.records,
      });
    }
  };

  for (const record of records) {
    if (record.kind === 'jump' || (record.kind === 'location' && record.system !== here.system)) {
      const stopped = here.system !== undefined && worthStopping(here.records);
      settle(record.at);
      const last = segments.at(-1);
      if (record.kind === 'jump') {
        const scanned = stopped ? 0 : of(here.records, 'scan').length;
        if (last?.type === 'transit' && !stopped) {
          last.to = record.system;
          last.ended = record.at;
          last.jumps++;
          last.distanceLy += record.distanceLy;
          last.scanned += scanned;
        } else {
          segments.push({
            type: 'transit',
            from: here.system,
            to: record.system,
            started: record.at,
            ended: record.at,
            jumps: 1,
            distanceLy: record.distanceLy,
            scanned,
          });
        }
      }
      here = { system: record.system, arrived: record.at, records: [] };
      continue;
    }
    here.records.push(record);
  }
  settle(undefined);
  return segments;
}

/** A segment the way the model reads it. */
export function describeSegment(segment: Segment): Record<string, unknown> {
  if (segment.type === 'transit') {
    return compact({
      type: 'travel',
      from: segment.from,
      to: segment.to,
      started: stamp(segment.started),
      ended: stamp(segment.ended),
      jumps: segment.jumps,
      distance_ly: Math.round(segment.distanceLy),
      bodies_scanned_on_the_way: segment.scanned,
    });
  }
  const { records } = segment;
  const scans = of(records, 'scan');
  const organics = of(records, 'organic');
  const missions = of(records, 'mission');
  return compact({
    type: 'stop',
    system: segment.system,
    arrived: stamp(segment.arrived),
    left: segment.left === undefined ? 'still here' : stamp(segment.left),
    docked_at: [...new Set(of(records, 'dock').map((dock) => dock.station))],
    landed_on: [...new Set(of(records, 'land').map((land) => land.body))],
    on_foot_on: [...new Set(of(records, 'on_foot').map((record) => record.body))],
    bodies_scanned: scans.length,
    first_discoveries: scans.filter((scan) => scan.firstDiscovery).length,
    bodies_mapped: of(records, 'map').length,
    scan_value_cr: Math.round(
      sum(scans, (scan) => scan.value) + sum(of(records, 'map'), (map) => map.addedValue),
    ),
    species_analysed: organics.map(
      (organic) => `${organic.species}${organic.newSpecies ? ' (new)' : ''}`,
    ),
    new_codex_entries: codexCount(records),
    notable_codex_entries: notableCodex(records).map((codex) => codex.name),
    earned_cr: Math.round(sum(of(records, 'earn'), (earn) => earn.amount)),
    sold: [...new Set(of(records, 'earn').map((earn) => earn.source))],
    spent_cr: Math.round(sum(of(records, 'spend'), (spend) => spend.amount)),
    missions_completed: missions.filter((mission) => mission.outcome === 'completed').length,
    missions_accepted: missions.filter((mission) => mission.outcome === 'accepted').length,
    bounties: of(records, 'bounty').length,
    interdictions: of(records, 'interdiction').length,
    died: of(records, 'death').length > 0,
    promotions: of(records, 'promotion').map(
      (promotion) => `${rankName(promotion.rank, promotion.level)} in ${rankLabel(promotion.rank)}`,
    ),
    ships: of(records, 'ship').map((ship) => `${ship.how} ${ship.ship}`),
  });
}

/** Every time the commander went to a system, station or body whose name contains `query`. */
export function visits(commander: CommanderActivity, query: string, now: number) {
  const needle = query.toLowerCase();
  const matches = (name: string | undefined) => name?.toLowerCase().includes(needle) ?? false;

  const systems = new Map<string, { visits: number; first: number; last: number }>();
  for (const record of commander.records) {
    if (record.kind !== 'jump' || !matches(record.system)) continue;
    const seen = systems.get(record.system);
    if (seen) {
      seen.visits++;
      seen.last = record.at;
    } else {
      systems.set(record.system, { visits: 1, first: record.at, last: record.at });
    }
  }

  const places = new Map<
    string,
    { kind: string; system?: string; times: number; first: number; last: number }
  >();
  for (const record of commander.records) {
    const name =
      record.kind === 'dock'
        ? record.station
        : // Stepping out on a planet follows a landing, so landings alone count the visits.
          record.kind === 'land'
          ? record.body
          : undefined;
    if (!matches(name)) continue;
    const key = `${record.kind}:${name}`;
    const seen = places.get(key);
    if (seen) {
      seen.times++;
      seen.last = record.at;
    } else {
      places.set(key, {
        kind: record.kind,
        system: record.system,
        times: 1,
        first: record.at,
        last: record.at,
      });
    }
  }

  const stops = journey(commander, { from: 0, to: now, label: '' }).filter(
    (segment): segment is Stop =>
      segment.type === 'stop' &&
      (matches(segment.system) ||
        segment.records.some(
          (record) =>
            (record.kind === 'dock' && matches(record.station)) ||
            ((record.kind === 'land' || record.kind === 'on_foot') && matches(record.body)),
        )),
  );

  return {
    systems: [...systems].slice(0, 10).map(([system, seen]) => ({
      system,
      jumps_in: seen.visits,
      first: stamp(seen.first),
      last: stamp(seen.last),
    })),
    places: [...places].slice(0, 10).map(([key, seen]) => ({
      name: key.slice(key.indexOf(':') + 1),
      what: seen.kind === 'dock' ? 'docked' : 'landed',
      system: seen.system,
      times: seen.times,
      first: stamp(seen.first),
      last: stamp(seen.last),
    })),
    latest_stops: stops.slice(-3).map(describeSegment),
  };
}
