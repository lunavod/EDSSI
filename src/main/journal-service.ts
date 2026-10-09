import { ipcMain } from 'electron';

import { IpcChannel } from '../shared/api';
import {
  COMPANION_NAMES,
  type CompanionState,
  type JournalEvent,
  type JournalSnapshot,
} from '../shared/journal';
import { type Overview, updateOverview } from '../shared/overview';
import { broadcast } from './broadcast';
import type { JournalReader } from './journal';

export interface JournalService {
  /** The current game session as it stands, for a window or the assistant. */
  snapshot(): JournalSnapshot;
  /** Atomically publishes the completed all-history overview after its initial replay. */
  publishHistoryOverview(): void;
}

/**
 * Keeps the current game session in memory as `reader` follows the journal, so a window can catch
 * up with a snapshot and then apply live messages. `historyReader` (backfilling every journal, not
 * just this session) is what `overview` is built from instead: a session that hasn't reached its
 * own `LoadGame` yet (the commander started the game but hasn't logged in) still shows the last
 * real one, even right after EDSSI itself starts.
 */
export function startJournalService(
  reader: JournalReader,
  historyReader: JournalReader,
): JournalService {
  let seq = 0;
  let events: JournalEvent[] = [];
  let overview: Overview = {};
  let historyOverview: Overview = {};
  const companions: CompanionState = {};

  reader.onAny((event) => {
    // Part 1's header starts a new game session; everything before it describes one that's over.
    if (event.event === 'Fileheader' && event.part === 1) events = [];
    events.push(event);
    // This gives a useful overview immediately for a real current session. Once the all-history
    // replay finishes, publishHistoryOverview replaces it with the complete result in one step.
    overview = updateOverview(overview, event);
    broadcast(IpcChannel.JournalMessage, { seq: ++seq, kind: 'event', event });
  });
  historyReader.onAny((event) => {
    // Never expose an in-progress replay: it briefly represents arbitrary old points in time.
    historyOverview = updateOverview(historyOverview, event);
  });
  for (const name of COMPANION_NAMES) {
    reader.onCompanion(name, (event) => {
      Object.assign(companions, { [name]: event });
      broadcast(IpcChannel.JournalMessage, { seq: ++seq, kind: 'companion', name, event });
    });
  }

  const snapshot = (): JournalSnapshot => ({ seq, events, companions, overview });
  const publishHistoryOverview = (): void => {
    overview = historyOverview;
    broadcast(IpcChannel.JournalMessage, {
      seq: ++seq,
      kind: 'overview',
      overview,
    });
  };
  ipcMain.handle(IpcChannel.JournalSnapshot, snapshot);
  return { snapshot, publishHistoryOverview };
}
