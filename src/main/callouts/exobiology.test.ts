import { describe, expect, it } from 'vitest';

import type { JournalEvent } from '../../shared/journal';
import { HistoryTracker } from '../history/tracker';
import { ExobiologyCallouts, spokenBodyName, spokenCredits } from './exobiology';

const SYSTEM = 'Blu Theia WF-S c19-0';

function logged(fields: Record<string, unknown>): JournalEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test payloads, like parsed JSON.
  return { timestamp: '2026-09-13T22:51:40Z', ...fields } as JournalEvent;
}

const jump = logged({
  event: 'FSDJump',
  StarSystem: SYSTEM,
  SystemAddress: 9,
  StarPos: [8580, 655, 2337],
});
const star = logged({
  event: 'Scan',
  ScanType: 'AutoScan',
  BodyName: SYSTEM,
  BodyID: 0,
  StarSystem: SYSTEM,
  SystemAddress: 9,
  StarType: 'K',
  StellarMass: 0.8,
  Luminosity: 'Vab',
  DistanceFromArrivalLS: 0,
  WasDiscovered: true,
  WasMapped: false,
});
const signals = (bodyId: number, count: number) =>
  logged({
    event: 'FSSBodySignals',
    BodyName: `${SYSTEM} ${bodyId}`,
    BodyID: bodyId,
    SystemAddress: 9,
    Signals: [{ Type: '$SAA_SignalType_Biological;', Type_Localised: 'Biological', Count: count }],
  });
const planet = (bodyId: number) =>
  logged({
    event: 'Scan',
    ScanType: 'Detailed',
    BodyName: `${SYSTEM} ${bodyId}`,
    BodyID: bodyId,
    StarSystem: SYSTEM,
    SystemAddress: 9,
    DistanceFromArrivalLS: 748,
    PlanetClass: 'High metal content body',
    MassEM: 0.072,
    TerraformState: '',
    Landable: true,
    AtmosphereType: 'CarbonDioxide',
    AtmosphereComposition: [
      { Name: 'CarbonDioxide', Percent: 93.5 },
      { Name: 'SulphurDioxide', Percent: 6.5 },
    ],
    Volcanism: '',
    SurfaceGravity: 4.001408,
    SurfaceTemperature: 195.83,
    SurfacePressure: 3498.75,
    WasDiscovered: false,
    WasMapped: false,
    WasFootfalled: false,
  });

/** Feeds the events in order, collecting what would be said. */
function heard(...events: JournalEvent[]): string[] {
  const tracker = new HistoryTracker();
  const callouts = new ExobiologyCallouts();
  const lines: string[] = [];
  for (const event of events) {
    tracker.apply(event);
    const line = callouts.after(event, () => tracker.snapshot(true).survey);
    if (line) lines.push(line);
  }
  return lines;
}

describe('ExobiologyCallouts', () => {
  it('speaks once the FSS has given both the signals and the scan, as the game writes them', () => {
    // One signal on a body where Bacterium (1 MCr) or Stratum (19 MCr) could grow, both ×5 for
    // a first footfall.
    expect(heard(jump, star, signals(2, 1), planet(2))).toEqual(['2: 1 bio, 5 to 95 million.']);
  });

  it('works the other way round too, and adds up a signal per genus', () => {
    expect(heard(jump, star, planet(2), signals(2, 2))).toEqual(['2: 2 bio, 100 million.']);
  });

  it('stays quiet for a rescan, and for a body with no life', () => {
    expect(heard(jump, star, signals(2, 1), planet(2), planet(2), planet(3))).toHaveLength(1);
  });
});

describe('spoken forms', () => {
  it('drops the system from a body name', () => {
    expect(spokenBodyName(`${SYSTEM} A 1 a`, SYSTEM)).toBe('A 1 a');
    expect(spokenBodyName('Earth', 'Sol')).toBe('Earth');
  });

  it('says credits the short way', () => {
    expect(spokenCredits(1_234_567)).toBe('1.2 million');
    expect(spokenCredits(19_010_800)).toBe('19 million');
    expect(spokenCredits(450_000)).toBe('450 thousand');
  });
});
