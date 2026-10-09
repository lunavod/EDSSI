import { describe, expect, it } from 'vitest';

import { carrierJumpFuel, carrierJumpsLeft, nextUpkeepAt, upkeepForecast } from './carriers';

describe('carrierJumpFuel', () => {
  // Nine jumps from a real carrier's journal: distance, space used and fuel before, and the burn
  // CarrierStats showed after.
  const jumps: [ly: number, used: number, fuel: number, burned: number][] = [
    [211.34, 920, 500, 33],
    [481.08, 2827, 1000, 74],
    [380.29, 9183, 926, 72],
    [171.8, 3121, 854, 30],
    [171.8, 12790, 824, 38],
    [131.22, 3023, 786, 24],
    [125.79, 2758, 1000, 23],
    [125.79, 11590, 977, 29],
    [494.39, 2636, 948, 76],
  ];

  it.each(jumps)('burns what the game did for %f ly at %i t used', (ly, used, fuel, burned) => {
    expect(carrierJumpFuel(ly, used, fuel)).toBe(burned);
  });
});

describe('carrierJumpsLeft', () => {
  it('counts full-range jumps until the tank runs short, each lighter than the last', () => {
    expect(carrierJumpsLeft(872, 2777, 500)).toBe(11);
    expect(carrierJumpsLeft(50, 2777, 500)).toBe(0);
  });
});

describe('nextUpkeepAt', () => {
  it('is the next Thursday at 07:00 UTC, a week on when it is that moment', () => {
    expect(new Date(nextUpkeepAt(Date.parse('2026-09-30T20:03:07Z'))).toISOString()).toBe(
      '2026-10-01T07:00:00.000Z',
    );
    expect(new Date(nextUpkeepAt(Date.parse('2026-10-01T07:00:00Z'))).toISOString()).toBe(
      '2026-10-08T07:00:00.000Z',
    );
  });
});

describe('upkeepForecast', () => {
  const at = (time: string) => Date.parse(time);
  const input = {
    balance: 610e6,
    balanceAt: at('2026-09-30T20:00:00Z'),
    weekly: 11.35e6,
    perJump: 100_000,
    jumpTimes: [at('2026-09-26T22:06:10Z'), at('2026-09-29T22:24:10Z')],
  };

  it('adds the week’s jumps to the next charge, then counts whole weeks the balance pays', () => {
    const forecast = upkeepForecast({ ...input, now: at('2026-09-30T21:00:00Z') });
    expect(forecast).toMatchObject({ balance: 610e6, estimated: false, nextCharge: 11.55e6 });
    // 610M pays the first 11.55M and then 52 more weeks of 11.35M.
    expect(forecast.weeksCovered).toBe(53);
    expect(new Date(forecast.debtAt).toISOString()).toBe('2027-10-07T07:00:00.000Z');
  });

  it('takes the charges made since the balance was read off it', () => {
    const forecast = upkeepForecast({
      ...input,
      jumpTimes: [...input.jumpTimes, at('2026-10-02T12:00:00Z')],
      now: at('2026-10-09T12:00:00Z'),
    });
    expect(forecast.estimated).toBe(true);
    expect(forecast.balance).toBe(610e6 - 11.55e6 - 11.45e6);
    expect(new Date(forecast.nextChargeAt).toISOString()).toBe('2026-10-15T07:00:00.000Z');
    expect(forecast.nextCharge).toBe(11.35e6);
  });

  it('has no weeks when the next charge is more than the balance', () => {
    const forecast = upkeepForecast({ ...input, balance: 1e6, now: at('2026-09-30T21:00:00Z') });
    expect(forecast.weeksCovered).toBe(0);
    expect(forecast.debtAt).toBe(forecast.nextChargeAt);
  });
});
