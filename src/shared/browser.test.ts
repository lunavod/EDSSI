import { describe, expect, it } from 'vitest';

import { typedAddress } from './browser';

describe('typedAddress', () => {
  it.each([
    ['https://inara.cz/elite/', 'https://inara.cz/elite/'],
    ['spansh.co.uk/plotter', 'https://spansh.co.uk/plotter'],
    [
      'where to buy guardian fsd booster',
      'https://duckduckgo.com/?q=where%20to%20buy%20guardian%20fsd%20booster',
    ],
    ['colonia', 'https://duckduckgo.com/?q=colonia'],
  ])('%s → %s', (typed, expected) => {
    expect(typedAddress(typed)).toBe(expected);
  });
});
