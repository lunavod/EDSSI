import { describe, expect, it } from 'vitest';

import { decodePcm, leadAfterGap, leadForNextReply, quietCut } from './speech';

/** 16-bit little-endian, the format the speech endpoint streams. */
function pcm(...samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  new DataView(bytes.buffer).setInt16(0, samples[0] ?? 0, true);
  for (const [index, sample] of samples.entries()) {
    new DataView(bytes.buffer).setInt16(index * 2, sample, true);
  }
  return bytes;
}

describe('decodePcm', () => {
  it('turns samples into the floats WebAudio plays', () => {
    const { samples, carry } = decodePcm(pcm(0, 16384, -16384));
    expect([...samples]).toEqual([0, 0.5, -0.5]);
    expect(carry).toBeUndefined();
  });

  it('holds back a byte that belongs to the next chunk', () => {
    const bytes = pcm(0, 16384);
    const first = decodePcm(bytes.slice(0, 3));
    expect([...first.samples]).toEqual([0]);
    expect(first.carry).toBe(bytes[2]);

    const second = decodePcm(bytes.slice(3), first.carry);
    expect([...second.samples]).toEqual([0.5]);
    expect(second.carry).toBeUndefined();
  });

  it('copes with a chunk of a single byte', () => {
    const bytes = pcm(-32768);
    const first = decodePcm(bytes.slice(0, 1));
    expect(first.samples).toHaveLength(0);
    expect(first.carry).toBe(bytes[0]);

    const second = decodePcm(bytes.slice(1), first.carry);
    expect([...second.samples]).toEqual([-1]);
  });
});

const RATE = 1000;

/** A loud tone with a quiet stretch from `from` to `to`, in samples. */
function speech(length: number, quiet: [number, number][] = []): Float32Array {
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const silent = quiet.some(([from, to]) => index >= from && index < to);
    samples[index] = silent ? 0.001 : index % 2 === 0 ? 0.5 : -0.5;
  }
  return samples;
}

describe('quietCut', () => {
  it('stops in the last pause between words', () => {
    const cut = quietCut(
      speech(400, [
        [100, 130],
        [250, 280],
      ]),
      RATE,
    );
    expect(cut).toBeGreaterThanOrEqual(250);
    expect(cut).toBeLessThan(280);
  });

  it('has nowhere to stop in the middle of a word', () => {
    expect(quietCut(speech(400), RATE)).toBeUndefined();
  });

  it('treats trailing silence as a place to stop', () => {
    expect(quietCut(speech(400, [[370, 400]]), RATE)).toBeGreaterThanOrEqual(370);
  });
});

describe('the jitter buffer', () => {
  it('starts at something bigger than the gaps a stream actually shows', () => {
    // Measured in use: pieces arriving 40-139 ms late against a 120 ms lead, over and over.
    expect(leadForNextReply(0)).toBeGreaterThan(0.139);
  });

  it('widens by what was missed, so it settles where the connection needs it', () => {
    expect(leadAfterGap(0.35, 0.139)).toBeCloseTo(0.489, 3);
  });

  it('will not hold back more than a reply is worth waiting for', () => {
    let lead = 0.35;
    for (let gap = 0; gap < 40; gap++) lead = leadAfterGap(lead, 0.2);
    expect(lead).toBeLessThanOrEqual(1.2);
  });

  it('gives back what one bad reply took, but never drops below the floor', () => {
    const widened = leadAfterGap(0.35, 0.5);
    expect(leadForNextReply(widened)).toBeLessThan(widened);
    expect(leadForNextReply(0.35)).toBeCloseTo(0.35, 5);
  });
});
