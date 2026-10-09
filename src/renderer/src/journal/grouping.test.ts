import { describe, expect, it } from 'vitest';

import type { JournalEvent } from '../../../shared/journal';
import type { PlottedRoute } from '../../../shared/nav-routes';
import { formatNumber } from './format';
import { type GroupRow, groupEntries, type JournalRow, type VisibleEntry } from './grouping';
import { describeEvent } from './summaries';

let nextId = 0;
let clock = Date.parse('2026-09-10T19:00:00Z');

/** An event logged a few seconds after the previous one. */
function logged(fields: Record<string, unknown>): JournalEvent {
  clock += 5000;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test payloads, like parsed JSON.
  return {
    timestamp: new Date(clock).toISOString().replace('.000', ''),
    ...fields,
  } as JournalEvent;
}

/** Newest-first visible entries, as the view builds them, from events oldest first. */
function visible(...events: JournalEvent[]): VisibleEntry[] {
  return events
    .map((event) => {
      const description = describeEvent(event);
      return {
        entry: { id: nextId++, event, redundant: false },
        description,
        category: description.category,
      };
    })
    .toReversed();
}

function shape(rows: JournalRow[]): string[] {
  return rows.map((row) =>
    row.kind === 'group'
      ? `${row.title}[${row.events.map((e) => e.item.entry.event.event).join(',')}]`
      : row.item.entry.event.event,
  );
}

const A = { StarSystem: 'Mehet', SystemAddress: 101 };
const B = { StarSystem: 'Zhang Fei', SystemAddress: 102 };

const targetA = () =>
  logged({
    event: 'FSDTarget',
    Name: A.StarSystem,
    SystemAddress: 101,
    StarClass: 'M',
    RemainingJumpsInRoute: 2,
  });
const startA = () => logged({ event: 'StartJump', JumpType: 'Hyperspace', ...A, StarClass: 'M' });
const targetB = () =>
  logged({
    event: 'FSDTarget',
    Name: B.StarSystem,
    SystemAddress: 102,
    StarClass: 'K',
    RemainingJumpsInRoute: 1,
  });
const arriveA = () =>
  logged({ event: 'FSDJump', ...A, StarPos: [0, 0, 0], JumpDist: 23.456, FuelUsed: 3.2 });
const music = () => logged({ event: 'Music', MusicTrack: 'Exploration' });

