import { describe, expect, it } from 'vitest';

import type { JournalEvent } from '../../shared/journal';
import { CarriersTracker } from './tracker';

const ID = 3710725120;
const SQUADRON = 3700112384;

function event(at: string, name: string, fields: Record<string, unknown> = {}): JournalEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the fields read are given
  return { timestamp: `2026-09-28T${at}Z`, event: name, ...fields } as JournalEvent;
}

function stats(at: string, fields: { fuel: number; cargo: number; crew?: number }): JournalEvent {
  const crew = fields.crew ?? 920;
  return event(at, 'CarrierStats', {
    CarrierID: ID,
    CarrierType: 'FleetCarrier',
    Callsign: 'G9N-T7J',
    Name: 'HI ZEV',
    DockingAccess: 'squadronfriends',
    AllowNotorious: false,
    FuelLevel: fields.fuel,
    JumpRangeCurr: 500,
    JumpRangeMax: 500,
    PendingDecommission: false,
    SpaceUsage: {
      TotalCapacity: 25000,
      Crew: crew,
      Cargo: fields.cargo,
      CargoSpaceReserved: 0,
      ShipPacks: 0,
      ModulePacks: 0,
      FreeSpace: 25000 - crew - fields.cargo,
    },
    Finance: { CarrierBalance: 610e6, ReserveBalance: 610e6, AvailableBalance: 0 },
    Crew: [
      { CrewRole: 'Captain', Activated: true, Enabled: true },
      { CrewRole: 'Refuel', Activated: true, Enabled: true },
      { CrewRole: 'Rearm', Activated: false },
      { CrewRole: 'Exploration', Activated: true, Enabled: false },
    ],
    ShipPacks: [],
    ModulePacks: [],
  });
}

function arrive(at: string, system: string, pos: number[]): JournalEvent {
  return event(at, 'FSDJump', { StarSystem: system, SystemAddress: 1, StarPos: pos });
}

function located(at: string, system: string, address: number, id = ID): JournalEvent {
  const type = id === SQUADRON ? 'SquadronCarrier' : 'FleetCarrier';
  return event(at, 'CarrierLocation', {
    CarrierID: id,
    CarrierType: type,
    StarSystem: system,
    SystemAddress: address,
    BodyID: 0,
  });
}

function tracked(...events: JournalEvent[]): CarriersTracker {
  const tracker = new CarriersTracker();
  tracker.apply(event('00:00:00', 'Commander', { FID: 'F1', Name: 'Jameson' }));
  for (const each of events) tracker.apply(each);
  return tracker;
}

const docked = event('10:00:00', 'Docked', {
  StationName: 'G9N-T7J',
  StationType: 'FleetCarrier',
  MarketID: ID,
});

