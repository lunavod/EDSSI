import { open } from 'node:fs/promises';

/**
 * Incrementally reads lines appended to a file that another process is still writing. Only text
 * up to the last newline is returned; an unfinished trailing line is held back until it completes.
 */
export class LineReader {
  readonly path: string;
  #offset: number;
  #pending = '';
  #decoder = new TextDecoder();

  constructor(path: string, offset = 0) {
    this.path = path;
    this.#offset = offset;
  }

  /** Byte offset up to which the file has been consumed. */
  get offset(): number {
    return this.#offset;
  }

  /** Returns the complete, non-blank lines appended since the previous call. */
  async readLines(): Promise<string[]> {
    // Opened per read so we never hold a handle the game or the user might trip over.
    const handle = await open(this.path, 'r');
    try {
      const { size } = await handle.stat();
      if (size < this.#offset) this.#reset(); // Truncated or replaced: start over.
      if (size === this.#offset) return [];

      const buffer = Buffer.alloc(size - this.#offset);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.#offset);
      this.#offset += bytesRead;

      const text =
        this.#pending + this.#decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      const lines = text.split('\n');
      this.#pending = lines.pop() ?? '';
      return lines
        .map((line) => withoutPadding(line.replace(/\r$/, '')))
        .filter((line): line is string => line !== undefined && line.trim() !== '');
    } finally {
      await handle.close();
    }
  }

  /** Returns and clears the held-back partial line. Call once the writer is known to be done. */
  takeRemainder(): string | undefined {
    const rest = withoutPadding(this.#pending)?.trim();
    this.#pending = '';
    return rest === '' ? undefined : rest;
  }

  #reset(): void {
    this.#offset = 0;
    this.#pending = '';
    this.#decoder = new TextDecoder();
  }
}

/**
 * A line with NUL bytes in it is what an interrupted write leaves behind: the OS reserved the space
 * and nothing was ever written there, so it holds zeros — and past them, whatever was on the disk
 * before, like a fragment of an older line cut off at both ends (seen after a `Shutdown`: 7 KB of
 * zeros, then half a `ModuleBuy` from half an hour earlier). None of that is the game's. What the
 * game did write, before the zeros or after them, starts with `{` and is kept (the last such piece,
 * if there are several); the rest is dropped quietly, since nothing the game wrote is missing.
 */
function withoutPadding(line: string): string | undefined {
  if (!line.includes('\0')) return line;
  return line
    .split('\0')
    .map((piece) => piece.trim())
    .findLast((piece) => piece.startsWith('{'));
}
