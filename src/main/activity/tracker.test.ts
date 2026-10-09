import { describe, expect, it } from 'vitest';

import type { JournalEvent } from '../../shared/journal';
import { resolvePeriod } from './periods';
import { describeSegment, journey, summarise, visits } from './summary';
import { ActivityTracker, IDLE_GAP_MS } from './tracker';

let clock = Date.parse('2026-09-10T10:00:00Z');

function at(timestamp: string, fields: Record<string, unknown>): JournalEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test payloads, like parsed JSON.
  return { timestamp, ...fields } as JournalEvent;
}

function logged(fields: Record<string, unknown>, gapMs = 60_000): JournalEvent {
  clock += gapMs;
  return at(new Date(clock).toISOString(), fields);
}

function track(...events: JournalEvent[]): ActivityTracker {
  const tracker = new ActivityTracker();
  for (const event of events) tracker.apply(event);
  return tracker;
}

const start = () => [
  logged({ event: 'Fileheader', part: 1, Odyssey: true }),
  logged({ event: 'LoadGame', FID: 'F1', Commander: 'Jameson', Credits: 1000, Ship: 'Mandalay' }),
];
const jumpFields = (address: number, name: string, distance: number, x = 0) => ({
  event: 'FSDJump',
  StarSystem: name,
  SystemAddress: address,
  StarPos: [x, 0, 0],
  JumpDist: distance,
});
const jump = (address: number, name: string, distance = 40, x = 0) =>
  logged(jumpFields(address, name, distance, x));
const scan = (address: number, system: string, bodyId: number, fields = {}) =>
  logged({
    event: 'Scan',
    BodyName: `${system} ${bodyId}`,
    BodyID: bodyId,
    StarSystem: system,
    SystemAddress: address,
    PlanetClass: 'Rocky body',
    MassEM: 0.1,
    WasDiscovered: false,
    WasMapped: false,
    ...fields,
  });
const docked = (station: string, system: string) =>
  logged({ event: 'Docked', StationName: station, StationType: 'Coriolis', StarSystem: system });

const local = (day: number, hour: number) => new Date(2026, 8, day, hour).toISOString();

const ALL = { from: 0, to: Number.MAX_SAFE_INTEGER, label: 'all' };

