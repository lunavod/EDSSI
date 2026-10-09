/**
 * Arithmetic, so the model neither does sums in its head nor asks a web search to do them. A small
 * parser of its own rather than `eval` or a library: numbers, + - * / % ^, brackets, a handful of
 * functions and constants, and nothing that can reach anything else.
 */

import { z } from 'zod';

import { defineTool, type Toolset } from '../tools/define';

const MAX_EXPRESSIONS = 20;
const MAX_LENGTH = 500;
/** Rounds away binary noise such as 0.1 + 0.2 = 0.30000000000000004. */
const SIGNIFICANT_DIGITS = 15;

export const calculatorToolset: Toolset = {
  name: 'arithmetic',
  instructions: `Never work out a sum in your head, and never use web search as a calculator: use calculate for any arithmetic beyond the trivial — totals, differences, shares, percentages, rates per hour, unit conversions. Put every sum of one answer in the same call.`,

  tools: [
    defineTool({
      name: 'calculate',
      description:
        'Evaluates arithmetic expressions exactly. Numbers (1e9, 8_426_250_000), + - * / % ^, ' +
        'brackets, the constants pi and e, and the functions abs, sqrt, cbrt, round(x, digits), ' +
        'floor, ceil, trunc, min, max, sum, avg, pow, exp, ln, log (base 10), log2, hypot, sin, ' +
        'cos, tan, asin, acos, atan, atan2 (radians), deg and rad. Several expressions at once.',
      parameters: z.object({
        expressions: z
          .array(z.string().min(1).max(MAX_LENGTH))
          .min(1)
          .max(MAX_EXPRESSIONS)
          .describe('Each expression to evaluate, e.g. "(8426250000 - 3996000000) * 0.2".'),
      }),
      run({ expressions }) {
        return expressions.map((expression) => {
          try {
            return { expression, result: evaluate(expression) };
          } catch (error) {
            if (error instanceof CalcError) return { expression, error: error.message };
            throw error;
          }
        });
      },
    }),
  ],
};

export class CalcError extends Error {}

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

const FUNCTIONS: Record<string, { arity: [number, number]; fn: (...args: number[]) => number }> = {
  abs: { arity: [1, 1], fn: Math.abs },
  sqrt: { arity: [1, 1], fn: Math.sqrt },
  cbrt: { arity: [1, 1], fn: Math.cbrt },
  round: {
    arity: [1, 2],
    fn: (x, digits = 0) => {
      const scale = 10 ** digits;
      return Math.round(x * scale) / scale;
    },
  },
  floor: { arity: [1, 1], fn: Math.floor },
  ceil: { arity: [1, 1], fn: Math.ceil },
  trunc: { arity: [1, 1], fn: Math.trunc },
  min: { arity: [1, Infinity], fn: Math.min },
  max: { arity: [1, Infinity], fn: Math.max },
  sum: { arity: [1, Infinity], fn: (...xs) => xs.reduce((a, b) => a + b, 0) },
  avg: { arity: [1, Infinity], fn: (...xs) => xs.reduce((a, b) => a + b, 0) / xs.length },
  pow: { arity: [2, 2], fn: Math.pow },
  exp: { arity: [1, 1], fn: Math.exp },
  ln: { arity: [1, 1], fn: Math.log },
  log: { arity: [1, 1], fn: Math.log10 },
  log2: { arity: [1, 1], fn: Math.log2 },
  hypot: { arity: [1, Infinity], fn: Math.hypot },
  sin: { arity: [1, 1], fn: Math.sin },
  cos: { arity: [1, 1], fn: Math.cos },
  tan: { arity: [1, 1], fn: Math.tan },
  asin: { arity: [1, 1], fn: Math.asin },
  acos: { arity: [1, 1], fn: Math.acos },
  atan: { arity: [1, 1], fn: Math.atan },
  atan2: { arity: [2, 2], fn: Math.atan2 },
  deg: { arity: [1, 1], fn: (x) => (x * 180) / Math.PI },
  rad: { arity: [1, 1], fn: (x) => (x * Math.PI) / 180 },
};

