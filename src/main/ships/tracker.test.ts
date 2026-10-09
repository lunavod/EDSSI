import { describe, expect, it } from 'vitest';

import type { JournalEvent } from '../../shared/journal';
import { loadout } from './loadout-fixture';
import { ShipsTracker } from './tracker';

function event(name: string, fields: Record<string, unknown>): JournalEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the fields read are given
  return { timestamp: '2026-09-28T19:00:00Z', event: name, ...fields } as JournalEvent;
}

function tracked(...events: JournalEvent[]): ShipsTracker {
  const tracker = new ShipsTracker();
  tracker.apply(event('Commander', { FID: 'F1', Name: 'Jameson' }));
  for (const each of events) tracker.apply(each);
  return tracker;
}

describe('ShipsTracker', () => {
  it('keeps each ship’s last loadout and every slot ever seen filled on it', () => {
    const tracker = tracked(
      loadout([
        { Slot: 'Slot07_Size5', Item: 'int_cargorack_size5_class1' },
        { Slot: 'PaintJob', Item: 'paintjob_red' },
      ]),
      loadout([{ Slot: 'Slot01_Size6', Item: 'int_shieldgenerator_size6_class3' }], {
        timestamp: '2026-09-28T20:00:00Z',
      }),
    );
    const [ship] = tracker.ships();
    expect(tracker.current).toBe(7);
    expect(ship?.loadout?.timestamp).toBe('2026-09-28T20:00:00Z');
    expect([...(ship?.seen.keys() ?? [])]).toEqual(['slot07_size5', 'slot01_size6']);
    expect(ship).toMatchObject({ name: 'Roadrunner', ident: 'RR-01', ship: 'cobra' });
  });

  it('knows where a ship was left, and forgets ships that were sold', () => {
    const tracker = tracked(
      loadout([], { ShipID: 1, Ship: 'cobra' }),
      event('Docked', { StationName: 'Jameson Memorial', StarSystem: 'Shinrarta Dezhra' }),
      event('ShipyardSwap', {
        ShipType: 'anaconda',
        ShipID: 2,
        StoreOldShip: 'cobra',
        StoreShipID: 1,
      }),
      loadout([], { ShipID: 2, Ship: 'anaconda' }),
      event('ShipyardBuy', { ShipType: 'sidewinder', StoreShipID: 2, SellShipID: 9 }),
      event('ShipyardNew', { ShipType: 'sidewinder', NewShipID: 3 }),
    );
    const byId = new Map(tracker.ships().map((ship) => [ship.shipId, ship]));
    expect(tracker.current).toBe(3);
    expect(byId.get(1)?.where).toBe('Jameson Memorial, Shinrarta Dezhra');
    expect(byId.get(2)?.where).toBe('Jameson Memorial, Shinrarta Dezhra');
    expect(byId.get(3)?.where).toBeUndefined();

    tracker.apply(event('ShipyardSell', { ShipType: 'cobra', SellShipID: 1 }));
    expect(tracker.ships().map((ship) => ship.shipId)).toEqual([2, 3]);
  });

  it("takes the shipyard's list as the whole fleet", () => {
    const tracker = tracked(
      loadout([], { ShipID: 1 }),
      loadout([], { ShipID: 2, Ship: 'python' }),
      loadout([], { ShipID: 3, Ship: 'adder' }),
      event('StoredShips', {
        StationName: 'Abraham Lincoln',
        StarSystem: 'Sol',
        ShipsHere: [{ ShipID: 1, ShipType: 'cobra', Value: 1, Hot: false }],
        ShipsRemote: [
          {
            ShipID: 4,
            ShipType: 'krait_mkii',
            ShipType_Localised: 'Krait Mk II',
            StarSystem: 'Deciat',
            InTransit: true,
            Value: 1,
            Hot: false,
          },
        ],
      }),
    );
    const byId = new Map(tracker.ships().map((ship) => [ship.shipId, ship]));
    // 2 was neither listed nor flown: gone. 3 is the one being flown.
    expect([...byId.keys()].toSorted((a, b) => a - b)).toEqual([1, 3, 4]);
    expect(byId.get(1)?.where).toBe('Abraham Lincoln, Sol');
    expect(byId.get(4)).toMatchObject({ where: 'Deciat', inTransit: true, type: 'Krait Mk II' });
    expect(byId.get(4)?.loadout).toBeUndefined();
  });

  it('ignores taxis and fighters, and keeps each commander’s fleet apart', () => {
    const tracker = tracked(
      loadout([], { ShipID: 1 }),
      loadout([], { ShipID: 50, Ship: 'adder_taxi' }),
      event('Commander', { FID: 'F2', Name: 'Other' }),
      loadout([], { ShipID: 1, Ship: 'eagle' }),
    );
    expect(tracker.ships().map((ship) => ship.ship)).toEqual(['eagle']);
    tracker.apply(event('LoadGame', { FID: 'F1', Commander: 'Jameson' }));
    expect(tracker.ships().map((ship) => ship.ship)).toEqual(['cobra']);
  });
});

describe('ShipsTracker transfers', () => {
  it('keeps where a transferred ship is going while the shipyard lists it without a system', () => {
    const tracker = tracked(
      event('Docked', { StationName: 'G9N-T7J', StarSystem: 'L 190-21' }),
      loadout([], { ShipID: 1 }),
      event('StoredShips', {
        StationName: 'G9N-T7J',
        StarSystem: 'L 190-21',
        ShipsHere: [],
        ShipsRemote: [{ ShipID: 9, ShipType: 'type9', Value: 1, Hot: false }],
      }),
      event('ShipyardTransfer', {
        ShipType: 'Type9',
        ShipID: 9,
        System: 'Far away',
        TransferTime: 2671,
      }),
      event('StoredShips', {
        StationName: 'G9N-T7J',
        StarSystem: 'L 190-21',
        ShipsHere: [],
        ShipsRemote: [{ ShipID: 9, ShipType: 'type9', InTransit: true, Value: 1, Hot: false }],
      }),
    );
    const type9 = tracker.ships().find((ship) => ship.shipId === 9);
    expect(type9).toMatchObject({
      where: 'G9N-T7J, L 190-21',
      inTransit: true,
      arrivesAt: '2026-09-28T19:44:31.000Z',
    });
  });
});
