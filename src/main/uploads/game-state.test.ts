import { describe, expect, it } from 'vitest';

import type { JournalEvent } from '../../shared/journal';
import { type GameState, initialGameState, liveGalaxyProblem, updateGameState } from './game-state';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test lines are partial on purpose
const line = (fields: Record<string, unknown>) => fields as unknown as JournalEvent;

function fold(...events: Record<string, unknown>[]): GameState {
  return events.map(line).reduce(updateGameState, initialGameState());
}

const header = { event: 'Fileheader', part: 1, gameversion: '4.4.1.1', build: 'r332841/r0 ' };
const loadGame = {
  event: 'LoadGame',
  Commander: 'Jameson',
  FID: 'F123',
  Ship: 'Krait_MkII',
  ShipID: 7,
  ShipName: 'Ahab',
  ShipIdent: 'AH-01',
};

describe('updateGameState', () => {
  it('follows the commander, the ship and where they are', () => {
    const state = fold(
      header,
      loadGame,
      {
        event: 'Location',
        StarSystem: 'Sol',
        SystemAddress: 10477373803,
        StarPos: [0, 0, 0],
        Docked: true,
        StationName: 'Galileo',
        MarketID: 128016640,
      },
      {
        event: 'FSDJump',
        StarSystem: 'Alpha Centauri',
        SystemAddress: 1458376315610,
        StarPos: [3.03, -0.09, 3.16],
      },
    );
    expect(state).toMatchObject({
      commander: 'Jameson',
      frontierId: 'F123',
      gameVersion: '4.4.1.1',
      gameBuild: 'r332841/r0',
      shipId: 7,
      shipType: 'krait_mkii',
      systemName: 'Alpha Centauri',
      coordinates: [3.03, -0.09, 3.16],
    });
    expect(state.stationName).toBeUndefined();
    expect(state.marketId).toBeUndefined();
  });

  it('keeps the commander across a later part of the same game', () => {
    const state = fold(header, loadGame, { ...header, part: 2 });
    expect(state.commander).toBe('Jameson');
  });

  it('keeps the ship when LoadGame names a suit, since the commander is on foot', () => {
    const state = fold(header, loadGame, { ...loadGame, Ship: 'UtilitySuit_Class1', ShipID: 99 });
    expect(state).toMatchObject({ shipId: 7, shipType: 'krait_mkii' });
  });

  it('knows when the commander is in someone else’s crew', () => {
    expect(fold(header, loadGame, { event: 'JoinACrew', Captain: 'Other' }).inCrew).toBe(true);
    expect(
      fold(header, loadGame, { event: 'JoinACrew', Captain: 'Other' }, { event: 'QuitACrew' })
        .inCrew,
    ).toBe(false);
  });
});

describe('liveGalaxyProblem', () => {
  it('takes the live galaxy', () => {
    expect(liveGalaxyProblem(fold(header))).toBeUndefined();
  });

  it('refuses betas and the legacy galaxy', () => {
    expect(liveGalaxyProblem(fold({ ...header, gameversion: '3.8.0.407' }))).toContain('legacy');
    expect(liveGalaxyProblem(fold({ ...header, gameversion: '4.5.0.0 Beta' }))).toContain('beta');
  });
});
