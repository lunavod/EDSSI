import { ipcMain } from 'electron';

import { IpcChannel } from '../shared/api';
import type { CarriersSnapshot } from '../shared/carriers';
import type { Coords } from '../shared/csv-route';
import { broadcast } from './broadcast';
import { CarriersTracker } from './carriers/tracker';
import type { JournalReader } from './journal';

/** Live events can come in bursts (a round of cargo transfers); windows hear at most this often. */
const BROADCAST_INTERVAL_MS = 250;
/** A system EDSM couldn't place is asked about again after this long. */
const RETRY_MS = 30 * 60_000;
/** The longest a timer is set for; a laptop asleep past a departure catches up on waking. */
const MAX_WAIT_MS = 60 * 60_000;

export interface CarriersService {
  /** Call once `reader` has replayed the older journals. */
  markReady(): void;
  snapshot(): CarriersSnapshot;
}

export interface CarriersServiceOptions {
  /** Where EDSM puts systems, keyed by lowercase name; rejects if it can't be reached. */
  coordinates(names: readonly string[]): Promise<Map<string, Coords>>;
}

/**
 * The commander's carriers, from every journal (`reader` must replay them all). Systems the
 * journal never gave a position for (the carrier went where the commander hasn't been) are asked
 * of EDSM, so each jump's tritium can be worked out and the distance to the carrier shown.
 */
export function startCarriersService(
  reader: JournalReader,
  options: CarriersServiceOptions,
): CarriersService {
  const tracker = new CarriersTracker();
  let ready = false;
  let timer: NodeJS.Timeout | undefined;
  let dueTimer: NodeJS.Timeout | undefined;
  /** When each system name was last asked of EDSM. */
  const asked = new Map<string, number>();

  const snapshot = (): CarriersSnapshot => {
    // Replayed events set the clock during the replay; after it, a jump leaves on time.
    if (ready) tracker.settle(Date.now());
    return {
      version: tracker.version,
      ready,
      ...(tracker.commander !== undefined && { commander: tracker.commander }),
      carriers: tracker.views(),
    };
  };
  const send = () => {
    clearTimeout(timer);
    timer = undefined;
    broadcast(IpcChannel.CarriersChanged, snapshot());
    schedule();
    locate();
  };
  const changed = () => {
    if (ready) timer ??= setTimeout(send, BROADCAST_INTERVAL_MS);
  };

  /** Wakes when the next jump leaves, so the carrier moves without waiting for the journal. */
  const schedule = () => {
    clearTimeout(dueTimer);
    const due = tracker.nextDue();
    if (due === undefined) return;
    const wait = Math.min(Math.max(due - Date.now(), 0) + 1000, MAX_WAIT_MS);
    dueTimer = setTimeout(() => {
      if (tracker.settle(Date.now())) changed();
      else schedule();
    }, wait);
  };

  const locate = () => {
    const now = Date.now();
    const names = tracker
      .missingPositions()
      .filter((name) => now - (asked.get(name.toLowerCase()) ?? -Infinity) > RETRY_MS);
    if (names.length === 0) return;
    for (const name of names) asked.set(name.toLowerCase(), now);
    options.coordinates(names).then(
      (found) => {
        if (tracker.addPositions(found)) changed();
      },
      (error: unknown) => console.error('[carriers] failed to place systems on EDSM', error),
    );
  };

  reader.onAny((event) => {
    if (tracker.apply(event)) changed();
  });
  ipcMain.handle(IpcChannel.CarriersSnapshot, snapshot);

  return {
    snapshot,
    markReady() {
      ready = true;
      send();
    },
  };
}
