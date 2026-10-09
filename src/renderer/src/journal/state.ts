import type {
  CompanionState,
  JournalEvent,
  JournalMessage,
  JournalSnapshot,
} from '../../../shared/journal';
import { type Overview, updateOverview } from '../../../shared/overview';

/** How many of the session's most recent events the journal view keeps. */
const ENTRY_LIMIT = 1000;

export interface JournalEntry {
  id: number;
  event: JournalEvent;
  /** Tells us nothing new, e.g. a ship locker snapshot identical to the previous one. */
  redundant: boolean;
}

/** What the UI shows, derived from the current session's events and companion files. */
export interface JournalState {
  overview: Overview;
  /** Newest first. */
  entries: JournalEntry[];
  nextId: number;
  companions: CompanionState;
  /** Contents of the last ship locker snapshot, to spot unchanged ones. */
  lockerKey?: string;
}

export const emptyJournalState: JournalState = {
  overview: {},
  entries: [],
  nextId: 0,
  companions: {},
};

/**
 * The game rewrites the ship locker snapshot on material trades, crafts, jumps and more, whether
 * or not anything changed. A snapshot is redundant if it has no contents (those are only in
 * ShipLocker.json) or the same contents as the previous one.
 */
function lockerStep(
  lockerKey: string | undefined,
  event: JournalEvent,
): { lockerKey: string | undefined; redundant: boolean } {
  if (event.event !== 'ShipLocker') return { lockerKey, redundant: false };
  if (event.Items === undefined) return { lockerKey, redundant: true };
  const key = JSON.stringify(
    [event.Items, event.Components, event.Consumables, event.Data],
    (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
  );
  return { lockerKey: key, redundant: key === lockerKey };
}

/** Part 1's header starts a new game session (mirrors the main process's session buffer). */
function startsSession(event: JournalEvent): boolean {
  return event.event === 'Fileheader' && event.part === 1;
}

export function applyEvent(state: JournalState, event: JournalEvent): JournalState {
  // The entry list and companions are this session's; the overview (commander, ship, credits,
  // where they are) is carried forward until new events overwrite it, so a session that hasn't
  // reached its own LoadGame yet (the commander started the game but hasn't logged in) still
  // shows the last real one.
  const base = startsSession(event)
    ? { ...emptyJournalState, companions: state.companions, overview: state.overview }
    : state;
  const locker = lockerStep(base.lockerKey, event);
  return {
    ...base,
    overview: updateOverview(base.overview, event),
    entries: [
      { id: state.nextId, event, redundant: locker.redundant },
      ...base.entries.slice(0, ENTRY_LIMIT - 1),
    ],
    nextId: state.nextId + 1,
    lockerKey: locker.lockerKey,
  };
}

export function stateFromSnapshot(snapshot: JournalSnapshot): JournalState {
  const { events } = snapshot;
  let lockerKey: string | undefined;
  const redundant = events.map((event) => {
    const step = lockerStep(lockerKey, event);
    lockerKey = step.lockerKey;
    return step.redundant;
  });
  const firstKept = Math.max(0, events.length - ENTRY_LIMIT);
  return {
    overview: snapshot.overview,
    entries: events
      .slice(firstKept)
      .map((event, index) => ({
        id: firstKept + index,
        event,
        redundant: redundant[firstKept + index] ?? false,
      }))
      .toReversed(),
    nextId: events.length,
    companions: snapshot.companions,
    lockerKey,
  };
}

/**
 * State for a window following the journal: messages that arrive before the snapshot are held
 * back, and anything the snapshot already covers (`seq` ≤ its `seq`) is skipped.
 */
export interface JournalSync {
  /** Last message applied; `undefined` until the snapshot arrives. */
  seq: number | undefined;
  pending: JournalMessage[];
  journal: JournalState;
}

export type JournalSyncAction =
  | { type: 'snapshot'; snapshot: JournalSnapshot }
  | { type: 'message'; message: JournalMessage };

export const initialJournalSync: JournalSync = {
  seq: undefined,
  pending: [],
  journal: emptyJournalState,
};

export function journalSyncReducer(state: JournalSync, action: JournalSyncAction): JournalSync {
  if (action.type === 'message') {
    return state.seq === undefined
      ? { ...state, pending: [...state.pending, action.message] }
      : applyMessage(state, action.message);
  }

  const { snapshot } = action;
  if (state.seq !== undefined && snapshot.seq <= state.seq) return state; // A stale duplicate.
  const synced: JournalSync = {
    seq: snapshot.seq,
    pending: [],
    journal: stateFromSnapshot(snapshot),
  };
  return state.pending.reduce(applyMessage, synced);
}

function applyMessage(state: JournalSync, message: JournalMessage): JournalSync {
  if (state.seq !== undefined && message.seq <= state.seq) return state;
  let journal: JournalState;
  if (message.kind === 'event') journal = applyEvent(state.journal, message.event);
  else if (message.kind === 'overview') {
    journal = { ...state.journal, overview: message.overview };
  } else {
    journal = {
      ...state.journal,
      companions: { ...state.journal.companions, [message.name]: message.event },
    };
  }
  return { ...state, seq: message.seq, journal };
}
