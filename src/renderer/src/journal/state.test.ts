import { describe, expect, it } from 'vitest';

import type { JournalEvent, JournalMessage } from '../../../shared/journal';
import {
  applyEvent,
  emptyJournalState,
  initialJournalSync,
  journalSyncReducer,
  stateFromSnapshot,
} from './state';

const at = '2026-09-10T10:00:00Z';
const fileheader = { timestamp: at, event: 'Fileheader', part: 1 } as JournalEvent;
const loadGame = {
  timestamp: at,
  event: 'LoadGame',
  Commander: 'Jameson',
  Ship: 'type9',
  Ship_Localised: 'Type-9 Heavy',
  ShipName: 'Hauler',
} as JournalEvent;
const docked = {
  timestamp: at,
  event: 'Docked',
  StationName: 'Jameson Memorial',
  StarSystem: 'Shinrarta Dezhra',
} as JournalEvent;
const undocked = {
  timestamp: at,
  event: 'Undocked',
  StationName: 'Jameson Memorial',
} as JournalEvent;

function eventMessage(seq: number, event: JournalEvent): JournalMessage {
  return { seq, kind: 'event', event };
}

const names = (state: { entries: { event: JournalEvent }[] }) =>
  state.entries.map(({ event }) => event.event);

describe('applyEvent', () => {
  it('tracks commander, ship, system and station', () => {
    const state = [loadGame, docked].reduce(applyEvent, emptyJournalState);
    expect(state.overview).toEqual({
      commander: 'Jameson',
      ship: 'Type-9 Heavy',
      shipName: 'Hauler',
      system: 'Shinrarta Dezhra',
      station: 'Jameson Memorial',
      stationDetails: {},
    });
    expect(applyEvent(state, undocked).overview.station).toBeUndefined();
    expect(applyEvent(state, undocked).overview.stationDetails).toBeUndefined();
  });

  it('keeps what docking and the loadout say for the side panel', () => {
    const dockedAt = {
      ...docked,
      StationType: 'Coriolis',
      LandingPads: { Small: 4, Medium: 6, Large: 2 },
      StationServices: ['commodities', 'shipyard'],
    } as JournalEvent;
    const loadout = {
      timestamp: at,
      event: 'Loadout',
      ShipName: 'Hauler',
      ShipIdent: 'PR-10E',
      MaxJumpRange: 81.9,
      CargoCapacity: 720,
      FuelCapacity: { Main: 128, Reserve: 1.1 },
    } as JournalEvent;
    const { overview } = [loadGame, dockedAt, loadout].reduce(applyEvent, emptyJournalState);
    expect(overview).toMatchObject({
      shipIdent: 'PR-10E',
      fuelCapacity: 128,
      maxJumpRange: 81.9,
      cargoCapacity: 720,
      stationDetails: { type: 'Coriolis', largestPad: 'L', services: ['commodities', 'shipyard'] },
    });
  });

  it('keeps entries newest first with unique ids', () => {
    const state = [loadGame, docked].reduce(applyEvent, emptyJournalState);
    expect(names(state)).toEqual(['Docked', 'LoadGame']);
    expect(state.entries.map(({ id }) => id)).toEqual([1, 0]);
  });

  it('tracks the current system, its details and its arrival star', () => {
    const sol = 10477373803;
    const location = {
      timestamp: at,
      event: 'Location',
      StarSystem: 'Sol',
      SystemAddress: sol,
      SystemAllegiance: 'Federation',
      SystemEconomy: '$economy_Refinery;',
      SystemEconomy_Localised: 'Refinery',
      SystemGovernment: '$government_Democracy;',
      SystemGovernment_Localised: 'Democracy',
      SystemSecurity: '$SYSTEM_SECURITY_high;',
      SystemSecurity_Localised: 'High Security',
      Population: 22780919531,
      Docked: false,
    } as JournalEvent;
    const arrivalScan = {
      timestamp: at,
      event: 'Scan',
      ScanType: 'AutoScan',
      BodyName: 'Sol',
      BodyID: 0,
      StarSystem: 'Sol',
      SystemAddress: sol,
      DistanceFromArrivalLS: 0,
      StarType: 'G',
    } as JournalEvent;
    const charging = {
      timestamp: at,
      event: 'StartJump',
      JumpType: 'Hyperspace',
      StarSystem: 'Alpha Centauri',
      SystemAddress: 1,
      StarClass: 'G',
    } as JournalEvent;
    const jump = {
      timestamp: at,
      event: 'FSDJump',
      StarSystem: 'Alpha Centauri',
      SystemAddress: 1,
      SystemAllegiance: '',
      SystemEconomy_Localised: 'None',
      Population: 0,
    } as JournalEvent;

    let state = applyEvent(emptyJournalState, location);
    expect(state.overview).toMatchObject({
      system: 'Sol',
      systemAddress: sol,
      systemDetails: {
        allegiance: 'Federation',
        economy: 'Refinery',
        government: 'Democracy',
        security: 'High Security',
        population: 22780919531,
      },
    });
    expect(state.overview.starClass).toBeUndefined();

    state = applyEvent(state, arrivalScan);
    expect(state.overview.starClass).toBe('G');

    state = [charging, jump].reduce(applyEvent, state);
    expect(state.overview).toMatchObject({
      system: 'Alpha Centauri',
      starClass: 'G',
      systemDetails: { allegiance: undefined, economy: 'None', population: 0 },
    });
    expect(state.overview.charging).toBeUndefined();
  });

  it('starts over when a new game session begins, but keeps the overview', () => {
    const before = [loadGame, docked].reduce(applyEvent, emptyJournalState);
    const state = applyEvent(before, fileheader);
    expect(names(state)).toEqual(['Fileheader']);
    expect(state.overview).toEqual(before.overview);
  });
});

