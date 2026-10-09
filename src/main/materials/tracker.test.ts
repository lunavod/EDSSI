import { describe, expect, it } from 'vitest';

import type { JournalEvent, JournalEventMap } from '../../shared/journal';
import { HISTORY_LIMIT, MaterialsTracker } from './tracker';

let clock = Date.parse('2026-09-10T10:00:00Z');

function logged(fields: Record<string, unknown>): JournalEvent {
  clock += 1000;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test payloads, like parsed JSON.
  return {
    timestamp: new Date(clock).toISOString().replace('.000', ''),
    ...fields,
  } as JournalEvent;
}

function track(...events: JournalEvent[]): MaterialsTracker {
  const tracker = new MaterialsTracker();
  for (const event of events) tracker.apply(event);
  return tracker;
}

const materials = (raw: Record<string, number>, manufactured: Record<string, number> = {}) =>
  logged({
    event: 'Materials',
    Raw: Object.entries(raw).map(([Name, Count]) => ({ Name, Count })),
    Manufactured: Object.entries(manufactured).map(([Name, Count]) => ({ Name, Count })),
    Encoded: [],
  });

const refill = () =>
  logged({
    event: 'Synthesis',
    Name: 'Module Repair Basic',
    Materials: [
      { Name: 'nickel', Count: 2 },
      { Name: 'zinc', Count: 2 },
      { Name: 'chromium', Count: 2 },
      { Name: 'vanadium', Count: 3 },
    ],
  });

describe('MaterialsTracker', () => {
  it('counts materials from the login list and every change after it', () => {
    const tracker = track(
      materials({ iron: 20, nickel: 5 }),
      logged({ event: 'MaterialCollected', Category: 'Raw', Name: 'nickel', Count: 3 }),
      logged({ event: 'MaterialDiscarded', Category: 'Raw', Name: 'iron', Count: 2 }),
      logged({
        event: 'MaterialTrade',
        MarketID: 1,
        TraderType: 'raw',
        Paid: { Material: 'iron', Category: 'Raw', Quantity: 6 },
        Received: { Material: 'Zinc', Category: 'Raw', Quantity: 2 },
      }),
      logged({
        event: 'MissionCompleted',
        MaterialsReward: [{ Name: 'nickel', Category: 'Raw', Count: 4 }],
      }),
    );
    expect(tracker.inventory()).toEqual({ iron: 12, nickel: 12, zinc: 2 });
  });

  it('takes a synthesis out of the materials and records it by recipe', () => {
    const tracker = track(
      materials({ nickel: 10, zinc: 10, chromium: 10, vanadium: 10 }),
      refill(),
      refill(),
    );
    expect(tracker.inventory()).toEqual({ nickel: 6, zinc: 6, chromium: 6, vanadium: 4 });
    expect(tracker.history()).toEqual([
      expect.objectContaining({
        kind: 'synthesis',
        recipe: 'synthesis:afm-refill:1',
        name: 'AFM Refill',
        grade: 1,
        count: 2,
      }),
    ]);
  });

  it('records engineering rolls and experimental effects', () => {
    const tracker = track(
      materials({}, { wornshieldemitters: 10, uncutfocuscrystals: 5, conductivepolymers: 3 }),
      logged({
        event: 'EngineerCraft',
        Slot: 'Slot03_Size6',
        Module: 'int_shieldgenerator_size6_class5',
        ApplyExperimentalEffect: 'special_shield_health',
        Ingredients: [
          { Name: 'wornshieldemitters', Count: 5 },
          { Name: 'uncutfocuscrystals', Count: 3 },
          { Name: 'conductivepolymers', Count: 1 },
        ],
        Engineer: 'Lei Cheung',
        BlueprintName: 'ShieldGenerator_Optimised',
        Level: 5,
        ExperimentalEffect_Localised: 'Hi-Cap',
      }),
      logged({
        event: 'EngineerCraft',
        Slot: 'Slot03_Size6',
        Module: 'int_shieldgenerator_size6_class5',
        Ingredients: [{ Name: 'wornshieldemitters', Count: 1 }],
        Engineer: 'Lei Cheung',
        BlueprintName: 'ShieldGenerator_Optimised',
        Level: 1,
      }),
    );
    expect(tracker.inventory()).toEqual({
      wornshieldemitters: 4,
      uncutfocuscrystals: 2,
      conductivepolymers: 2,
    });
    const [roll, experimental] = tracker.history();
    expect(experimental).toMatchObject({
      kind: 'experimental',
      recipe: 'experimental:special_shield_health',
      name: 'Hi-Cap',
    });
    expect(roll).toMatchObject({
      kind: 'engineering',
      recipe: 'engineering:shieldgenerator_optimised:shield-generator:1',
      grade: 1,
      detail: 'Shield Generator · Lei Cheung',
    });
  });

  it('reads cargo and the ship locker whole, ignoring an older file', () => {
    const tracker = track(
      logged({
        event: 'Cargo',
        Vessel: 'Ship',
        Count: 5,
        Inventory: [{ Name: 'Bromellite', Count: 5 }],
      }),
      logged({ event: 'Cargo', Vessel: 'Ship', Count: 7 }),
      logged({ event: 'Cargo', Vessel: 'SRV', Count: 1, Inventory: [{ Name: 'gold', Count: 1 }] }),
      logged({
        event: 'ShipLocker',
        Items: [],
        Components: [{ Name: 'aerogel', Count: 3 }],
        Data: [],
        Consumables: [],
      }),
    );
    expect(tracker.inventory()).toEqual({ bromellite: 5, aerogel: 3 });

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test payload
    const file = logged({
      event: 'Cargo',
      Vessel: 'Ship',
      Count: 7,
      Inventory: [{ Name: 'bromellite', Count: 7 }],
    }) as JournalEventMap['Cargo'];
    expect(tracker.applyCompanion(file)).toBe(true);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test payload
    const stale = {
      ...file,
      timestamp: '2020-01-01T00:00:00Z',
      Inventory: [],
    } as JournalEventMap['Cargo'];
    expect(tracker.applyCompanion(stale)).toBe(false);
    expect(tracker.inventory()['bromellite']).toBe(7);
  });

  it('keeps each commander to themselves', () => {
    const tracker = track(
      logged({ event: 'LoadGame', FID: 'F1', Commander: 'One' }),
      materials({ iron: 1 }),
      logged({ event: 'LoadGame', FID: 'F2', Commander: 'Two' }),
      materials({ nickel: 2 }),
    );
    expect(tracker.commander).toBe('Two');
    expect(tracker.inventory()).toEqual({ nickel: 2 });
  });

  it('keeps only the latest crafts', () => {
    const events = [materials({ iron: 1000 })];
    for (let index = 0; index < HISTORY_LIMIT + 10; index++) {
      // Alternating, so no two in a row fold together.
      events.push(
        logged({
          event: 'Synthesis',
          Name: index % 2 ? 'Life Support Basic' : 'Repair Basic',
          Materials: [
            { Name: 'iron', Count: 2 },
            { Name: 'nickel', Count: 1 },
          ],
        }),
      );
    }
    expect(track(...events).history()).toHaveLength(HISTORY_LIMIT);
  });
});

