import { describe, expect, it } from 'vitest';

import type { NewUploadLogEntry } from '../uploads/log';
import { openDatabase } from './database';
import { UploadLogStore } from './upload-log-store';

const entry = (at: string, overrides: Partial<NewUploadLogEntry> = {}): NewUploadLogEntry => ({
  target: 'edsm',
  source: 'live',
  at,
  firstEvent: '2026-09-12T16:00:00Z',
  lastEvent: '2026-09-12T16:05:00Z',
  events: 3,
  eventCounts: { FSDJump: 1, Scan: 2 },
  systems: ['Alpha'],
  outcome: 'sent',
  accepted: 2,
  refused: [{ event: 'Scan', code: 302, message: 'Duplicate' }],
  ...overrides,
});

describe('UploadLogStore', () => {
  it('keeps every request, newest first', () => {
    const db = openDatabase(':memory:');
    const store = new UploadLogStore(db);
    store.add(entry('2026-09-12T16:05:02Z'));
    store.add(
      entry('2026-09-12T16:06:00Z', {
        target: 'inara',
        source: 'backfill',
        outcome: 'retry',
        accepted: undefined,
        message: "Couldn't reach Inara",
        refused: [],
      }),
    );

    const [newest, oldest] = store.recent(10);
    expect(newest).toMatchObject({
      id: 2,
      target: 'inara',
      source: 'backfill',
      outcome: 'retry',
      message: "Couldn't reach Inara",
    });
    expect(newest?.accepted).toBeUndefined();
    expect(oldest).toEqual({ id: 1, ...entry('2026-09-12T16:05:02Z') });
    expect(store.recent(1)).toHaveLength(1);
    expect(store.firstLiveEvent('edsm')).toBe('2026-09-12T16:00:00Z');
    // The only Inara request was a backfilled one, so the live upload has sent it nothing.
    expect(store.firstLiveEvent('inara')).toBeUndefined();
    db.close();
  });
});
