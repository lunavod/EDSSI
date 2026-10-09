import { ipcMain } from 'electron';

import { type ActivityTallies, tally } from '../shared/activity';
import { IpcChannel } from '../shared/api';
import { resolvePeriod } from './activity/periods';
import { ActivityTracker, type CommanderActivity } from './activity/tracker';
import { broadcast } from './broadcast';
import type { JournalReader } from './journal';

/** Live events come in bursts (a honk writes dozens of scans); windows hear at most this often. */
const BROADCAST_INTERVAL_MS = 1000;

/** What the assistant reads about the commander's past: see `activity/tracker.ts`. */
export interface ActivityData {
  /** False while EDSSI is still reading older journals. */
  ready: boolean;
  commander: CommanderActivity;
  /** When each game session began, oldest first. */
  sessionStarts: readonly number[];
}

export interface ActivityService {
  /** Call once `reader` has replayed the older journals. */
  markReady(): void;
  snapshot(): ActivityData;
}

/** Today's, this session's and this trip's tallies, as of `now`. */
export function activityTallies(
  data: ActivityData,
  version: number,
  now = new Date(),
): ActivityTallies {
  const { commander, sessionStarts } = data;
  const context = { sessionStarts, lastSale: commander.lastDataSale };
  const today = resolvePeriod('today', now, context);
  const session = resolvePeriod('this_session', now, context);
  const trip = resolvePeriod('since_last_sale', now, context);
  return {
    version,
    ready: data.ready,
    today: tally(
      commander.records,
      commander.spans,
      typeof today === 'string' ? { from: now.getTime(), to: now.getTime() } : today,
    ),
    session:
      typeof session === 'string' ? undefined : tally(commander.records, commander.spans, session),
    trip: {
      ...tally(
        commander.records,
        commander.spans,
        typeof trip === 'string' ? { from: 0, to: now.getTime() } : trip,
      ),
      sinceSale: commander.lastDataSale !== undefined,
    },
  };
}

/**
 * Keeps a record of what the commander has done, from every journal. `reader` must replay them all
 * (`backfill: 'all'`). The assistant reads the records; windows get today's, this session's and this
 * trip's tallies on request and on each change.
 */
export function startActivityService(reader: JournalReader): ActivityService {
  const tracker = new ActivityTracker();
  let ready = false;
  let version = 0;
  let timer: NodeJS.Timeout | undefined;

  const snapshot = (): ActivityData => ({
    ready,
    commander: tracker.current,
    sessionStarts: tracker.sessionStarts,
  });
  const send = () => {
    timer = undefined;
    broadcast(IpcChannel.ActivityChanged, activityTallies(snapshot(), version));
  };

  reader.onAny((event) => {
    tracker.apply(event);
    version++;
    // During the replay nobody needs every step; the tallies at the end are what count.
    if (ready) timer ??= setTimeout(send, BROADCAST_INTERVAL_MS);
  });
  ipcMain.handle(IpcChannel.ActivityTallies, () => activityTallies(snapshot(), version));

  return {
    markReady() {
      ready = true;
      send();
    },
    snapshot,
  };
}
