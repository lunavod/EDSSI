import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';

import { IpcChannel } from '../shared/api';
import {
  type CsvRoute,
  type CsvRouteState,
  type CsvRouteSystem,
  hasStarColumn,
  type Located,
  parseCsvRoute,
  type SavedRouteSummary,
  SAVED_ROUTE_NAME_LENGTH,
  sameSystem,
} from '../shared/csv-route';
import { broadcast } from './broadcast';
import { CsvRouteTracker } from './csv-route/tracker';
import type { JournalReader } from './journal';
import type { CsvRouteStore } from './store/csv-route-store';
import type { SavedRouteStore } from './store/saved-route-store';

export interface CsvRouteService {
  /** Call once `reader` has replayed the session: jumps from then on copy the next system. */
  markLive(): void;
  /**
   * Follows a route made elsewhere (an extension's) as though it had been loaded from a file. One
   * that `save` saved (it carries the `savedId`) is taken up as the saved route, where it was left.
   */
  load(route: CsvRoute): void;
  /**
   * Saves a route made elsewhere under a name, over any saved under it, without following it.
   * Answers its `savedId`, or why it couldn't be saved.
   */
  save(name: string, route: CsvRoute): { id: number } | { problem: string };
  /** The route and where the commander is on it. */
  state(): CsvRouteState;
}

/**
 * The route loaded from a CSV file on the Route tab (a Spansh export, usually). Follows the
 * session reader's jumps along it, and on each live arrival in one of its systems puts the next
 * one on the clipboard, ready to paste into the galaxy map. That has to happen here rather than in
 * the window: the game has focus when the commander jumps.
 */
