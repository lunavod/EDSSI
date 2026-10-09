import type { JournalEventMap } from './journal-events.generated';
import type { Overview } from './overview';

export type * from './journal-events.generated';

/** Names of events written to journal files. `Status` only ever exists as a companion file. */
export type JournalEventName = Exclude<keyof JournalEventMap, 'Status'>;
export type JournalEvent = JournalEventMap[JournalEventName];

/** Events the game also keeps in a companion `*.json` file that holds the current state. */
export const COMPANION_NAMES = [
  'Status',
  'Cargo',
  'Market',
  'ModuleInfo',
  'NavRoute',
  'Outfitting',
  'Shipyard',
  'ShipLocker',
  'Backpack',
  'FCMaterials',
] as const;

export type CompanionName = (typeof COMPANION_NAMES)[number];
export type CompanionEvent = JournalEventMap[CompanionName];
export type CompanionState = { [N in CompanionName]?: JournalEventMap[N] };

/** Pushed from main to renderers. `seq` goes up by one per message. */
export type JournalMessage =
  | { seq: number; kind: 'event'; event: JournalEvent }
  | { seq: number; kind: 'companion'; name: CompanionName; event: CompanionEvent }
  | { seq: number; kind: 'overview'; overview: Overview };

/** The current game session up to and including message `seq`. */
export interface JournalSnapshot {
  seq: number;
  events: JournalEvent[];
  companions: CompanionState;
  /**
   * Who and where the commander is, carried across a session that hasn't reached its own
   * `LoadGame` yet, so a game just started (but not logged into) still shows the last real one.
   */
  overview: Overview;
}