describe('groupEntries', () => {
  it('folds a hyperspace jump, its targets and background noise into one row', () => {
    const rows = groupEntries(visible(targetA(), startA(), music(), targetB(), arriveA()), []);
    expect(shape(rows)).toEqual(['FSD Jump[FSDJump,FSDTarget,Music,StartJump,FSDTarget]']);
    expect((rows[0] as GroupRow).summary).toBe(
      `Jumped to Mehet · ${formatNumber(23.46)} ly · ${formatNumber(3.2)} t fuel · class M · next Zhang Fei`,
    );
  });

  it('adds where the jump sits on the route', () => {
    const plotted = logged({ event: 'NavRoute' });
    const route: PlottedRoute = {
      id: 1,
      plottedAt: plotted.timestamp,
      systems: [
        { StarSystem: 'Start', SystemAddress: 100, StarPos: [0, 0, 0], StarClass: 'K' },
        { ...A, StarPos: [0, 0, 0], StarClass: 'M' },
        { ...B, StarPos: [0, 0, 0], StarClass: 'K' },
      ],
    };
    const rows = groupEntries(visible(startA(), arriveA()), [route]);
    expect((rows[0] as GroupRow).summary).toContain('jump 1 of 2');
  });

  it('shows a jump that is still charging as a group once there is more than the countdown', () => {
    expect(shape(groupEntries(visible(startA()), []))).toEqual(['StartJump']);
    const rows = groupEntries(visible(startA(), targetB()), []);
    expect(shape(rows)).toEqual(['FSD Jump[FSDTarget,StartJump]']);
    expect((rows[0] as GroupRow).summary).toBe('Charging jump to Mehet · class M');
  });

  it("doesn't group across an event that isn't background noise", () => {
    const rows = groupEntries(
      visible(startA(), logged({ event: 'ShipTargeted', TargetLocked: false }), arriveA()),
      [],
    );
    expect(shape(rows)).toEqual(['FSDJump', 'ShipTargeted', 'StartJump']);
  });

  it('keeps the key of a group as newer events join it', () => {
    const all = visible(startA(), targetB(), arriveA());
    const beforeArrival = all.slice(1); // Newest first, so this drops the FSDJump.
    expect(groupEntries(beforeArrival, [])[0]?.key).toBe(groupEntries(all, [])[0]?.key);
  });

  it('folds entering supercruise into one row', () => {
    const rows = groupEntries(
      visible(
        logged({ event: 'StartJump', JumpType: 'Supercruise' }),
        targetA(),
        logged({ event: 'SupercruiseEntry', StarSystem: 'Sol', SystemAddress: 10 }),
      ),
      [],
    );
    expect(shape(rows)).toEqual(['Supercruise[SupercruiseEntry,FSDTarget,StartJump]']);
    expect((rows[0] as GroupRow).summary).toBe('Supercruise in Sol');
  });

  it("sums up a system's scans and calls out what's notable", () => {
    const scan = (fields: Record<string, unknown>) =>
      logged({
        event: 'Scan',
        ScanType: 'AutoScan',
        StarSystem: 'Deciat',
        SystemAddress: 7,
        DistanceFromArrivalLS: 10,
        WasDiscovered: true,
        ...fields,
      });
    const rows = groupEntries(
      visible(
        scan({ BodyName: 'Deciat A', StarType: 'K' }),
        logged({ event: 'ScanBaryCentre', StarSystem: 'Deciat', SystemAddress: 7, BodyID: 1 }),
        scan({
          BodyName: 'Deciat 1',
          PlanetClass: 'Earthlike body',
          TerraformState: 'Terraformed',
          Landable: false,
        }),
        scan({
          BodyName: 'Deciat 2',
          PlanetClass: 'High metal content body',
          TerraformState: 'Terraformable',
          Landable: true,
          WasDiscovered: false,
        }),
        logged({ event: 'FSSAllBodiesFound', SystemName: 'Deciat', SystemAddress: 7, Count: 3 }),
        scan({
          BodyName: 'Elsewhere 1',
          StarSystem: 'Elsewhere',
          SystemAddress: 8,
          PlanetClass: 'Icy body',
        }),
      ),
      [],
    );
    expect(shape(rows)).toEqual(['Scan', 'Scans[FSSAllBodiesFound,Scan,Scan,ScanBaryCentre,Scan]']);
    expect((rows[1] as GroupRow).summary).toBe(
      '3 bodies in Deciat · all found · 1 first discovery · 1 terraformable · 1 landable · Earth-like world',
    );
  });

  it('adds up sibling fuel scoops, but leaves a single one alone', () => {
    const scoop = (Scooped: number, Total: number) =>
      logged({ event: 'FuelScoop', Scooped, Total });
    const rows = groupEntries(visible(scoop(5, 20), scoop(5, 25), music(), scoop(2.5, 27.5)), []);
    expect(shape(rows)).toEqual(['Fuel Scoop[FuelScoop,Music,FuelScoop,FuelScoop]']);
    expect((rows[0] as GroupRow).summary).toBe(
      `+${formatNumber(12.5)} t over 3 scoops, tank at ${formatNumber(27.5)} t`,
    );
    expect(shape(groupEntries(visible(scoop(5, 20)), []))).toEqual(['FuelScoop']);
  });

  it('leaves background noise outside a group alone', () => {
    const rows = groupEntries(visible(music(), startA(), arriveA(), music()), []);
    expect(shape(rows)).toEqual(['Music', 'FSD Jump[FSDJump,StartJump]', 'Music']);
  });
});