describe('ActivityTracker', () => {
  it('adds up travel, discoveries and money over a period', () => {
    const tracker = track(
      ...start(),
      jump(1, 'Alpha', 30, 30),
      jump(2, 'Beta', 50, 80),
      scan(2, 'Beta', 1, { PlanetClass: 'Earthlike body', MassEM: 1 }),
      // Coming back to a body scans it again; that isn't a second discovery.
      scan(2, 'Beta', 1),
      logged({
        event: 'SAAScanComplete',
        BodyName: 'Beta 1',
        SystemAddress: 2,
        BodyID: 1,
        ProbesUsed: 4,
        EfficiencyTarget: 6,
      }),
      jump(1, 'Alpha', 50, 30),
      docked('Port', 'Alpha'),
      logged({
        event: 'SellExplorationData',
        Systems: ['Beta'],
        Discovered: [],
        BaseValue: 900_000,
        Bonus: 100_000,
        TotalEarnings: 1_000_000,
      }),
      logged({ event: 'RefuelAll', Cost: 500, Amount: 10 }),
    );

    const summary = summarise(tracker.current, ALL);
    expect(summary).toMatchObject({
      travel: {
        jumps: 3,
        distance_ly: 130,
        systems_visited: 2,
        never_visited_before: 2,
        stations: ['Port'],
        longest_jump: '50 ly to Beta',
        farthest_from_sol: '80 ly, at Beta',
      },
      exploration: {
        bodies_scanned: 1,
        first_discoveries: 1,
        bodies_mapped: 1,
        mapped_efficiently: 1,
        notable_bodies: [{ body: 'Beta 1', mapped: true, first_discovery: true }],
      },
      money: {
        earned_cr: 1_000_000,
        spent_cr: 500,
        net_cr: 999_500,
        earned_by: { exploration: 1_000_000 },
      },
    });
  });

  it('counts time away from the game as not played', () => {
    const tracker = track(
      ...start(),
      logged({ event: 'Music' }, 10 * 60_000),
      logged({ event: 'Music' }, IDLE_GAP_MS + 60_000),
      logged({ event: 'Music' }, 5 * 60_000),
    );
    // A minute of loading and ten of play, then a fresh span of five.
    expect(summarise(tracker.current, ALL)['minutes_played']).toBe(16);
  });

  it('keeps missions until they are finished or the game stops listing them', () => {
    const accepted = (id: number, name: string) =>
      logged({
        event: 'MissionAccepted',
        MissionID: id,
        Name: name,
        Faction: 'Pilots',
        Wing: false,
      });
    const tracker = track(
      ...start(),
      accepted(1, 'Mission_Courier'),
      accepted(2, 'Mission_Delivery'),
      accepted(3, 'Mission_Massacre'),
      logged({
        event: 'MissionCompleted',
        MissionID: 1,
        Name: 'Mission_Courier',
        Faction: 'Pilots',
        Reward: 5000,
      }),
      logged({
        event: 'Missions',
        Active: [{ MissionID: 3, Name: 'Mission_Massacre' }],
        Failed: [],
        Complete: [],
      }),
    );
    expect([...tracker.current.missions.keys()]).toEqual(['3']);
    expect(summarise(tracker.current, ALL)).toMatchObject({
      missions: { accepted: 3, completed: 1, rewards_cr: 5000 },
      money: { earned_by: { missions: 5000 } },
    });
  });

  it('notes a species as new only the first time it is analysed', () => {
    const organic = (body: number) =>
      logged({
        event: 'ScanOrganic',
        ScanType: 'Analyse',
        Genus: '$Codex_Ent_Bacterial_Genus_Name;',
        Species: '$Codex_Ent_Bacterial_04_Name;',
        Species_Localised: 'Bacterium Acies',
        SystemAddress: 2,
        Body: body,
      });
    const tracker = track(
      ...start(),
      jump(2, 'Beta'),
      scan(2, 'Beta', 1, { WasFootfalled: false }),
      organic(1),
      organic(3),
    );
    const organics = tracker.current.records.filter((record) => record.kind === 'organic');
    expect(organics.map((record) => [record.body, record.newSpecies])).toEqual([
      ['Beta 1', true],
      ['Beta #3', false],
    ]);
    // First footfall pays five times the base.
    expect(organics[0]!.value).toBe(organics[1]!.value! * 5);
  });

  it('tells the journey as stops and the legs between them', () => {
    const tracker = track(
      ...start(),
      jump(1, 'Alpha'),
      docked('Port', 'Alpha'),
      jump(2, 'Beta'),
      scan(2, 'Beta', 1),
      jump(3, 'Gamma'),
      jump(4, 'Delta'),
      logged({
        event: 'Touchdown',
        PlayerControlled: true,
        Body: 'Delta 2',
        StarSystem: 'Delta',
        OnPlanet: true,
      }),
    );

    expect(journey(tracker.current, ALL).map(describeSegment)).toMatchObject([
      { type: 'travel', to: 'Alpha', jumps: 1 },
      { type: 'stop', system: 'Alpha', docked_at: ['Port'] },
      { type: 'travel', from: 'Alpha', to: 'Delta', jumps: 3, bodies_scanned_on_the_way: 1 },
      { type: 'stop', system: 'Delta', landed_on: ['Delta 2'], left: 'still here' },
    ]);
    expect(visits(tracker.current, 'port', Number.MAX_SAFE_INTEGER).places).toMatchObject([
      { name: 'Port', what: 'docked', system: 'Alpha', times: 1 },
    ]);
  });

  it("splits the record by the commander's six o'clock day", () => {
    const tracker = track(
      at(local(12, 22), jumpFields(1, 'Evening', 10)),
      at(local(13, 2), jumpFields(2, 'Small hours', 20)),
      at(local(13, 7), jumpFields(3, 'Morning', 30)),
    );

    const today = resolvePeriod('today', new Date(2026, 8, 13, 3), { sessionStarts: [] });
    expect(typeof today === 'string' ? today : summarise(tracker.current, today)).toMatchObject({
      travel: { jumps: 2, distance_ly: 30, ended_in: 'Small hours' },
    });
  });
});