describe('journalSyncReducer', () => {
  it('holds messages until the snapshot, then applies only the ones it lacks', () => {
    let state = journalSyncReducer(initialJournalSync, {
      type: 'message',
      message: eventMessage(2, docked),
    });
    state = journalSyncReducer(state, { type: 'message', message: eventMessage(3, undocked) });
    expect(state.journal.entries).toEqual([]);

    // The snapshot already covers seq 1–2; only seq 3 must be applied on top.
    state = journalSyncReducer(state, {
      type: 'snapshot',
      snapshot: { seq: 2, events: [loadGame, docked], companions: {}, overview: {} },
    });
    expect(state.seq).toBe(3);
    expect(names(state.journal)).toEqual(['Undocked', 'Docked', 'LoadGame']);
    expect(state.journal.entries.map(({ id }) => id)).toEqual([2, 1, 0]);
  });

  it('ignores a stale snapshot', () => {
    const synced = journalSyncReducer(initialJournalSync, {
      type: 'snapshot',
      snapshot: { seq: 5, events: [loadGame], companions: {}, overview: {} },
    });
    expect(
      journalSyncReducer(synced, {
        type: 'snapshot',
        snapshot: { seq: 4, events: [], companions: {}, overview: {} },
      }),
    ).toBe(synced);
  });

  it('stores companion updates', () => {
    const synced = journalSyncReducer(initialJournalSync, {
      type: 'snapshot',
      snapshot: { seq: 0, events: [], companions: {}, overview: {} },
    });
    const status = { timestamp: at, event: 'Status', Flags: 16 } as const;
    const next = journalSyncReducer(synced, {
      type: 'message',
      message: { seq: 1, kind: 'companion', name: 'Status', event: status },
    });
    expect(next.journal.companions.Status).toEqual(status);
  });

  it('atomically replaces an overview captured during history replay', () => {
    const synced = journalSyncReducer(initialJournalSync, {
      type: 'snapshot',
      snapshot: {
        seq: 3,
        events: [],
        companions: {},
        overview: { system: 'Pru Aihm VY-R c4-35', credits: 1_735_694_333 },
      },
    });
    const overview = { system: 'Great Annihilator', credits: 5_123_456_789 };
    const next = journalSyncReducer(synced, {
      type: 'message',
      message: { seq: 4, kind: 'overview', overview },
    });
    expect(next.journal.overview).toEqual(overview);
    expect(next.seq).toBe(4);
  });
});

describe('ship locker snapshots', () => {
  const locker = (count: number): JournalEvent => ({
    timestamp: at,
    event: 'ShipLocker',
    Items: count > 0 ? [{ Name: 'x', OwnerID: 0, Count: count }] : [],
    Components: [],
    Consumables: [],
    Data: [],
  });
  const bare: JournalEvent = { timestamp: at, event: 'ShipLocker' };
  // Oldest first: first snapshot, a repeat, one without contents, a real change, a repeat.
  const events = [locker(0), locker(0), bare, locker(2), locker(2)];
  // Entries are newest first.
  const expected = [true, false, true, true, false];

  it('marks repeated or content-less snapshots as redundant', () => {
    const state = events.reduce(applyEvent, emptyJournalState);
    expect(state.entries.map(({ redundant }) => redundant)).toEqual(expected);
  });

  it('agrees when built from a snapshot', () => {
    const state = stateFromSnapshot({ seq: events.length, events, companions: {}, overview: {} });
    expect(state.entries.map(({ redundant }) => redundant)).toEqual(expected);
  });
});