type Token =
  | { kind: 'number'; value: number; at: number }
  | { kind: 'name'; value: string; at: number }
  | { kind: 'op'; value: string; at: number };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /\s+|(\d[\d_]*(?:\.[\d_]*)?(?:e[+-]?\d+)?|\.\d[\d_]*(?:e[+-]?\d+)?)|([a-z_]\w*)|(\*\*|[-+*/%^(),×÷−])/giy;
  while (pattern.lastIndex < source.length) {
    const at = pattern.lastIndex;
    const match = pattern.exec(source);
    if (!match) throw new CalcError(`Unexpected "${source[at]}" at position ${at + 1}.`);
    const [, number, name, op] = match;
    if (number !== undefined) {
      tokens.push({ kind: 'number', value: Number(number.replaceAll('_', '')), at });
    } else if (name !== undefined) {
      tokens.push({ kind: 'name', value: name.toLowerCase(), at });
    } else if (op !== undefined) {
      const value = op === '**' ? '^' : op === '×' ? '*' : op === '÷' ? '/' : op === '−' ? '-' : op;
      tokens.push({ kind: 'op', value, at });
    }
  }
  return tokens;
}

/** Evaluates one expression. Throws a `CalcError` saying what is wrong with it. */
export function evaluate(source: string): number {
  const tokens = tokenize(source);
  let index = 0;

  const peek = (): Token | undefined => tokens[index];
  const isOp = (value: string): boolean => {
    const token = peek();
    return token?.kind === 'op' && token.value === value;
  };
  const describe = (token: Token | undefined): string =>
    token ? `"${String(token.value)}" at position ${token.at + 1}` : 'the end';
  const expect = (value: string): void => {
    if (!isOp(value)) throw new CalcError(`Expected "${value}" but found ${describe(peek())}.`);
    index++;
  };

  // sum := product (('+' | '-') product)*
  function sum(): number {
    let value = product();
    while (isOp('+') || isOp('-')) {
      const op = tokens[index++]!.value;
      const right = product();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  // product := unary (('*' | '/' | '%') unary)*
  function product(): number {
    let value = unary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = tokens[index++]!.value;
      const right = unary();
      if (op === '*') value *= right;
      else if (right === 0) throw new CalcError('Division by zero.');
      else value = op === '/' ? value / right : value % right;
    }
    return value;
  }

  // unary := ('+' | '-') unary | power   — so -2^2 is -4, as on paper
  function unary(): number {
    if (isOp('-')) {
      index++;
      return -unary();
    }
    if (isOp('+')) {
      index++;
      return unary();
    }
    return power();
  }

  // power := atom ('^' unary)?   — right-associative: 2^3^2 is 2^9
  function power(): number {
    const base = atom();
    if (!isOp('^')) return base;
    index++;
    return base ** unary();
  }

  function atom(): number {
    const token = peek();
    if (token?.kind === 'number') {
      index++;
      return token.value;
    }
    if (token?.kind === 'op' && token.value === '(') {
      index++;
      const value = sum();
      expect(')');
      return value;
    }
    if (token?.kind === 'name') {
      index++;
      if (isOp('(')) return call(token.value);
      const constant = CONSTANTS[token.value];
      if (constant === undefined) throw new CalcError(`Unknown name "${token.value}".`);
      return constant;
    }
    throw new CalcError(`Expected a number but found ${describe(token)}.`);
  }

  function call(name: string): number {
    const fn = FUNCTIONS[name];
    if (!fn) throw new CalcError(`Unknown function "${name}".`);
    expect('(');
    const args: number[] = [];
    if (!isOp(')')) {
      args.push(sum());
      while (isOp(',')) {
        index++;
        args.push(sum());
      }
    }
    expect(')');
    const [least, most] = fn.arity;
    if (args.length < least || args.length > most) {
      const wanted =
        least === most
          ? `${least}`
          : most === Infinity
            ? `at least ${least}`
            : `${least} to ${most}`;
      throw new CalcError(`${name} takes ${wanted} argument(s), not ${args.length}.`);
    }
    return fn.fn(...args);
  }

  if (tokens.length === 0) throw new CalcError('The expression is empty.');
  const value = sum();
  if (index < tokens.length) throw new CalcError(`Unexpected ${describe(peek())}.`);
  if (!Number.isFinite(value)) throw new CalcError('The result is not a finite number.');
  return Number(value.toPrecision(SIGNIFICANT_DIGITS));
}