describe('CarriersTracker', () => {
  it('adds up transfers and trades while docked on the carrier, not an SRV’s', () => {
    const tracker = tracked(
      stats('09:00:00', { fuel: 1000, cargo: 0 }),
      docked,
      event('10:01:00', 'CargoTransfer', {
        Transfers: [
          { Type: 'tritium', Count: 500, Direction: 'tocarrier' },
          { Type: 'water', Count: 7, Direction: 'tocarrier' },
        ],
      }),
      event('10:02:00', 'CargoTransfer', {
        Transfers: [{ Type: 'tritium', Count: 100, Direction: 'toship' }],
      }),
      event('10:03:00', 'MarketSell', { MarketID: ID, Type: 'bromellite', Count: 11 }),
      event('10:04:00', 'MarketBuy', { MarketID: 99, Type: 'gold', Count: 4 }),
      event('10:05:00', 'Undocked', {}),
      event('10:06:00', 'CargoTransfer', {
        Transfers: [{ Type: 'water', Count: 2, Direction: 'toship' }],
      }),
    );
    const [carrier] = tracker.views();
    expect(carrier?.cargo.map((item) => [item.name, item.count])).toEqual([
      ['Tritium', 400],
      ['Bromellite', 11],
      ['Water', 7],
    ]);
    expect(carrier?.space).toMatchObject({ cargo: 418, free: 25000 - 920 - 418 });
    expect(carrier?.unaccounted).toBeUndefined();
    expect(carrier?.services).toEqual([
      { role: 'Refuel', name: 'Refuel', state: 'active', weekly: 1_500_000 },
      {
        role: 'Exploration',
        name: 'Universal Cartographics',
        state: 'suspended',
        weekly: 700_000,
      },
    ]);
  });

  it('says how much the carrier holds that the journal didn’t account for', () => {
    const tracker = tracked(
      docked,
      event('10:01:00', 'CargoTransfer', {
        Transfers: [{ Type: 'tritium', Count: 500, Direction: 'tocarrier' }],
      }),
      stats('11:00:00', { fuel: 1000, cargo: 620 }),
    );
    expect(tracker.views()[0]?.unaccounted).toBe(120);
  });

  it('moves the carrier when its jump leaves, and takes the tritium it burned off the tank', () => {
    const tracker = tracked(
      arrive('08:00:00', 'Col 285 Sector IJ-F c12-2', [-118.78125, 210.4375, 161.46875]),
      arrive('08:30:00', 'Kwamindjara', [117.34375, -198.625, 15.40625]),
      located('09:00:00', 'Col 285 Sector IJ-F c12-2', 633407181554),
      stats('09:10:00', { fuel: 948, cargo: 1716 }),
      event('09:20:00', 'CarrierJumpRequest', {
        CarrierID: ID,
        CarrierType: 'FleetCarrier',
        SystemName: 'Kwamindjara',
        Body: 'Kwamindjara ABC 1',
        SystemAddress: 7269634221489,
        BodyID: 18,
        DepartureTime: '2026-09-28T09:36:10Z',
      }),
    );
    let [carrier] = tracker.views();
    expect(carrier?.jump).toMatchObject({
      system: 'Kwamindjara',
      departs: '2026-09-28T09:36:10.000Z',
    });
    expect(tracker.nextDue()).toBe(Date.parse('2026-09-28T09:36:10Z'));

    expect(tracker.settle(Date.parse('2026-09-28T09:36:11Z'))).toBe(true);
    [carrier] = tracker.views();
    expect(carrier).toMatchObject({
      system: 'Kwamindjara',
      body: 'Kwamindjara ABC 1',
      arrivedAt: '2026-09-28T09:36:10.000Z',
      distanceLy: 0,
    });
    expect(carrier?.jump).toBeUndefined();
    expect(carrier?.fuel).toMatchObject({ estimated: true, uncounted: 0 });
    // The game burned 76 t on this jump.
    expect(carrier?.fuel?.level).toBe(872);

    // The location that follows changes nothing, and a new reading replaces the estimate.
    tracker.apply(located('09:36:10', 'Kwamindjara', 7269634221489));
    tracker.apply(stats('10:00:00', { fuel: 872, cargo: 1716 }));
    expect(tracker.views()[0]?.fuel).toEqual({
      level: 872,
      readAt: '2026-09-28T10:00:00Z',
      estimated: false,
      uncounted: 0,
    });
  });

  it('forgets a cancelled jump, and counts a jump it can’t place as uncounted', () => {
    const tracker = tracked(
      located('09:00:00', 'Somewhere', 1),
      stats('09:10:00', { fuel: 900, cargo: 0 }),
      event('09:20:00', 'CarrierJumpRequest', {
        CarrierID: ID,
        SystemName: 'Elsewhere',
        SystemAddress: 2,
        BodyID: 0,
        DepartureTime: '2026-09-28T09:36:10Z',
      }),
      event('09:25:00', 'CarrierJumpCancelled', { CarrierID: ID }),
    );
    expect(tracker.settle(Date.parse('2026-09-28T10:00:00Z'))).toBe(false);
    expect(tracker.views()[0]?.system).toBe('Somewhere');

    tracker.apply(located('12:00:00', 'Far Away', 3));
    expect(tracker.views()[0]).toMatchObject({
      system: 'Far Away',
      fuel: { level: 900, estimated: false, uncounted: 1 },
    });
    expect(tracker.missingPositions()).toEqual(['Far Away', 'Somewhere']);
  });

  it('keeps the squadron’s carrier apart, and drops it on leaving the squadron', () => {
    const tracker = tracked(
      located('09:00:00', 'Kwamindjara', 7269634221489),
      located('09:00:01', 'Algorab', 241828889780, SQUADRON),
    );
    expect(tracker.views().map((carrier) => [carrier.kind, carrier.system])).toEqual([
      ['own', 'Kwamindjara'],
      ['squadron', 'Algorab'],
    ]);
    tracker.apply(event('10:00:00', 'LeftSquadron', { SquadronName: 'SWS' }));
    expect(tracker.views().map((carrier) => carrier.kind)).toEqual(['own']);
  });

  it('works out the weekly upkeep from the services, and the jumps the next charge adds', () => {
    const tracker = tracked(
      located('09:00:00', 'Somewhere', 1),
      stats('09:10:00', { fuel: 900, cargo: 0 }),
      event('09:20:00', 'CarrierCrewServices', {
        CarrierID: ID,
        CrewRole: 'VistaGenomics',
        Operation: 'Activate',
        CrewName: 'Del Campos',
      }),
      event('09:30:00', 'CarrierJumpRequest', {
        CarrierID: ID,
        SystemName: 'Elsewhere',
        SystemAddress: 2,
        BodyID: 0,
        DepartureTime: '2026-09-28T09:46:10Z',
      }),
    );
    tracker.settle(Date.parse('2026-09-28T10:00:00Z'));
    const upkeep = tracker.views(Date.parse('2026-09-28T10:00:00Z'))[0]?.upkeep;
    // 5M base, refuel 1.5M, cartographics suspended 0.7M, Vista Genomics 1.5M.
    expect(upkeep).toMatchObject({
      weekly: 8_700_000,
      jumpsThisWeek: 1,
      nextCharge: 8_800_000,
      nextChargeAt: '2026-10-01T07:00:00.000Z',
      balance: 610e6,
      weeksCovered: 70,
    });
  });

  it('only takes fuel deposits made to the commander’s own carriers', () => {
    const tracker = tracked(
      stats('09:00:00', { fuel: 500, cargo: 0 }),
      event('09:10:00', 'CarrierDepositFuel', { CarrierID: 42, Amount: 100, Total: 300 }),
      event('09:20:00', 'CarrierDepositFuel', { CarrierID: ID, Amount: 500, Total: 1000 }),
    );
    expect(tracker.views().map((carrier) => carrier.fuel?.level)).toEqual([1000]);
  });
});
