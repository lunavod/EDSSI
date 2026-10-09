import { describe, expect, it } from 'vitest';

import { kokoroNote } from './state';

describe('kokoroNote', () => {
  it('tells loading from downloading, and says nothing once ready', () => {
    expect(kokoroNote({ kind: 'loading' })).toBe('Loading Kokoro’s voice.');
    expect(kokoroNote({ kind: 'idle' })).toBe('Loading Kokoro’s voice.');
    expect(kokoroNote({ kind: 'missing' })).toMatch(/download.*first time only/);
    expect(kokoroNote({ kind: 'downloading', received: 163, total: 326_000_000 / 1 })).toMatch(
      /Downloading Kokoro’s voice: 0% of 326 MB/,
    );
    expect(kokoroNote({ kind: 'ready' })).toBeUndefined();
  });
});
