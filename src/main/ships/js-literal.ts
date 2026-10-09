/**
 * Reads a JavaScript literal (objects, arrays, strings, numbers, `true`/`false`/`null`/`undefined`,
 * `NaN`, `Infinity`) out of a script, with comments, unquoted and numeric keys and trailing commas.
 * Anything else — a call, a reference, an operator — is an error, so a file fetched from the web
 * is read as data and never run.
 */
export function parseJsLiteral(source: string, start = 0): { value: unknown; end: number } {
  const parser = new Parser(source, start);
  const value = parser.value();
  return { value, end: parser.at };
}

/**
 * The literal assigned by `var <name> = …` (or `let`/`const`) in `source`. Throws if there is no
 * such assignment or it isn't a plain literal.
 */
export function readJsAssignment(source: string, name: string): unknown {
  const match = new RegExp(String.raw`(?:^|[\s;])(?:var|let|const)\s+${name}\s*=`).exec(source);
  if (!match) throw new Error(`no assignment to ${name}`);
  return parseJsLiteral(source, match.index + match[0].length).value;
}

const WORDS: Readonly<Record<string, unknown>> = {
  true: true,
  false: false,
  null: null,
  undefined,
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
};

const IDENTIFIER = /[A-Za-z_$][\w$]*/y;
const NUMBER = /0[xX][\da-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

class Parser {
  readonly #source: string;
  at: number;

  constructor(source: string, at: number) {
    this.#source = source;
    this.at = at;
  }

  value(): unknown {
    this.#skip();
    const char = this.#source[this.at];
    if (char === '{') return this.#object();
    if (char === '[') return this.#array();
    if (char === "'" || char === '"') return this.#string();
    if (char !== undefined && /[\d.+\-(]/.test(char)) return this.#sum();
    const start = this.at;
    const word = this.#identifier();
    if (word === 'NaN' || word === 'Infinity') {
      this.at = start;
      return this.#sum();
    }
    if (word !== undefined && Object.hasOwn(WORDS, word)) return WORDS[word];
    throw this.#error(word === undefined ? 'a value' : `a value, not ${word}`);
  }

  #sum(): number {
    let result = this.#product();
    for (;;) {
      this.#skip();
      if (this.#eat('+')) result += this.#product();
      else if (this.#eat('-')) result -= this.#product();
      else return result;
    }
  }

  #product(): number {
    let result = this.#unary();
    for (;;) {
      this.#skip();
      if (this.#eat('*')) result *= this.#unary();
      else if (this.#eat('/')) result /= this.#unary();
      else return result;
    }
  }

  #unary(): number {
    this.#skip();
    if (this.#eat('-')) return -this.#unary();
    if (this.#eat('+')) return this.#unary();
    if (this.#eat('(')) {
      const result = this.#sum();
      this.#skip();
      if (!this.#eat(')')) throw this.#error("')'");
      return result;
    }
    const start = this.at;
    const word = this.#identifier();
    if (word === 'NaN') return Number.NaN;
    if (word === 'Infinity') return Number.POSITIVE_INFINITY;
    this.at = start;
    return this.#number();
  }

  #object(): Record<string, unknown> {
    this.at++;
    // A null prototype, so a key like __proto__ is only ever a key.
    const result: Record<string, unknown> = Object.create(null);
    for (;;) {
      this.#skip();
      if (this.#eat('}')) return result;
      const key = this.#key();
      this.#skip();
      if (!this.#eat(':')) throw this.#error("':'");
      result[key] = this.value();
      this.#skip();
      if (this.#eat('}')) return result;
      if (!this.#eat(',')) throw this.#error("',' or '}'");
    }
  }

  #array(): unknown[] {
    this.at++;
    const result: unknown[] = [];
    for (;;) {
      this.#skip();
      if (this.#eat(']')) return result;
      result.push(this.value());
      this.#skip();
      if (this.#eat(']')) return result;
      if (!this.#eat(',')) throw this.#error("',' or ']'");
    }
  }

  #key(): string {
    const char = this.#source[this.at];
    if (char === "'" || char === '"') return this.#string();
    if (char !== undefined && /[\d.]/.test(char)) return String(this.#number());
    const word = this.#identifier();
    if (word === undefined) throw this.#error('a key');
    return word;
  }

  #string(): string {
    const quote = this.#source[this.at];
    let result = '';
    for (this.at++; ;) {
      const char = this.#source[this.at++];
      if (char === undefined || char === '\n') throw this.#error('the end of the string');
      if (char === quote) return result;
      if (char !== '\\') {
        result += char;
        continue;
      }
      const escaped = this.#source[this.at++];
      switch (escaped) {
        case 'n':
          result += '\n';
          break;
        case 't':
          result += '\t';
          break;
        case 'r':
          result += '\r';
          break;
        case 'b':
          result += '\b';
          break;
        case 'f':
          result += '\f';
          break;
        case 'v':
          result += '\v';
          break;
        case '0':
          result += '\0';
          break;
        case 'x':
          result += this.#hex(2);
          break;
        case 'u':
          result += this.#hex(4);
          break;
        case '\r':
          if (this.#source[this.at] === '\n') this.at++;
          break;
        case '\n':
          break;
        case undefined:
          throw this.#error('the end of the string');
        default:
          result += escaped;
      }
    }
  }

  #hex(digits: number): string {
    const text = this.#source.slice(this.at, this.at + digits);
    if (!new RegExp(`^[\\da-fA-F]{${digits}}$`).test(text)) throw this.#error('a hex escape');
    this.at += digits;
    return String.fromCharCode(Number.parseInt(text, 16));
  }

  #number(): number {
    NUMBER.lastIndex = this.at;
    const match = NUMBER.exec(this.#source);
    if (!match) throw this.#error('a number');
    this.at += match[0].length;
    return /^0[xX]/.test(match[0]) ? Number.parseInt(match[0], 16) : Number(match[0]);
  }

  #identifier(): string | undefined {
    IDENTIFIER.lastIndex = this.at;
    const match = IDENTIFIER.exec(this.#source);
    if (!match) return undefined;
    this.at += match[0].length;
    return match[0];
  }

  #eat(char: string): boolean {
    if (this.#source[this.at] !== char) return false;
    this.at++;
    return true;
  }

  /** Whitespace and comments. */
  #skip(): void {
    const source = this.#source;
    for (;;) {
      const char = source[this.at];
      if (char === undefined) return;
      if (/\s/.test(char) || char === '﻿') {
        this.at++;
      } else if (source.startsWith('//', this.at)) {
        const end = source.indexOf('\n', this.at);
        this.at = end === -1 ? source.length : end + 1;
      } else if (source.startsWith('/*', this.at)) {
        const end = source.indexOf('*/', this.at + 2);
        if (end === -1) throw this.#error('the end of the comment');
        this.at = end + 2;
      } else {
        return;
      }
    }
  }

  #error(expected: string): Error {
    const line = this.#source.slice(0, this.at).split('\n').length;
    return new Error(`expected ${expected} at line ${line}`);
  }
}
