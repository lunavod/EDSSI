import { describe, expect, it } from 'vitest';

import { readVocab, styleFor, tokenize, toPcm16 } from './kokoro';
import { normalizeText, splitOnPunctuation } from './text';

const vocab = new Map([
  ['a', 43],
  ['b', 44],
  [',', 3],
]);

describe('tokenize', () => {
  it('maps each known character, drops the rest, and wraps the lot in $', () => {
    expect(tokenize('a?b, a', vocab)).toEqual([0, 43, 44, 3, 43, 0]);
  });

  it('stops at the model’s 512 tokens, keeping the closing $', () => {
    const ids = tokenize('a'.repeat(600), vocab);
    expect(ids).toHaveLength(512);
    expect(ids.at(-1)).toBe(0);
  });
});

describe('styleFor', () => {
  it('takes the 256-wide vector for that many tokens, less the two $', () => {
    const voice = Float32Array.from({ length: 256 * 510 }, (_, index) => Math.floor(index / 256));
    expect(styleFor(voice, 2)[0]).toBe(0);
    expect(styleFor(voice, 12)[0]).toBe(10);
    expect(styleFor(voice, 5000)[0]).toBe(509);
    expect(styleFor(voice, 12)).toHaveLength(256);
  });
});

describe('toPcm16', () => {
  it('writes little-endian 16-bit samples, clipping past full scale', () => {
    const pcm = toPcm16(new Float32Array([0, 1, -1, 2]));
    const view = new DataView(pcm.buffer);
    expect([0, 2, 4, 6].map((at) => view.getInt16(at, true))).toEqual([0, 32767, -32767, 32767]);
  });
});

describe('readVocab', () => {
  it('reads a tokenizer.json’s table, and refuses one without', () => {
    expect(readVocab({ model: { vocab: { a: 1, b: 'x' } } })).toEqual(new Map([['a', 1]]));
    expect(() => readVocab({})).toThrow(/vocab/);
  });
});

describe('normalizeText', () => {
  it('writes out years, times, money and decimals as kokoro-js does', () => {
    expect(normalizeText('In 1990 at 2:05 it cost $3.50, or 1.5 more.')).toBe(
      'In 19 90 at 2 oh 5 it cost 3 dollars and 50 cents, or 1 point 5 more.',
    );
    expect(normalizeText('4,500,000 credits')).toBe('4500000 credits');
  });
});

describe('splitOnPunctuation', () => {
  it('keeps the punctuation, with its spaces, between what eSpeak reads', () => {
    expect(splitOnPunctuation('Jump, then scoop.')).toEqual([
      { punctuation: false, text: 'Jump' },
      { punctuation: true, text: ', ' },
      { punctuation: false, text: 'then scoop' },
      { punctuation: true, text: '.' },
    ]);
  });
});
