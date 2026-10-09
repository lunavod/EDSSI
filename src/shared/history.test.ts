import { describe, expect, it } from 'vitest';

import { type HistorySnapshot, isNewerSnapshot } from './history';

function snapshot(version: number, ready: boolean): HistorySnapshot {
  return {
    version,
    ready,
    ledger: {
      fines: 0,
      bounties: 0,
      combatBonds: 0,
      cartographics: { value: 0, sessionValue: 0, bodies: 0, systems: 0 },
      exobiology: { value: 0, sessionValue: 0, species: 0 },
    },
    exobiology: { jumps: 0, entries: [] },
    losses: [],
  };
}

describe('isNewerSnapshot', () => {
  it('takes later versions, and the same version once the replay is done', () => {
    expect(isNewerSnapshot(undefined, snapshot(0, false))).toBe(true);
    expect(isNewerSnapshot(snapshot(3, true), snapshot(4, true))).toBe(true);
    expect(isNewerSnapshot(snapshot(3, false), snapshot(3, true))).toBe(true);
  });

  it('keeps what it has over an older or repeated snapshot', () => {
    expect(isNewerSnapshot(snapshot(4, true), snapshot(3, true))).toBe(false);
    expect(isNewerSnapshot(snapshot(3, true), snapshot(3, true))).toBe(false);
    expect(isNewerSnapshot(snapshot(3, true), snapshot(3, false))).toBe(false);
  });
});
