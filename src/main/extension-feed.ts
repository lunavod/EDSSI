/**
 * The journal as extensions hear it (`MainExtensionContext.journal`): a reader's events, each
 * marked live or replayed, and a handler that throws reported under the extension's name rather
 * than the reader's. Nothing here touches Electron, so it is tested on its own.
 */

import type {
  CompanionName,
  JournalEvent,
  JournalEventMap,
  JournalEventName,
} from '../shared/journal';
import type { JournalEventSource } from './journal/reader';

/** Where an event came from, and whether it is happening now. */
export interface JournalEventInfo extends JournalEventSource {
  /** False while the reader replays what was written before EDSSI started. */
  live: boolean;
}

export interface JournalFeed {
  /** Each event of one kind, replayed first, then as the game writes it. */
  on<N extends JournalEventName>(
    name: N,
    handler: (event: JournalEventMap[N], info: JournalEventInfo) => void,
  ): () => void;
  /** Every event, replayed first, then as the game writes it. */
  onAny(handler: (event: JournalEvent, info: JournalEventInfo) => void): () => void;
  /** Whether the replay is done, so what arrives now is happening now. */
  isLive(): boolean;
  /** Called once the replay is done (at once, if it is). Returns the way to stop listening. */
  onLive(handler: () => void): () => void;
}

export interface SessionFeed extends JournalFeed {
  /**
   * A companion file (`Status`, `Cargo`, `Market`…): its contents when the reader starts, then
   * whenever the game rewrites it.
   */
  onCompanion<N extends CompanionName>(
    name: N,
    handler: (event: JournalEventMap[N]) => void,
  ): () => void;
}

/** What a feed needs of a `JournalReader`. */
export interface FeedSource {
  on<N extends JournalEventName>(
    name: N,
    handler: (event: JournalEventMap[N], source: JournalEventSource) => void,
  ): () => void;
  onAny(handler: (event: JournalEvent, source: JournalEventSource) => void): () => void;
  onCompanion<N extends CompanionName>(
    name: N,
    handler: (event: JournalEventMap[N]) => void,
  ): () => void;
}

/** A reader's feed, and the call that says its replay is done. */
export function journalFeed(reader: FeedSource): {
  feed: SessionFeed;
  markLive: () => void;
} {
  let live = false;
  const waiting = new Set<() => void>();
  const info = (source: JournalEventSource): JournalEventInfo => ({ ...source, live });
  const feed: SessionFeed = {
    on: (name, handler) => reader.on(name, (event, source) => handler(event, info(source))),
    onAny: (handler) => reader.onAny((event, source) => handler(event, info(source))),
    onCompanion: (name, handler) => reader.onCompanion(name, handler),
    isLive: () => live,
    onLive(handler) {
      if (live) {
        handler();
        return () => {};
      }
      waiting.add(handler);
      return () => waiting.delete(handler);
    },
  };
  return {
    feed,
    markLive: () => {
      if (live) return;
      live = true;
      for (const handler of waiting) handler();
      waiting.clear();
    },
  };
}

/** Wraps a handler so that one that throws is reported and the reader goes on to the next. */
function guarded<A extends unknown[]>(
  handler: (...args: A) => void,
  report: (error: unknown) => void,
): (...args: A) => void {
  return (...args) => {
    try {
      handler(...args);
    } catch (error) {
      report(error);
    }
  };
}

/** The same feed, each handler guarded: one that throws is reported through `report`. */
export function guardFeed(feed: JournalFeed, report: (error: unknown) => void): JournalFeed {
  return {
    on: (name, handler) => feed.on(name, guarded(handler, report)),
    onAny: (handler) => feed.onAny(guarded(handler, report)),
    isLive: () => feed.isLive(),
    onLive: (handler) => feed.onLive(guarded(handler, report)),
  };
}

export function guardSessionFeed(feed: SessionFeed, report: (error: unknown) => void): SessionFeed {
  return {
    ...guardFeed(feed, report),
    onCompanion: (name, handler) => feed.onCompanion(name, guarded(handler, report)),
  };
}
