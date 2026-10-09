import { ipcMain } from 'electron';

import { IpcChannel } from '../shared/api';
import type { HistorySnapshot } from '../shared/history';
import type { JournalEvent } from '../shared/journal';
import { broadcast } from './broadcast';
import { HistoryTracker } from './history/tracker';
import type { JournalReader } from './journal';
import { type BrokenRecord, PersonalBests } from './records/personal-bests';
import type { BodyRecordStore } from './store/body-record-store';

/** Live events can come in bursts (a honk writes dozens of scans); windows hear at most this often. */
const BROADCAST_INTERVAL_MS = 250;

export interface HistoryService {
  /** Call once `reader` has replayed the older journals. */
  markReady(): void;
  /** The ledger and survey as they stand, for a window or the assistant. */
  snapshot(): HistorySnapshot;
  /**
   * Hears each live event that changed something, once the replay is done. `snapshot` is the state
   * it left behind, worked out only if asked for, since a honk writes dozens of events at once.
   */
  onLiveEvent(listener: (event: JournalEvent, snapshot: () => HistorySnapshot) => void): void;
  /** Hears each live scan that beat one of the commander's own records. */
  onPersonalBest(listener: (broken: BrokenRecord[], systemName: string) => void): void;
}

/**
 * Keeps the ledger, the current system's survey and the commander's personal bests, worked out
 * from every journal. `reader` must replay them all (`backfill: 'all'`). Windows get a snapshot on
 * request and on each change. Without `records` (no database) the bests come from the journals
 * alone.
 */
export function startHistoryService(
  reader: JournalReader,
  records?: BodyRecordStore,
): HistoryService {
  const tracker = new HistoryTracker();
  const bests = new PersonalBests(readRecords(records));
  let ready = false;
  let timer: NodeJS.Timeout | undefined;
  const listeners: ((event: JournalEvent, snapshot: () => HistorySnapshot) => void)[] = [];
  const bestListeners: ((broken: BrokenRecord[], systemName: string) => void)[] = [];

  const snapshot = (): HistorySnapshot => withRecords(tracker.snapshot(ready), bests);
  const send = () => {
    timer = undefined;
    broadcast(IpcChannel.HistoryChanged, snapshot());
  };
  // During the replay a best can change hundreds of times; it is written once, when that's done.
  const save = () => {
    const changed = bests.takeChanged();
    try {
      records?.save(changed);
    } catch (error) {
      console.error('[history] failed to save personal bests', error);
    }
  };

  reader.onAny((event) => {
    const broken = bests.apply(event);
    if (ready && event.event === 'Scan') {
      save();
      if (broken.length > 0) {
        for (const listener of bestListeners) listener(broken, event.StarSystem);
      }
    }
    // During the replay nobody needs every step; the snapshot at the end is what counts.
    if (!tracker.apply(event) || !ready) return;
    timer ??= setTimeout(send, BROADCAST_INTERVAL_MS);
    for (const listener of listeners) listener(event, snapshot);
  });
  ipcMain.handle(IpcChannel.HistorySnapshot, snapshot);

  return {
    snapshot,
    onLiveEvent(listener) {
      listeners.push(listener);
    },
    onPersonalBest(listener) {
      bestListeners.push(listener);
    },
    markReady() {
      ready = true;
      save();
      send();
    },
  };
}

function readRecords(store: BodyRecordStore | undefined) {
  try {
    return store?.all() ?? [];
  } catch (error) {
    console.error('[history] failed to read personal bests', error);
    return [];
  }
}

/** Marks each surveyed body with the commander's bests it holds. */
function withRecords(snapshot: HistorySnapshot, bests: PersonalBests): HistorySnapshot {
  const survey = snapshot.survey;
  if (!survey) return snapshot;
  const held = bests.held(new Set(survey.bodies.map((body) => body.name)));
  if (held.size === 0) return snapshot;
  return {
    ...snapshot,
    survey: {
      ...survey,
      bodies: survey.bodies.map((body) => {
        const records = held.get(body.name);
        return records ? { ...body, records } : body;
      }),
    },
  };
}
