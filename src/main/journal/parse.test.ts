import { describe, expect, it } from 'vitest';

import { parseJournalJson } from './parse';

describe('parseJournalJson', () => {
  it('keeps safe integers and floats as numbers', () => {
    expect(parseJournalJson('{"a":9007199254740991,"b":1.5,"c":-3}')).toEqual({
      a: 9007199254740991,
      b: 1.5,
      c: -3,
    });
  });

  it('turns unsafe integers into exact bigints, including nested ones', () => {
    expect(parseJournalJson('{"MissionID":18446744073709551615,"n":[-9007199254740993]}')).toEqual({
      MissionID: 18446744073709551615n,
      n: [-9007199254740993n],
    });
  });

  it('leaves huge non-integer literals as numbers', () => {
    expect(parseJournalJson('{"x":1e300}')).toEqual({ x: 1e300 });
  });
});
