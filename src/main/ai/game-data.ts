/**
 * Everything the assistant is allowed to read about the game, in one place. The services in
 * `src/main` provide it; tests provide a stub. Nothing here reaches the network except `system`.
 */

import type { CarriersSnapshot } from '../../shared/carriers';
import type { CsvRouteState } from '../../shared/csv-route';
import type { SystemExternalInfo } from '../../shared/edsm';
import type { HistorySnapshot } from '../../shared/history';
import type { JournalSnapshot } from '../../shared/journal';
import type { PlottedRoute } from '../../shared/nav-routes';
import type { Overview } from '../../shared/overview';
import type { Settings } from '../../shared/settings';
import type { ActivityData } from '../activity-service';

export interface GameData {
  /** The current game session's events and companion files. */
  session(): JournalSnapshot;
  /** Who the commander is, what they fly and where they are, folded out of the session. */
  overview(): Overview;
  /** The ledger and the current system's survey, from every journal EDSSI has read. */
  history(): HistorySnapshot;
  /** The commander's own carrier and their squadron's, from every journal. */
  carriers(): CarriersSnapshot;
  /** What the commander has done, as small records from every journal, for summaries by period. */
  activity(): ActivityData;
  /** Routes plotted in this session, oldest first. Empty when EDSSI has no database. */
  routes(): PlottedRoute[];
  /** The route loaded from a CSV file (or made elsewhere), and where the commander is on it. */
  csvRoute(): CsvRouteState;
  /** The settings file as EDSSI is running it. */
  settings(): Settings;
  /** What EDSM knows about a system. Resolves even when EDSM can't be reached. */
  system(name: string): Promise<SystemExternalInfo>;
}
