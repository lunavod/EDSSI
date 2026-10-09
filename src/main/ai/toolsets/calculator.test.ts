import { describe, expect, it } from 'vitest';

import { calculatorToolset, evaluate } from './calculator';

describe('evaluate', () => {
  it('does the sum the model asked a web search for', () => {
    expect(evaluate('(8426250000-3996000000)*0.20')).toBe(886050000);
  });

  it('follows the usual precedence', () => {
    expect(evaluate('2 + 3 * 4')).toBe(14);
    expect(evaluate('-2^2')).toBe(-4);
    expect(evaluate('2^3^2')).toBe(512);
    expect(evaluate('2 ** 10')).toBe(1024);
    expect(evaluate('10 % 4 + 7 / 2')).toBe(5.5);
    expect(evaluate('--3')).toBe(3);
  });

  it('reads separators, exponents and written operators', () => {
    expect(evaluate('8_426_250_000')).toBe(8426250000);
    expect(evaluate('1.5e9 / 1e3')).toBe(1500000);
    expect(evaluate('.5 × 6 ÷ 3 − 1')).toBe(0);
  });

  it('rounds away binary noise', () => {
    expect(evaluate('0.1 + 0.2')).toBe(0.3);
  });

  it('knows its functions and constants', () => {
    expect(evaluate('round(pi, 2)')).toBe(3.14);
    expect(evaluate('max(1, 5, 3) + min(4, 2)')).toBe(7);
    expect(evaluate('avg(2, 4, 9)')).toBe(5);
    expect(evaluate('hypot(3, 4)')).toBe(5);
    expect(evaluate('log(1000) + ln(e)')).toBe(4);
    expect(evaluate('deg(atan2(1, 1))')).toBe(45);
    expect(evaluate('SQRT(16)')).toBe(4);
  });

  it('says what is wrong with an expression', () => {
    expect(() => evaluate('1 / 0')).toThrow(/Division by zero/);
    expect(() => evaluate('(1 + 2')).toThrow(/Expected "\)"/);
    expect(() => evaluate('1 +')).toThrow(/found the end/);
    expect(() => evaluate('2 3')).toThrow(/Unexpected "3"/);
    expect(() => evaluate('foo(1)')).toThrow(/Unknown function "foo"/);
    expect(() => evaluate('x + 1')).toThrow(/Unknown name "x"/);
    expect(() => evaluate('pow(2)')).toThrow(/pow takes 2 argument/);
    expect(() => evaluate('1 $ 2')).toThrow(/Unexpected "\$" at position 3/);
    expect(() => evaluate('sqrt(-1)')).toThrow(/not a finite number/);
    expect(() => evaluate('  ')).toThrow(/empty/);
  });
});

describe('calculate', () => {
  it('answers each expression, errors included, in one call', () => {
    const tool = calculatorToolset.tools[0]!;
    expect(tool.run({ expressions: ['6 * 7', '1 / 0'] }, {} as never)).toEqual([
      { expression: '6 * 7', result: 42 },
      { expression: '1 / 0', error: 'Division by zero.' },
    ]);
  });
});
