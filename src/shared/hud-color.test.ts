import { describe, expect, it } from 'vitest';

import { accentFor, goodFor, warningFor } from './hud-color';

describe('accentFor', () => {
  it('leaves a colour of readable lightness alone', () => {
    expect(accentFor('#40ae9a')).toBe('#40ae9a');
    expect(accentFor('#ff7100')).toBe('#ff7100');
    expect(accentFor('#ff7f00')).toBe('#ff7f00');
  });

  it('keeps RAPTOR’s panel lines, just under the ceiling', () => {
    expect(accentFor('#83ffe3')).toBe('#83ffe3');
  });

  it('darkens a paler theme colour, keeping its hue', () => {
    expect(accentFor('#c0fff0')).toBe('#85ffe2');
  });

  it('lightens a dark one', () => {
    expect(accentFor('#102080')).toBe('#1933cc');
  });

  it('passes through what isn’t a colour', () => {
    expect(accentFor('teal')).toBe('teal');
  });
});

describe('warningFor', () => {
  it('is amber beside a teal, blue, grey or orange accent', () => {
    expect(warningFor('#83ffe3')).toBe('#ffc400');
    expect(warningFor('#3060ff')).toBe('#ffc400');
    expect(warningFor('#808080')).toBe('#ffc400');
    expect(warningFor('#ff7100')).toBe('#ffc400');
  });

  it('turns red-orange beside a yellow accent', () => {
    expect(warningFor('#ffd000')).toBe('#ff4f1f');
  });
});

describe('goodFor', () => {
  it('is green beside a teal accent and teal beside Elite’s orange', () => {
    expect(goodFor('#83ffe3')).toBe('#5ee87a');
    expect(goodFor('#ff7100')).toBe('#7ce3c4');
  });
});
