import { appendFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { LineReader } from './line-reader';

describe('LineReader', () => {
  let path: string;

  beforeEach(async () => {
    path = join(await mkdtemp(join(tmpdir(), 'edssi-lines-')), 'Journal.log');
    await writeFile(path, '');
  });

  it('returns only complete lines and holds back a partial one until it completes', async () => {
    const reader = new LineReader(path);
    await appendFile(path, 'one\r\ntwo\r\nthr');
    expect(await reader.readLines()).toEqual(['one', 'two']);

    await appendFile(path, 'ee\r\n');
    expect(await reader.readLines()).toEqual(['three']);
    expect(await reader.readLines()).toEqual([]);
  });

  it('decodes a multi-byte character split across reads', async () => {
    const reader = new LineReader(path);
    const bytes = Buffer.from('Añ\n', 'utf8');
    await appendFile(path, bytes.subarray(0, 2)); // Cuts "ñ" in half.
    expect(await reader.readLines()).toEqual([]);

    await appendFile(path, bytes.subarray(2));
    expect(await reader.readLines()).toEqual(['Añ']);
  });

  it('drops NUL padding and blank lines', async () => {
    const reader = new LineReader(path);
    await appendFile(path, '\0\0\0{"a":1}\n\n   \n');
    expect(await reader.readLines()).toEqual(['{"a":1}']);
  });

  it('drops the stale bytes after NUL padding, keeping what the game wrote either side', async () => {
    const reader = new LineReader(path);
    await appendFile(
      path,
      '{"a":1}\0\0\r\n' +
        '\0\0\0 "timestamp":"2025-10-26T21:09:31Z", "event":"Mod\r\n' +
        '\0{"b":2}\n',
    );
    expect(await reader.readLines()).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('starts over when the file shrinks', async () => {
    const reader = new LineReader(path);
    await appendFile(path, 'a long first line\n');
    await reader.readLines();

    await writeFile(path, 'new\n');
    expect(await reader.readLines()).toEqual(['new']);
  });

  it('can start at an offset and hand back an unterminated last line', async () => {
    await appendFile(path, 'old\n');
    const reader = new LineReader(path, 4);
    await appendFile(path, 'new\nlast');

    expect(await reader.readLines()).toEqual(['new']);
    expect(reader.takeRemainder()).toBe('last');
    expect(reader.takeRemainder()).toBeUndefined();
  });
});
