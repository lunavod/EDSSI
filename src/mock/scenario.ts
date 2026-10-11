import type { ActivityTallies } from '../shared/activity';
import type { SettingsView } from '../shared/api';
import type { AssistantSnapshot } from '../shared/assistant';
import type { BrowserState } from '../shared/browser';
import type { CarriersSnapshot } from '../shared/carriers';
import type { PinnedPlan, ShoppingList } from '../shared/commodities';
import type { CsvRouteState } from '../shared/csv-route';
import type { FssOverlayStatus, HudColor } from '../shared/edhm';
import type { SystemExternalInfo } from '../shared/edsm';
import type { HistorySnapshot } from '../shared/history';
import type { InputSnapshot } from '../shared/input';
import type { JournalSnapshot } from '../shared/journal';
import type { MaterialsSnapshot } from '../shared/materials';
import type { PlottedRoute } from '../shared/nav-routes';
import type { ShipsSnapshot, StockFit } from '../shared/ships';
import type { TabId } from '../shared/ui';
import type { UpdateState, WhatsNew } from '../shared/updates';
import type { UploadLogEntry, UploadsSnapshot } from '../shared/uploads';
import type { ViewOptions } from '../shared/view-options';

/**
 * Everything one mock EDSSI shows: what each of the main process's services would answer. The
 * journal-driven parts (`journal` … `carriers`) are made by the real services from a fixture
 * journal (`npm run mock:scenario`); the rest is written by hand in `fixtures/`.
 *
 * Plain JSON, so a scenario can be saved, sent and spread over another: `{ ...demo, hudColor }`.
 */
export interface MockScenario {
  /** The EDSSI version it claims to be. */
  version: string;
  /** The session reader's view: the current game session's events and companion files. */
  journal: JournalSnapshot;
  navRoutes: PlottedRoute[];
  csvRoute: CsvRouteState;
  history: HistorySnapshot;
  activity: ActivityTallies;
  materials: MaterialsSnapshot;
  ships: ShipsSnapshot;
  /** Hulls as the shipyard sells them, by the journal's ship name; the rest answer nothing. */
  stockFits: Record<string, StockFit>;
  carriers: CarriersSnapshot;
  shoppingList: ShoppingList;
  pinnedPlan: PinnedPlan | null;
  /** Every commodity name, for suggestions. */
  commodityNames: string[];
  /** What EDSM says of systems, by name; any other is `unknown`. */
  systems: Record<string, SystemExternalInfo>;
  assistant: AssistantSnapshot;
  input: InputSnapshot;
  settings: SettingsView;
  uploads: UploadsSnapshot;
  uploadLog: UploadLogEntry[];
  updates: UpdateState;
  whatsNew: WhatsNew;
  /** The EDHM theme's colour; null draws the game's own orange. */
  hudColor: HudColor | null;
  fssOverlay: FssOverlayStatus;
  viewOptions: ViewOptions;
  browser: BrowserState;
  /** The tab the window is on, for the VR panels that follow it. */
  tab: TabId;
}