export function startCsvRouteService(
  reader: JournalReader,
  options: {
    store?: CsvRouteStore;
    /** Routes saved under a name, to switch between. */
    saved?: SavedRouteStore;
    copy: (text: string) => void;
    /**
     * Where the systems are, and their stars, for the ones it knows (keyed by name in lower
     * case). Given the systems missing either.
     */
    locate?: (systems: readonly CsvRouteSystem[]) => Promise<Map<string, Located>>;
  },
): CsvRouteService {
  const { store, saved: savedRoutes, copy, locate } = options;
  let saved: ReturnType<CsvRouteStore['load']>;
  try {
    saved = store?.load();
  } catch (error) {
    console.error('[csv-route] failed to read the saved route', error);
  }
  const tracker = new CsvRouteTracker(saved);
  let live = false;
  /** Where the picker opens: the folder of the last file picked, kept past a clear. */
  let lastFolder = saved?.route.folder;

  const listSaved = (): SavedRouteSummary[] => {
    try {
      return savedRoutes?.list() ?? [];
    } catch (error) {
      console.error('[csv-route] failed to list the saved routes', error);
      return [];
    }
  };
  // A saved route deleted while EDSSI wasn't running (or a database put back) is saved no more.
  const savedId = tracker.route?.savedId;
  if (savedId !== undefined && !listSaved().some((route) => route.id === savedId)) {
    tracker.keepAs(undefined);
  }

  const state = (): CsvRouteState => ({ ...tracker.state(), saved: listSaved() });
  const publish = (): CsvRouteState => {
    const current = state();
    broadcast(IpcChannel.CsvRouteChanged, current);
    return current;
  };
  /** Keeps the route and where the commander is on it, in its saved copy too. */
  const persist = (): void => {
    const route = tracker.route;
    if (!route) return;
    store?.save(route, tracker.position);
    if (route.savedId !== undefined) savedRoutes?.update(route.savedId, route, tracker.position);
  };
  /** Places what was found on the route, if it is still the one loaded, and keeps it. */
  const placed = (find: (name: string) => Partial<Located> | undefined): void => {
    if (!tracker.locate(find)) return;
    persist();
    if (live) publish();
  };
  /**
   * Looks up the systems a route doesn't say the place of, for the map, or (with no star column
   * in the file) the star of, for whether they can be scooped.
   */
  const locateMissing = (route: CsvRoute | undefined): void => {
    if (!route || !locate) return;
    const stars = hasStarColumn(route);
    const missing = route.systems.filter(
      (system, index, all) =>
        (!system.coords || (!stars && system.starClass === undefined)) &&
        all.findIndex((other) => sameSystem(other.name, system.name)) === index,
    );
    if (missing.length === 0) return;
    locate(missing).then(
      (found) => {
        // Another route may have been loaded meanwhile; its own lookup is under way.
        if (tracker.route?.loadedAt === route.loadedAt && found.size > 0) {
          placed((name) => found.get(name.toLowerCase()));
        }
      },
      (error: unknown) => console.error('[csv-route] failed to look up coordinates', error),
    );
  };
  const copyNext = (name: string | undefined): void => {
    if (name === undefined) return;
    copy(name);
    tracker.copied(name);
  };

  reader.onAny((event) => {
    if (event.event !== 'FSDJump' && event.event !== 'CarrierJump' && event.event !== 'Location') {
      return;
    }
    if (typeof event.StarSystem !== 'string') return;
    const arrival = tracker.arrive(event.StarSystem, event.timestamp);
    if (arrival.moved) persist();
    // Being there says where it is, for a system no lookup knew.
    const [x, y, z] = Array.isArray(event.StarPos) ? event.StarPos : [];
    if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number') {
      const system = event.StarSystem;
      placed((name) => (sameSystem(name, system) ? { coords: [x, y, z] } : undefined));
    }
    if (!live) return;
    // Only a jump: the game loading in a route system is no reason to overwrite the clipboard.
    if (event.event !== 'Location') copyNext(arrival.next);
    publish();
  });

  const load = (route: CsvRoute, position?: number): CsvRouteState => {
    copyNext(tracker.load(route, position));
    persist();
    locateMissing(tracker.route);
    return publish();
  };
  const loadText = (text: string, fileName: string, folder?: string): CsvRouteState =>
    load({
      ...parseCsvRoute(text, fileName, new Date().toISOString()),
      ...(folder !== undefined && { folder }),
    });

  ipcMain.handle(IpcChannel.CsvRouteGet, () => state());
  ipcMain.handle(IpcChannel.CsvRouteOpen, async (event): Promise<string | undefined> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const ask: Electron.OpenDialogOptions = {
      title: 'Load a route',
      defaultPath: lastFolder ?? app.getPath('downloads'),
      filters: [
        { name: 'CSV routes', extensions: ['csv'] },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    };
    const picked = await (win ? dialog.showOpenDialog(win, ask) : dialog.showOpenDialog(ask));
    const path = picked.filePaths[0];
    if (picked.canceled || !path) return undefined;
    // Remembered even if the file won't load: the next one is likely beside it.
    lastFolder = dirname(path);
    try {
      loadText(await readFile(path, 'utf8'), basename(path), lastFolder);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  ipcMain.handle(
    IpcChannel.CsvRouteLoad,
    (_event, text: string, fileName: string): string | undefined => {
      try {
        loadText(text, fileName);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  );
  ipcMain.handle(IpcChannel.CsvRouteSetPosition, (_event, position: number | null) => {
    tracker.setPosition(position ?? undefined);
    persist();
    publish();
  });
  ipcMain.handle(IpcChannel.CsvRouteSave, (_event, name: unknown): string | undefined => {
    const route = tracker.route;
    if (!route) return 'There is no route to save.';
    if (!savedRoutes) return "EDSSI's database isn't open, so nothing can be saved.";
    const named = nameOf(name);
    if ('problem' in named) return named.problem;
    // Under a name already taken, this route takes its place.
    const id = savedRoutes.save(named.name, route, tracker.position, new Date().toISOString());
    tracker.keepAs(id);
    persist();
    publish();
    return undefined;
  });
  ipcMain.handle(IpcChannel.CsvRouteLoadSaved, (_event, id: number): string | undefined => {
    if (tracker.route?.savedId === id) return undefined;
    const entry = savedRoutes?.get(id);
    if (!entry) return 'That route is no longer saved.';
    // Jumps made while it was put aside don't move along it; they're from before this load.
    load({ ...entry.route, savedId: id, loadedAt: new Date().toISOString() }, entry.position);
    return undefined;
  });
  ipcMain.handle(
    IpcChannel.CsvRouteRenameSaved,
    (_event, id: number, name: unknown): string | undefined => {
      const named = nameOf(name);
      if ('problem' in named) return named.problem;
      if (!savedRoutes?.rename(id, named.name)) {
        return `A route is saved as ${named.name} already.`;
      }
      publish();
      return undefined;
    },
  );
  ipcMain.handle(IpcChannel.CsvRouteDeleteSaved, (_event, id: number) => {
    savedRoutes?.delete(id);
    if (tracker.route?.savedId === id) {
      tracker.keepAs(undefined);
      persist();
    }
    publish();
  });
  ipcMain.handle(IpcChannel.CsvRouteClear, () => {
    tracker.clear();
    store?.clear();
    publish();
  });

  return {
    markLive() {
      live = true;
      publish();
      // Not before: a lookup can be slow to get going, and can wait until the app is up.
      locateMissing(tracker.route);
    },
    load(route) {
      const { savedId, ...unsaved } = route;
      const entry = savedId === undefined ? undefined : savedRoutes?.get(savedId);
      // Saved before it was followed: the saved copy has what was looked up and how far it got.
      // Not if another route has been saved over it since.
      if (entry && sameStops(entry.route, route)) {
        load({ ...entry.route, savedId, loadedAt: route.loadedAt }, entry.position);
      } else {
        load(unsaved);
      }
    },
    save(name, route) {
      if (!savedRoutes) return { problem: "EDSSI's database isn't open, so nothing can be saved." };
      const named = nameOf(name);
      if ('problem' in named) return named;
      const id = savedRoutes.save(named.name, route, undefined, new Date().toISOString());
      // Saved over the followed route's copy: that one stays loaded, unsaved.
      if (tracker.route?.savedId === id) {
        tracker.keepAs(undefined);
        persist();
      }
      publish();
      return { id };
    },
    state,
  };
}

/** Two routes through the same systems, in the same order. */
function sameStops(a: CsvRoute, b: CsvRoute): boolean {
  return (
    a.systems.length === b.systems.length &&
    a.systems.every((system, index) => sameSystem(system.name, b.systems[index]?.name))
  );
}

/** A name to save a route under, or why it can't be one. */
function nameOf(name: unknown): { name: string } | { problem: string } {
  const trimmed = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (trimmed === '') return { problem: 'Give the route a name.' };
  if (trimmed.length > SAVED_ROUTE_NAME_LENGTH) {
    return { problem: `Keep the name to ${SAVED_ROUTE_NAME_LENGTH} characters.` };
  }
  return { name: trimmed };
}
