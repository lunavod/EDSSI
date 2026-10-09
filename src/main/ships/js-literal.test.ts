import { describe, expect, it } from 'vitest';

import { parseJsLiteral, readJsAssignment } from './js-literal';

const read = (source: string) => parseJsLiteral(source).value;

describe('parseJsLiteral', () => {
  it('reads objects with unquoted, quoted and numeric keys and trailing commas', () => {
    expect(read(`{ a: 1, 'b': "two", 3 : [true, false, null,], }`)).toEqual({
      a: 1,
      b: 'two',
      3: [true, false, null],
    });
  });

  it('skips line and block comments', () => {
    expect(read(`{ /* size */ a: 1, // the first\n b: 2 }`)).toEqual({ a: 1, b: 2 });
  });

  it('reads numbers, NaN, Infinity and arithmetic on them', () => {
    expect(read('[1.5, -2, .5, 1e3, 0x10, NaN, -Infinity, 1/0, 2*3+1, -(4-6)]')).toEqual([
      1.5,
      -2,
      0.5,
      1000,
      16,
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      7,
      2,
    ]);
  });

  it('reads string escapes', () => {
    expect(read(String.raw`'it\'s \x41B\n'`)).toBe("it's AB\n");
  });

  it('never runs code', () => {
    expect(() => read('{ a: alert(1) }')).toThrow(/not alert/);
    expect(() => read('{ a: x }')).toThrow(/not x/);
    expect(() => read('[1 + y]')).toThrow();
    expect(() => read('{ a: 1 b: 2 }')).toThrow(/',' or '}'/);
  });

  it('keeps __proto__ a plain key', () => {
    const value = read('{ __proto__: { polluted: 1 } }') as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('readJsAssignment', () => {
  it('reads the literal a variable is given, ignoring the rest of the script', () => {
    const source = `/* licence */\n'use strict';\nvar eddb = { version: 2 };\nfunction later() {}`;
    expect(readJsAssignment(source, 'eddb')).toEqual({ version: 2 });
  });

  it('says when there is no such assignment', () => {
    expect(() => readJsAssignment('var other = 1;', 'eddb')).toThrow(/no assignment/);
  });
});
