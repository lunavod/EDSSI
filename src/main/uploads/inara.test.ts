import { describe, expect, it, vi } from 'vitest';

import type { JournalEvent } from '../../shared/journal';
import { type GameState, initialGameState } from './game-state';
import { InaraApi, type InaraEntry } from './inara-api';
import { InaraTranslator } from './inara-events';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test lines are partial on purpose
const line = (fields: Record<string, unknown>) => fields as unknown as JournalEvent;

const T = '2026-09-12T16:07:35Z';

const state: GameState = {
  ...initialGameState(),
  commander: 'Jameson',
  systemName: 'Sol',
  coordinates: [0, 0, 0],
  stationName: 'Galileo',
  shipId: 7,
  shipType: 'krait_mkii',
};

function translate(translator: InaraTranslator, fields: Record<string, unknown>, at = state) {
  return translator.translate(line({ timestamp: T, ...fields }), at);
}

describe('InaraTranslator', () => {
  it('sends ranks once their progress is known', () => {
    const translator = new InaraTranslator();
    expect(translate(translator, { event: 'Rank', Combat: 4, Explore: 7 })).toEqual([]);
    expect(translate(translator, { event: 'Progress', Combat: 64, Explore: 47 })).toEqual([
      {
        eventName: 'setCommanderRankPilot',
        eventTimestamp: T,
        eventData: [
          { rankName: 'combat', rankValue: 4, rankProgress: 0.64 },
          { rankName: 'explore', rankValue: 7, rankProgress: 0.47 },
        ],
      },
    ]);
  });

  it('turns a jump into travel and minor faction reputation', () => {
    const events = translate(new InaraTranslator(), {
      event: 'FSDJump',
      StarSystem: 'Alpha Centauri',
      StarPos: [3, 0, 3],
      JumpDist: 4.38,
      Factions: [{ Name: 'Hutton Orbital Truckers', MyReputation: 50 }],
    });
    expect(events.map((event) => event.eventData)).toEqual([
      {
        starsystemName: 'Alpha Centauri',
        starsystemCoords: [3, 0, 3],
        jumpDistance: 4.38,
        shipType: 'krait_mkii',
        shipGameID: 7,
      },
      [{ minorfactionName: 'Hutton Orbital Truckers', minorfactionReputation: 0.5 }],
    ]);
  });

  it("doesn't count the Docked the game writes on login, or re-docking without leaving", () => {
    const translator = new InaraTranslator();
    translate(translator, {
      event: 'Location',
      StarSystem: 'Sol',
      StarPos: [0, 0, 0],
      Docked: true,
    });
    expect(translate(translator, { event: 'Docked', StationName: 'Galileo' })).toEqual([]);

    translate(translator, { event: 'Undocked' });
    expect(translate(translator, { event: 'Docked', StationName: 'Galileo' })).toEqual([]);

    translate(translator, { event: 'Undocked' });
    translate(translator, { event: 'SupercruiseEntry' });
    expect(translate(translator, { event: 'Docked', StationName: 'Abraham Lincoln' })).toEqual([
      expect.objectContaining({ eventName: 'addCommanderTravelDock' }),
    ]);
  });

  it('sends the hold only when it changed, and never from a pointer line', () => {
    const translator = new InaraTranslator();
    const hold = {
      event: 'Cargo',
      Vessel: 'Ship',
      Inventory: [
        { Name: 'drones', Count: 10 },
        { Name: 'drones', Count: 6, MissionID: 1 },
      ],
    };
    expect(translate(translator, hold)).toEqual([
      expect.objectContaining({
        eventName: 'setCommanderInventoryCargo',
        eventData: [{ itemName: 'drones', itemCount: 16 }],
      }),
    ]);
    expect(translate(translator, hold)).toEqual([]);
    expect(translate(translator, { event: 'Cargo', Vessel: 'Ship', Count: 16 })).toEqual([]);
  });

  it('leaves engineers Inara has no stage for', () => {
    const events = translate(new InaraTranslator(), {
      event: 'EngineerProgress',
      Engineers: [
        { Engineer: 'Hera Tani', Progress: 'Unlocked', Rank: 5 },
        { Engineer: 'Eleanor Bresa', Progress: 'Known' },
      ],
    });
    expect(events[0]?.eventData).toEqual([
      { engineerName: 'Hera Tani', rankStage: 'Unlocked', rankValue: 5 },
    ]);
  });

  it('marks travel by taxi instead of naming the ship', () => {
    const events = translate(
      new InaraTranslator(),
      { event: 'FSDJump', StarSystem: 'Sol', StarPos: [0, 0, 0], JumpDist: 1, Taxi: true },
      state,
    );
    expect(events[0]?.eventData).toMatchObject({ isTaxiShuttle: true });
    expect(events[0]?.eventData).not.toHaveProperty('shipGameID');
  });
});

describe('InaraApi', () => {
  const entry = (commander: string, eventName = 'setCommanderCredits'): InaraEntry => ({
    event: { eventName, eventTimestamp: T, eventData: {} },
    commander,
    frontierId: 'F123',
  });

  it("sends one commander's events with the app's header", async () => {
    let posted: unknown;
    const fetch = vi.fn(async (_url: string | URL | Request, request?: RequestInit) => {
      posted = JSON.parse(typeof request?.body === 'string' ? request.body : 'null');
      return Response.json({
        header: { eventStatus: 200 },
        events: [{ eventStatus: 200 }, { eventStatus: 400, eventStatusText: 'Bad' }],
      });
    });
    const api = new InaraApi({
      software: { name: 'EDSSI', version: '0.1.0' },
      isBeingDeveloped: true,
      fetch,
    });
    const result = await api.send(
      [entry('Jameson'), entry('Jameson', 'addCommanderTravelDock'), entry('Other')],
      'key',
    );

    expect(result).toEqual({
      kind: 'sent',
      accepted: 1,
      consumed: 2,
      refused: [{ event: 'addCommanderTravelDock', code: 400, message: 'Bad' }],
      message: undefined,
    });
    expect(posted).toMatchObject({
      header: {
        appName: 'EDSSI',
        appVersion: '0.1.0',
        isBeingDeveloped: true,
        APIkey: 'key',
        commanderName: 'Jameson',
        commanderFrontierID: 'F123',
      },
      events: [{ eventName: 'setCommanderCredits' }, { eventName: 'addCommanderTravelDock' }],
    });
  });

  it('stops when Inara refuses the request as a whole', async () => {
    const fetch = vi.fn(async () =>
      Response.json({ header: { eventStatus: 400, eventStatusText: 'Invalid API key.' } }),
    );
    const api = new InaraApi({
      software: { name: 'EDSSI', version: '0.1.0' },
      isBeingDeveloped: false,
      fetch,
    });
    expect(await api.send([entry('Jameson')], 'bad')).toEqual({
      kind: 'rejected',
      message: 'Inara: Invalid API key. (400)',
    });
  });
});