describe('engineers', () => {
  it('takes the list at login, then each update', () => {
    const tracker = track(
      logged({
        event: 'EngineerProgress',
        Engineers: [
          { Engineer: "Tod 'The Blaster' McQuinn", EngineerID: 1, Progress: 'Unlocked', Rank: 3 },
          { Engineer: 'Felicity Farseer', EngineerID: 2, Progress: 'Invited' },
        ],
      }),
      logged({ event: 'EngineerProgress', Engineer: "Tod 'The Blaster' McQuinn", Rank: 4 }),
    );
    expect(tracker.engineers()).toEqual([
      { name: 'Tod McQuinn', progress: 'Unlocked', rank: 4 },
      { name: 'Felicity Farseer', progress: 'Invited' },
    ]);
  });
});

describe('ships', () => {
  it('keeps each ship as last fitted, and which is flown', () => {
    const loadout = (ShipID: number, Ship: string, level: number) =>
      logged({
        event: 'Loadout',
        Ship,
        ShipID,
        ShipName: 'Name',
        Modules: [
          {
            Slot: 'FrameShiftDrive',
            Item: 'Int_Hyperdrive_Size5_Class5',
            Engineering: { BlueprintName: 'FSD_LongRange', Level: level },
          },
          { Slot: 'Slot01_Size6', Item: 'int_cargorack_size6_class1' },
        ],
      });
    const tracker = track(
      loadout(1, 'Anaconda', 3),
      loadout(2, 'krait_mkii', 5),
      loadout(1, 'Anaconda', 4),
    );
    expect(tracker.ships()).toEqual([
      {
        shipId: 1,
        ship: 'anaconda',
        name: 'Name',
        current: true,
        modules: [
          {
            slot: 'FrameShiftDrive',
            item: 'int_hyperdrive_size5_class5',
            blueprint: 'FSD_LongRange',
            level: 4,
          },
          { slot: 'Slot01_Size6', item: 'int_cargorack_size6_class1' },
        ],
      },
      expect.objectContaining({ shipId: 2, current: false }),
    ]);
    tracker.apply(logged({ event: 'ShipyardSell', SellShipID: 2, ShipType: 'krait_mkii' }));
    expect(tracker.ships()).toHaveLength(1);
  });
});
