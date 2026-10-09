import { describe, expect, it } from 'vitest';

import { forSpeech } from './pronounce';

describe('forSpeech', () => {
  it('spells out a moon letter, which was read as "two hours"', () => {
    expect(forSpeech('2 h: 6 bio, 58 to 98 million.')).toBe('2 aitch: 6 bio, 58 to 98 million.');
  });

  it('spells every letter of a moon of a moon, in a full body name', () => {
    expect(forSpeech('Head for Colonia 3 a b next.')).toBe('Head for Colonia 3 ay bee next.');
  });

  it('leaves numbers, decimals and words alone', () => {
    const text = 'About 2.4 million, 12 jumps and 1 an hour, 2 at most.';
    expect(forSpeech(text)).toBe(text);
  });

  it('leaves star letters and plain planets alone', () => {
    expect(forSpeech('AB 1 is close to A 3.')).toBe('AB 1 is close to A 3.');
  });
});
