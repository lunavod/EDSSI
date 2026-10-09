import { describe, expect, it } from 'vitest';

import { encodeWav, pcmFromWav } from './wav';

describe('wav', () => {
  it('round-trips samples through a 16-bit mono file', () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -1, 2]), 16_000);
    expect(wav).toHaveLength(44 + 8);
    const pcm = pcmFromWav(wav, 16_000);
    expect(Array.from(new Int16Array(pcm.slice().buffer))).toEqual([0, 16384, -32767, 32767]);
  });

  it('refuses another rate, or something that isn’t a WAV at all', () => {
    expect(() => pcmFromWav(encodeWav(new Float32Array(4), 48_000), 16_000)).toThrow(/16 kHz/);
    expect(() => pcmFromWav(new Uint8Array(20), 16_000)).toThrow(/WAV/);
  });

  it('skips chunks it doesn’t know on the way to the audio', () => {
    const plain = encodeWav(new Float32Array([0.25]), 16_000);
    const list = new Uint8Array([...new TextEncoder().encode('LIST'), 3, 0, 0, 0, 1, 2, 3, 0]);
    const withList = new Uint8Array([...plain.subarray(0, 36), ...list, ...plain.subarray(36)]);
    expect(pcmFromWav(withList, 16_000)).toHaveLength(2);
  });
});
