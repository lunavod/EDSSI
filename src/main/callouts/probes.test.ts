import { describe, expect, it } from 'vitest';

import type { JournalEvent } from '../../shared/journal';
import { HistoryTracker } from '../history/tracker';
import { ProbeCallouts } from './probes';

const SYSTEM = 'Floanth UQ-X a14-23';

function logged(fields: Record<string, unknown>): JournalEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test payloads, like parsed JSON.
  return { timestamp: '2026-09-18T20:03:08Z', ...fields } as JournalEvent;
}

const jump = (address = 9) =>
  logged({ event: 'FSDJump', StarSystem: SYSTEM, SystemAddress: address, StarPos: [0, 0, 0] });
const planet = (bodyId: number, planetClass: string, terraformable = false, address = 9) =>
  logged({
    event: 'Scan',
    ScanType: 'Detailed',
    BodyName: `${SYSTEM} ${bodyId}`,
    BodyID: bodyId,
    StarSystem: SYSTEM,
    SystemAddress: address,
    DistanceFromArrivalLS: 400,
    PlanetClass: planetClass,
    MassEM: 0.8,
    TerraformState: terraformable ? 'Terraformable' : '',
    Landable: false,
    WasDiscovered: false,
    WasMapped: false,
  });
const allFound = (address = 9) =>
  logged({ event: 'FSSAllBodiesFound', SystemName: SYSTEM, SystemAddress: address, Count: 3 });

/** Feeds the events in order, collecting what would be said. */
function heard(minValue: number, ...events: JournalEvent[]): string[] {
  const tracker = new HistoryTracker();
  const callouts = new ProbeCallouts();
  const lines: string[] = [];
  for (const event of events) {
    tracker.apply(event);
    const line = callouts.after(event, () => tracker.snapshot(true).survey, minValue);
    if (line) lines.push(line);
  }
  return lines;
}

describe('ProbeCallouts', () => {
  it('counts the bodies worth mapping once every body is found, without naming them', () => {
    const lines = heard(
      0,
      jump(),
      planet(1, 'Water world'),
      planet(2, 'High metal content body', true),
      planet(3, 'Icy body'),
      allFound(),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^2 bodies worth mapping, [\d.]+ million together\.$/);
    expect(lines[0]).not.toContain(SYSTEM);
  });

  it('waits for the last body', () => {
    expect(heard(0, jump(), planet(1, 'Water world'))).toEqual([]);
  });

  it('stays quiet when nothing clears the cutoff, and when the system is found again', () => {
    expect(heard(1e9, jump(), planet(1, 'Water world'), allFound())).toEqual([]);
    expect(heard(0, jump(), planet(1, 'Water world'), allFound(), allFound())).toHaveLength(1);
  });

  it('says one body in the singular', () => {
    expect(heard(0, jump(), planet(1, 'Earthlike body'), allFound())[0]).toMatch(
      /^1 body worth mapping, [\d.]+ million\.$/,
    );
  });
});
