import { describe, expect, it } from 'vitest';

import { Resampler } from './resample';

/** A sine wave, the thing whose joins are audible when they go wrong. */
function tone(count: number, rate: number, hz = 400, from = 0): Float32Array {
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    samples[index] = Math.sin((2 * Math.PI * hz * (from + index)) / rate);
  }
  return samples;
}

/** The largest step between neighbouring samples: a click is a step far bigger than the rest. */
function biggestStep(samples: readonly number[]): number {
  let worst = 0;
  for (let index = 1; index < samples.length; index++) {
    worst = Math.max(worst, Math.abs(samples[index]! - samples[index - 1]!));
  }
  return worst;
}

describe('Resampler', () => {
  it('passes audio through untouched when the rates already match', () => {
    const input = tone(64, 24_000);
    const output = new Resampler().resample(input, 24_000, 24_000);
    expect([...output]).toEqual([...input]);
  });

  it('gives about twice as many samples going from 24k to 48k', () => {
    const output = new Resampler().resample(tone(1200, 24_000), 24_000, 48_000);
    expect(output.length).toBeGreaterThan(2390);
    expect(output.length).toBeLessThanOrEqual(2400);
  });

  it('joins one piece to the next without a step', () => {
    // The bug this exists for: a reply arrives as dozens of pieces a second, and resampling each
    // one on its own leaves a discontinuity at every join — heard as a crackle over the whole
    // answer.
    const rate = 24_000;
    const resampler = new Resampler();
    const joined: number[] = [];
    for (let piece = 0; piece < 12; piece++) {
      const input = tone(100, rate, 400, piece * 100);
      joined.push(...resampler.resample(input, rate, 48_000));
    }

    const whole = [...new Resampler().resample(tone(1200, rate), rate, 48_000)];
    // A 400 Hz tone at 48 kHz moves this much between samples at the steepest point.
    expect(biggestStep(joined)).toBeLessThan(0.06);
    expect(biggestStep(joined)).toBeCloseTo(biggestStep(whole), 3);
  });

  it('resamples the same however the pieces happen to be cut up', () => {
    const rate = 24_000;
    const whole = [...new Resampler().resample(tone(600, rate), rate, 44_100)];

    const resampler = new Resampler();
    const pieces: number[] = [];
    // Uneven pieces, the way they arrive off a network.
    let at = 0;
    for (const size of [7, 1, 93, 200, 3, 45, 251]) {
      pieces.push(...resampler.resample(tone(size, rate, 400, at), rate, 44_100));
      at += size;
    }

    expect(pieces.length).toBeCloseTo(whole.length, -1);
    for (let index = 0; index < Math.min(pieces.length, whole.length); index++) {
      expect(pieces[index]!).toBeCloseTo(whole[index]!, 2);
    }
  });

  it('starts a new sound after a reset rather than joining it to the last one', () => {
    const resampler = new Resampler();
    resampler.resample(Float32Array.from([1, 1, 1, 1]), 24_000, 48_000);
    resampler.reset();
    const output = resampler.resample(Float32Array.from([0, 0, 0, 0]), 24_000, 48_000);
    expect(Math.max(...output)).toBe(0);
  });

  it('copes with a piece too short to produce anything yet', () => {
    const resampler = new Resampler();
    expect(resampler.resample(Float32Array.from([0.5]), 24_000, 48_000).length).toBeLessThan(3);
    // Whatever it held back is still used once more audio turns up.
    expect(resampler.resample(tone(48, 24_000), 24_000, 48_000).length).toBeGreaterThan(90);
  });
});
