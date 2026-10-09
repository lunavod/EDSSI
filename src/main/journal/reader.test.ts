import { appendFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Backfill, JournalReader } from './reader';

const OLD_SESSION = 'Journal.2026-09-09T100000.01.log';
const SESSION_PART_1 = 'Journal.2026-09-10T100000.01.log';
const SESSION_PART_2 = 'Journal.2026-09-10T100000.02.log';
const NEXT_SESSION = 'Journal.2026-09-11T100000.01.log';

function line(event: string, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ timestamp: '2026-09-10T10:00:00Z', event, ...extra })}\r\n`;
}

/** "Journal.2026-09-10T100000.02.log" + Music → "2026-09-10T100000.02:Music" */
function label(file: string, event: string): string {
  return `${file.replace(/^Journal\.|\.log$/g, '')}:${event}`;
}

describe('JournalReader', () => {
  let dir: string;
  let reader: JournalReader | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'edssi-reader-'));
    await writeFile(join(dir, OLD_SESSION), line('Fileheader') + line('Shutdown'));
    await writeFile(join(dir, SESSION_PART_1), line('Fileheader') + line('Continued'));
    await writeFile(join(dir, SESSION_PART_2), line('Fileheader') + line('Music'));
  });

  afterEach(async () => {
    await reader?.stop();
    reader = undefined;
  });

  async function startReader(backfill: Backfill) {
    const seen: string[] = [];
    const errors: Error[] = [];
    reader = new JournalReader({ dir, backfill, pollIntervalMs: 10 });
    reader.onAny((event, source) => seen.push(label(source.file, event.event)));
    reader.onError((error) => errors.push(error));
    await reader.start();
    return { seen, errors };
  }

  it.each([
    [
      'all',
      [
        '2026-09-09T100000.01:Fileheader',
        '2026-09-09T100000.01:Shutdown',
        '2026-09-10T100000.01:Fileheader',
        '2026-09-10T100000.01:Continued',
        '2026-09-10T100000.02:Fileheader',
        '2026-09-10T100000.02:Music',
      ],
    ],
    [
      'session',
      [
        '2026-09-10T100000.01:Fileheader',
        '2026-09-10T100000.01:Continued',
        '2026-09-10T100000.02:Fileheader',
        '2026-09-10T100000.02:Music',
      ],
    ],
    ['none', []],
  ] as const)('backfills %s', async (backfill, expected) => {
    const { seen } = await startReader(backfill);
    expect(seen).toEqual(expected);
  });

  it('follows appended lines, then moves on to a new journal file', async () => {
    const { seen } = await startReader('none');

    await appendFile(join(dir, SESSION_PART_2), line('Shutdown'));
    await vi.waitFor(() => expect(seen).toEqual(['2026-09-10T100000.02:Shutdown']));

    await writeFile(join(dir, NEXT_SESSION), line('Fileheader'));
    await vi.waitFor(() => expect(seen.at(-1)).toBe('2026-09-11T100000.01:Fileheader'));
  });

  it('starts from the beginning of a journal that appears after an empty directory', async () => {
    dir = await mkdtemp(join(tmpdir(), 'edssi-reader-empty-'));
    const { seen } = await startReader('none');

    await writeFile(join(dir, NEXT_SESSION), line('Fileheader') + line('LoadGame'));
    await vi.waitFor(() =>
      expect(seen).toEqual(['2026-09-11T100000.01:Fileheader', '2026-09-11T100000.01:LoadGame']),
    );
  });

  it('dispatches typed events to named handlers with their source', async () => {
    reader = new JournalReader({ dir, backfill: 'none', pollIntervalMs: 10 });
    const jumps: string[] = [];
    reader.on('FSDJump', (event, source) => jumps.push(`${event.StarSystem}@${source.line}`));
    await reader.start();

    await appendFile(join(dir, SESSION_PART_2), line('FSDJump', { StarSystem: 'Sol' }));
    await vi.waitFor(() => expect(jumps).toEqual(['Sol@1']));
  });

  it('reports unreadable lines and handler errors, then carries on', async () => {
    const { seen, errors } = await startReader('none');
    reader!.on('Music', () => {
      throw new Error('handler failed');
    });

    await appendFile(join(dir, SESSION_PART_2), 'garbage\r\n' + line('Music'));
    await vi.waitFor(() => expect(seen).toEqual(['2026-09-10T100000.02:Music']));
    expect(errors.map((error) => error.message)).toEqual([
      expect.stringContaining('Unreadable journal line'),
      'handler failed',
    ]);
  });

  it('skips the zeros and stale bytes an interrupted write leaves, keeping a line after them', async () => {
    const { seen, errors } = await startReader('none');

    const stale = ' "timestamp":"2026-09-10T09:00:00Z", "event":"ModuleBuy", "Slot":"Slo';
    await appendFile(
      join(dir, SESSION_PART_2),
      `${'\0'.repeat(64)}${stale}
${'\0'.repeat(8)}${line('Music')}`,
    );
    await vi.waitFor(() => expect(seen).toEqual(['2026-09-10T100000.02:Music']));
    expect(errors).toEqual([]);
  });

  it('dispatches companion files on start and on change, retrying a half-written file', async () => {
    const statusPath = join(dir, 'Status.json');
    await writeFile(statusPath, line('Status', { Flags: 1 }));

    reader = new JournalReader({ dir, backfill: 'none', pollIntervalMs: 10 });
    const flags: number[] = [];
    const errors: Error[] = [];
    reader.onCompanion('Status', (status) => flags.push(status.Flags ?? -1));
    reader.onError((error) => errors.push(error));
    await reader.start();
    expect(flags).toEqual([1]);

    await writeFile(statusPath, '{ "timestamp":"2026-09-10T10:00:01Z", "ev');
    await writeFile(statusPath, line('Status', { Flags: 16777216 }));
    await vi.waitFor(() => expect(flags).toEqual([1, 16777216]));
    expect(errors).toEqual([]);
  });

  it('reads companion files on demand', async () => {
    await writeFile(
      join(dir, 'Cargo.json'),
      line('Cargo', { Vessel: 'Ship', Count: 0, Inventory: [] }),
    );
    reader = new JournalReader({ dir });

    expect((await reader.readCompanion('Cargo'))?.Vessel).toBe('Ship');
    expect(await reader.readCompanion('Market')).toBeUndefined();
  });
});
