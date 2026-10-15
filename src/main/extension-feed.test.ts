import { describe, expect, it, vi } from 'vitest';

import type { JournalEvent } from '../shared/journal';
import { type FeedSource, guardSessionFeed, journalFeed } from './extension-feed';
import type { JournalEventSource } from './journal/reader';

/** A reader that dispatches only what the test sends it. */
function fakeReader() {
  const any = new Set<(event: JournalEvent, source: JournalEventSource) => void>();
  const companions = new Set<(event: never) => void>();
  const reader: FeedSource = {
    on: (name, handler) => {
      const wrapped = (event: JournalEvent, source: JournalEventSource) => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- matched by name just here
        if (event.event === name) handler(event as never, source);
      };
      any.add(wrapped);
      return () => any.delete(wrapped);
    },
    onAny: (handler) => {
      any.add(handler);
      return () => any.delete(handler);
    },
    onCompanion: (_name, handler) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test sends the shape
      companions.add(handler as (event: never) => void);
      return () => companions.delete(handler as (event: never) => void);
    },
  };
  const source = { file: 'Journal.log', line: 1 };
  return {
    reader,
    send(event: string) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a made-up event
      for (const handler of any) handler({ event, timestamp: '' } as JournalEvent, source);
    },
    companion() {
      for (const handler of companions) handler({} as never);
    },
  };
}

describe('journalFeed', () => {
  it('marks events replayed until the reader is live', () => {
    const fake = fakeReader();
    const { feed, markLive } = journalFeed(fake.reader);
    const seen: [string, boolean][] = [];
    feed.on('FSDJump', (event, info) => seen.push([event.event, info.live]));
    feed.onAny((event, info) => seen.push([`any ${event.event}`, info.live]));
    fake.send('FSDJump');
    markLive();
    fake.send('FSDJump');
    fake.send('Docked');
    expect(seen).toEqual([
      ['FSDJump', false],
      ['any FSDJump', false],
      ['FSDJump', true],
      ['any FSDJump', true],
      ['any Docked', true],
    ]);
  });

  it('tells each listener once the replay is done, and a late one at once', () => {
    const { feed, markLive } = journalFeed(fakeReader().reader);
    const early = vi.fn();
    const dropped = vi.fn();
    feed.onLive(early);
    feed.onLive(dropped)();
    expect(feed.isLive()).toBe(false);
    markLive();
    markLive();
    expect(early).toHaveBeenCalledOnce();
    expect(dropped).not.toHaveBeenCalled();
    const late = vi.fn();
    feed.onLive(late);
    expect(late).toHaveBeenCalledOnce();
    expect(feed.isLive()).toBe(true);
  });
});

describe('guardSessionFeed', () => {
  it('reports a handler that throws, and the others still hear the event', () => {
    const fake = fakeReader();
    const report = vi.fn();
    const feed = guardSessionFeed(journalFeed(fake.reader).feed, report);
    const after = vi.fn();
    feed.onAny(() => {
      throw new Error('broken');
    });
    feed.onAny(after);
    feed.onCompanion('Status', () => {
      throw new Error('also broken');
    });
    expect(() => fake.send('Docked')).not.toThrow();
    expect(() => fake.companion()).not.toThrow();
    expect(after).toHaveBeenCalledOnce();
    expect(report.mock.calls.map(([error]) => (error as Error).message)).toEqual([
      'broken',
      'also broken',
    ]);
  });
});
