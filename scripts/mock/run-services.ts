/**
 * The main process's journal-driven services, run over a journal folder as `index.ts` runs them,
 * and asked for what they'd send a window. Loaded by scripts/build-mock-scenario.ts with
 * `electron` aliased to ./electron-stub.ts.
 */

import { startActivityService } from '../../src/main/activity-service';
import { startCarriersService } from '../../src/main/carriers-service';
import { startCsvRouteService } from '../../src/main/csv-route-service';
import { startHistoryService } from '../../src/main/history-service';
import { JournalReader } from '../../src/main/journal';
import { startJournalService } from '../../src/main/journal-service';
import { startMaterialsService } from '../../src/main/materials-service';
import { startNavRouteService } from '../../src/main/nav-route-service';
import { startShipsService } from '../../src/main/ships-service';
import type { ShipCatalogSource } from '../../src/main/ships/catalog';
import { BodyRecordStore } from '../../src/main/store/body-record-store';
import { CraftingTodoStore } from '../../src/main/store/crafting-todo-store';
import { CsvRouteStore } from '../../src/main/store/csv-route-store';
import { openDatabase } from '../../src/main/store/database';
import { NavRouteStore } from '../../src/main/store/nav-route-store';
import { RecipeFavouriteStore } from '../../src/main/store/recipe-favourite-store';
import { SavedRouteStore } from '../../src/main/store/saved-route-store';
import type { ActivityTallies } from '../../src/shared/activity';
import { IpcChannel } from '../../src/shared/api';
import type { CarriersSnapshot } from '../../src/shared/carriers';
import type { NewCraftingTodo } from '../../src/shared/crafting';
import type { CsvRouteState } from '../../src/shared/csv-route';
import type { HistorySnapshot } from '../../src/shared/history';
import type { JournalSnapshot } from '../../src/shared/journal';
import type { MaterialsSnapshot } from '../../src/shared/materials';
import type { PlottedRoute } from '../../src/shared/nav-routes';
import type { ShipCatalog, ShipsSnapshot, StockFit } from '../../src/shared/ships';
import { invoke } from './electron-stub';

export interface ServiceAnswers {
  journal: JournalSnapshot;
  navRoutes: PlottedRoute[];
  csvRoute: CsvRouteState;
  history: HistorySnapshot;
  activity: ActivityTallies;
  materials: MaterialsSnapshot;
  ships: ShipsSnapshot;
  stockFits: Record<string, StockFit>;
  carriers: CarriersSnapshot;
}

export interface ServiceInputs {
  dir: string;
  catalog: ShipCatalog;
  /** A route to load on the Route tab's CSV page, and the stop the commander is at on it. */
  csv: { text: string; fileName: string; name: string; position: number };
  /** What the commander has asked the Materials tab for. */
  todos: NewCraftingTodo[];
  favourites: string[];
  hulls: string[];
}

export async function runServices(inputs: ServiceInputs): Promise<ServiceAnswers> {
  const db = openDatabase(':memory:');
  const reader = new JournalReader({
    dir: inputs.dir,
    backfill: 'session',
    pollIntervalMs: 3_600_000,
  });
  const historyReader = new JournalReader({
    dir: inputs.dir,
    backfill: 'all',
    pollIntervalMs: 3_600_000,
  });
  for (const journal of [reader, historyReader]) {
    journal.onError((error) => console.error('[journal]', error));
  }
  const fetchedAt = new Date().toISOString();
  const catalog: ShipCatalogSource = {
    current: () => inputs.catalog,
    status: () => ({ state: 'ready', fetchedAt, modified: inputs.catalog.modified }),
    onChange: () => {},
    refresh: () => Promise.resolve(),
    stop: () => {},
  };

  const journal = startJournalService(reader, historyReader);
  const activity = startActivityService(historyReader);
  const navRoutes = startNavRouteService(historyReader, new NavRouteStore(db), {});
  const history = startHistoryService(historyReader, new BodyRecordStore(db));
  const csvRoute = startCsvRouteService(reader, {
    store: new CsvRouteStore(db),
    saved: new SavedRouteStore(db),
    copy: () => {},
    locate: () => Promise.resolve(new Map()),
  });
  const ships = startShipsService(historyReader, catalog);
  const carriers = startCarriersService(historyReader, {
    coordinates: () => Promise.resolve(new Map()),
  });
  const materials = startMaterialsService(historyReader, {
    favourites: new RecipeFavouriteStore(db),
    todos: new CraftingTodoStore(db),
    here: () => journal.snapshot().overview.system,
  });

  await reader.start();
  csvRoute.markLive();
  await historyReader.start();
  journal.publishHistoryOverview();
  history.markReady();
  navRoutes.markLive();
  activity.markReady();
  materials.markReady();
  ships.markReady();
  carriers.markReady();

  // What the commander did in the window: a route loaded and saved, to-dos, favourites.
  const problem = await invoke<string | undefined>(
    IpcChannel.CsvRouteLoad,
    inputs.csv.text,
    inputs.csv.fileName,
  );
  if (problem) throw new Error(`The demo route didn't load: ${problem}`);
  await invoke(IpcChannel.CsvRouteSetPosition, inputs.csv.position);
  await invoke(IpcChannel.CsvRouteSave, inputs.csv.name);
  await invoke(IpcChannel.MaterialsTodoAddMany, inputs.todos);
  for (const recipe of inputs.favourites) {
    await invoke(IpcChannel.MaterialsFavourite, recipe, true);
  }

  const stockFits: Record<string, StockFit> = {};
  for (const hull of inputs.hulls) {
    const fit = await invoke<StockFit | undefined>(IpcChannel.ShipsStockFit, hull);
    if (fit) stockFits[hull] = fit;
  }
  const answers: ServiceAnswers = {
    journal: await invoke(IpcChannel.JournalSnapshot),
    navRoutes: await invoke(IpcChannel.NavRoutesRecent),
    csvRoute: await invoke(IpcChannel.CsvRouteGet),
    history: await invoke(IpcChannel.HistorySnapshot),
    activity: await invoke(IpcChannel.ActivityTallies),
    materials: await invoke(IpcChannel.MaterialsSnapshot),
    ships: await invoke(IpcChannel.ShipsSnapshot),
    stockFits,
    carriers: await invoke(IpcChannel.CarriersSnapshot),
  };
  await Promise.all([reader.stop(), historyReader.stop()]);
  db.close();
  return answers;
}
