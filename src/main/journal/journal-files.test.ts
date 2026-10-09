import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { journalSessionKey, listJournalFiles } from './journal-files';

describe('listJournalFiles', () => {
  it('lists only journal files, ordered chronologically across both naming schemes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edssi-journal-'));
    const names = [
      'Journal.2026-09-10T195058.01.log',
      'Journal.190110123456.02.log',
      'Journal.2026-09-10T175410.01.log',
      'Journal.190110123456.01.log',
      'Status.json',
      'edmc-journal-lock.txt',
    ];
    await Promise.all(names.map((name) => writeFile(join(dir, name), '')));

    expect(await listJournalFiles(dir)).toEqual([
      'Journal.190110123456.01.log',
      'Journal.190110123456.02.log',
      'Journal.2026-09-10T175410.01.log',
      'Journal.2026-09-10T195058.01.log',
    ]);
  });

  it('returns an empty list for a missing directory', async () => {
    expect(await listJournalFiles(join(tmpdir(), 'edssi-does-not-exist'))).toEqual([]);
  });
});

describe('journalSessionKey', () => {
  it('is shared by all parts of a session', () => {
    expect(journalSessionKey('Journal.2026-09-10T195058.01.log')).toBe(
      journalSessionKey('Journal.2026-09-10T195058.02.log'),
    );
    expect(journalSessionKey('Journal.2026-09-10T195058.01.log')).not.toBe(
      journalSessionKey('Journal.2026-09-10T175410.01.log'),
    );
  });
});
