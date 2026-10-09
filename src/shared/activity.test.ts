import { describe, expect, it } from 'vitest';

import { type ActivityRecord, type PlaySpan, tally } from './activity';

const MINUTE = 60_000;

const records: ActivityRecord[] = [
  { kind: 'jump', at: 1 * MINUTE, system: 'A', distanceLy: 40, fromSolLy: 100, firstVisit: true },
  {
    kind: 'scan',
    at: 2 * MINUTE,
    body: 'A 1',
    bodyType: 'Water world',
    star: false,
    value: 400_000,
    firstDiscovery: true,
    terraformable: false,
    landable: false,
  },
  { kind: 'map', at: 3 * MINUTE, body: 'A 1', addedValue: 1_200_000, efficient: true },
  {
    kind: 'organic',
    at: 4 * MINUTE,
    body: 'A 2',
    species: 'Stratum Tectonicas',
    genus: 'Stratum',
    value: 19_000_000,
    newSpecies: false,
  },
  { kind: 'bounty', at: 5 * MINUTE, reward: 50_000 },
  { kind: 'bond', at: 6 * MINUTE, reward: 25_000 },
  { kind: 'earn', at: 7 * MINUTE, source: 'trade', amount: 900_000, profit: 300_000 },
  { kind: 'earn', at: 8 * MINUTE, source: 'missions', amount: 150_000 },
  // Cashing in what was already counted, and a ship sale, make nothing new.
  { kind: 'earn', at: 9 * MINUTE, source: 'exploration', amount: 1_600_000 },
  { kind: 'earn', at: 10 * MINUTE, source: 'bounties', amount: 50_000 },
  { kind: 'earn', at: 11 * MINUTE, source: 'ship_and_module_sales', amount: 5_000_000 },
  { kind: 'jump', at: 12 * MINUTE, system: 'B', distanceLy: 60, fromSolLy: 150, firstVisit: true },
];

const spans: PlaySpan[] = [{ from: 0, to: 30 * MINUTE }];

describe('tally', () => {
  it('counts data and vouchers when found, not again when cashed in', () => {
    const made = tally(records, spans, { from: 0, to: 60 * MINUTE });
    expect(made.bySource).toEqual({
      exobiology: 19_000_000,
      cartographics: 1_600_000,
      bounties: 75_000,
      trade: 300_000,
      missions: 150_000,
      other: 0,
    });
    expect(made.earned).toBe(21_125_000);
    expect(made).toMatchObject({ jumps: 2, distanceLy: 100, minutesPlayed: 30 });
    expect(made.perHour).toBe(42_250_000);
  });

  it('takes off what went down with the ship before it was cashed in', () => {
    const died: ActivityRecord[] = [
      ...records.slice(0, 9),
      { kind: 'death', at: 9.5 * MINUTE },
      ...records.slice(9),
    ];
    const made = tally(died, spans, { from: 0, to: 60 * MINUTE });
    // The cartographics were sold first; the samples and the bounties were not.
    expect(made.bySource).toMatchObject({ exobiology: 0, cartographics: 1_600_000, bounties: 0 });
    expect(made.lost).toBe(19_075_000);
    expect(made.earned).toBe(2_050_000);
  });

  it('keeps to the range', () => {
    const made = tally(records, spans, { from: 4 * MINUTE, to: 12 * MINUTE });
    expect(made.jumps).toBe(0);
    expect(made.bySource.cartographics).toBe(0);
    expect(made.bySource.exobiology).toBe(19_000_000);
    expect(made.minutesPlayed).toBe(8);
  });

  it('gives no rate until the commander has played a while', () => {
    const made = tally(records, spans, { from: 0, to: 4 * MINUTE });
    expect(made.minutesPlayed).toBe(4);
    expect(made.perHour).toBeUndefined();
  });
});
