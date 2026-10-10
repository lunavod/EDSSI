import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { app, BrowserWindow, clipboard, ipcMain, screen, session, shell } from 'electron';

import icon from '../../build/icon.png?asset';
import { IpcChannel } from '../shared/api';
import { hullKey } from '../shared/build-import';
import { plottedAlongCsv } from '../shared/followed-route';
import type { PlottedRoute } from '../shared/nav-routes';
import { currentShip } from '../shared/overview';
import { TAB_IDS, type TabId } from '../shared/ui';
import { startActivityService } from './activity-service';
import { startAssistantService } from './ai/service';
import type { Toolset } from './ai/tools/define';
import { broadcast } from './broadcast';
import { Browser } from './browser/browser';
import { ExobiologyCallouts } from './callouts/exobiology';
import { ProbeCallouts } from './callouts/probes';
import { startCarrierAlertService } from './carrier-alert-service';
import { startCarrierDepartureService } from './carrier-departure-service';
import { startCarrierWebhookService } from './carrier-webhook-service';
import { startCarriersService } from './carriers-service';
import { startCommoditiesService } from './commodities-service';
import { openSettings, type SettingsStore } from './config/store';
import { startCsvRouteService } from './csv-route-service';
import { locateSystems, type SystemLocator } from './csv-route/locate';
import { startEdhmService } from './edhm-service';
import { EdsmClient } from './edsm';
import { startEdsmService } from './edsm-service';
import { loadInstalledExtensions, startExtensions } from './extensions';
import { startFlightAlertService } from './flight-alert-service';
import { startHistoryService } from './history-service';
import { startPasteBinding } from './input/paste';
import { startInputService } from './input/service';
import { JournalReader } from './journal';
import { startJournalService } from './journal-service';
import { startMaterialsService } from './materials-service';
import { type NavRouteService, startNavRouteService } from './nav-route-service';
import { personalBestCallout } from './records/personal-bests';
import { routeEdsmCallout } from './route-edsm';
import { startSettingsService } from './settings-service';
import { startShipsService } from './ships-service';
import { startShipCatalog } from './ships/catalog';
import { BodyRecordStore } from './store/body-record-store';
import { CraftingTodoStore } from './store/crafting-todo-store';
import { CsvRouteStore } from './store/csv-route-store';
import { openDatabase } from './store/database';
import { NavRouteStore } from './store/nav-route-store';
import { RecipeFavouriteStore } from './store/recipe-favourite-store';
import { SavedRouteStore } from './store/saved-route-store';
import { PinnedPlanStore, ShoppingListStore } from './store/shopping-list-store';
import { UploadCursorStore } from './store/upload-cursor-store';
import { UploadLogStore } from './store/upload-log-store';
import { surface } from './surface';
import { installPendingUpdate, startUpdateService } from './update-service';
import { startUploadService } from './upload-service';
import { startViewOptionsService, ViewOptionsStore } from './view-options-service';
import { startVrOverlayService, vrCapturing, type VrOverlayService } from './vr-overlay-service';
import { startVrGate } from './vr/gate';
import { runningProcesses } from './vr/processes';
import { loadBounds, placeOnDisplay, rememberBounds } from './window-bounds';
import { reportMaximized, startWindowControls } from './window-controls';

// A data folder of its own (a test run's) holds the window's storage and caches as well as the
// database: without this, a second EDSSI shares the real one's browser profile, remembered pages
// and all. It has to be set before the app is ready.
const dataDirOverride = process.env['EDSSI_DATA_DIR'];
if (dataDirOverride) app.setPath('userData', dataDirOverride);

function createWindow(settings: SettingsStore, browser: Browser): void {
  const saved = loadBounds();
  // A display that has since been unplugged would strand the window off-screen; when none of the
  // connected ones can show it, fall back to the default size and let Windows place it.
  const bounds = saved && placeOnDisplay(saved, screen.getAllDisplays());

  const win = new BrowserWindow({
    // The first run's size; after that, wherever the commander left it.
    width: bounds?.width ?? 1700,
    height: bounds?.height ?? 1100,
    ...(bounds && { x: bounds.x, y: bounds.y }),
    show: false,
    // The HUD header is the title bar; see window-controls.ts.
    frame: false,
    backgroundColor: '#0b0b0f',
    title: 'EDSSI',
    // A packaged EDSSI shows the exe's icon instead; this one is for running from source.
    icon,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
    },
  });

  if (saved?.maximized) win.maximize();
  reportMaximized(win);
  browser.attach(win);
  rememberBounds(win, (rect) => screen.getDisplayMatching(rect));

  // The app is imported only once the installed extensions are loaded (main.tsx), so a built
  // window's first paint is the empty page, after which Chromium stops painting it while hidden
  // and `ready-to-show` never comes. Once the page has loaded will do: its background is the
  // window's own colour, and the app paints a moment later.
  const show = () => {
    if (!win.isVisible()) win.show();
  };
  win.once('ready-to-show', show);
  win.webContents.once('did-finish-load', show);
  // The VR panels are offscreen windows of their own, so `window-all-closed` won't fire while they
  // are up: closing the HUD has to end the app itself, or EDSSI would go on running unseen.
  win.on('closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  // Chromium resets the zoom when the page loads (and on a dev reload), so apply it each time.
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(settings.current().display.zoom);
  });

  // Open external links in the default browser instead of a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

/**
 * Follows the journal for the app's lifetime, feeding every service before the backfill starts.
 * The session view replays only the current game session; the history replays every journal.
 */
function startServices(browser: Browser): SettingsStore {
  const reader = new JournalReader({ backfill: 'session' });
  const historyReader = new JournalReader({ backfill: 'all' });
  for (const journal of [reader, historyReader]) {
    journal.onError((error) => console.error('[journal]', error));
  }
  const journal = startJournalService(reader, historyReader);
  const activity = startActivityService(historyReader);
  const edsm = new EdsmClient();
  startEdsmService(edsm);

  let db: DatabaseSync | undefined;
  let navRoutes: NavRouteService | undefined;
  /** Set once the assistant is up; routes are only looked up live after that. */
  let onRouteChecked: ((route: PlottedRoute) => void) | undefined;
  let uploadCursors: UploadCursorStore | undefined;
  let uploadLog: UploadLogStore | undefined;
  let favourites: RecipeFavouriteStore | undefined;
  let craftingTodos: CraftingTodoStore | undefined;
  let bodyRecords: BodyRecordStore | undefined;
  let csvRoutes: CsvRouteStore | undefined;
  let savedRoutes: SavedRouteStore | undefined;
  let shoppingList: ShoppingListStore | undefined;
  let pinnedPlan: PinnedPlanStore | undefined;
  try {
    const dataDir = process.env['EDSSI_DATA_DIR'] ?? app.getPath('userData');
    mkdirSync(dataDir, { recursive: true });
    db = openDatabase(join(dataDir, 'edssi.db'));
    // Every journal, so plots from sessions EDSSI wasn't running for are recorded too.
    navRoutes = startNavRouteService(historyReader, new NavRouteStore(db), {
      edsm,
      onChecked: (route) => onRouteChecked?.(route),
    });
    uploadCursors = new UploadCursorStore(db);
    uploadLog = new UploadLogStore(db);
    favourites = new RecipeFavouriteStore(db);
    craftingTodos = new CraftingTodoStore(db);
    bodyRecords = new BodyRecordStore(db);
    csvRoutes = new CsvRouteStore(db);
    savedRoutes = new SavedRouteStore(db);
    shoppingList = new ShoppingListStore(db);
    pinnedPlan = new PinnedPlanStore(db);
  } catch (error) {
    // The journal is still worth showing without EDSSI's own records.
    console.error('[store] failed to open the database', error);
  }

  const history = startHistoryService(historyReader, bodyRecords);
  /** What the extensions add to finding a CSV route's systems. */
  const locators: SystemLocator[] = [];
  // The session reader: only jumps made now put the next system on the clipboard.
  const csvRoute = startCsvRouteService(reader, {
    store: csvRoutes,
    saved: savedRoutes,
    copy: (text) => void clipboard.writeText(text),
    // The extensions come up below; nothing is looked up before the session has been replayed.
    locate: (systems) =>
      locateSystems(systems, { locators, edsm: (names) => edsm.coordinates(names) }),
  });
  // EDSY's slot tables, cached beside the database; they don't need the database itself.
  const shipCatalog = startShipCatalog({
    dir: process.env['EDSSI_DATA_DIR'] ?? app.getPath('userData'),
  });
  const ships = startShipsService(historyReader, shipCatalog);
  const carriers = startCarriersService(historyReader, {
    coordinates: (names) => edsm.coordinates(names),
  });
  const materials = startMaterialsService(historyReader, {
    favourites,
    todos: craftingTodos,
    here: () => journal.snapshot().overview.system,
    hullName: (ship) => ships.hulls().find((hull) => hullKey(hull.ship) === hullKey(ship))?.type,
  });
  // The session reader: only purchases made now count as bought.
  const commodities = startCommoditiesService(reader, {
    store: shoppingList,
    pinnedStore: pinnedPlan,
    here: () => journal.snapshot().overview.system,
    look: () => assistant?.look,
  });

  const settings = openSettings();
  const settingsService = startSettingsService(settings);
  const viewOptions = new ViewOptionsStore();
  const viewOptionsService = startViewOptionsService(viewOptions);
  /** Set once the assistant is up: what the extensions tell the commander goes through it. */
  let notifyFromExtension: ((text: string) => void) | undefined;
  const extensionToolsets: Toolset[] = [];
  const extensions = startExtensions({
    settings,
    here: () => journal.snapshot().overview.system,
    ship: () => currentShip(journal.snapshot().events),
    ships: () => ships.owned(),
    followRoute: (route) => csvRoute.load(route),
    saveRoute: (name, route) => csvRoute.save(name, route),
    notify: (text) => notifyFromExtension?.(text),
    addSystemLocator: (locator) => locators.push(locator),
    addToolset: (toolset) => extensionToolsets.push(toolset),
  });
  const edhm = startEdhmService(settings);
  // The VR panels are drawn for a headset rather than a monitor, and size their own type; the
  // window's zoom is not their business.
  let vrService: VrOverlayService | undefined;
  settings.onChange(({ display }) => {
    const vrWindows = vrService?.windows() ?? [];
    for (const win of BrowserWindow.getAllWindows()) {
      if (!vrWindows.includes(win)) win.webContents.setZoomFactor(display.zoom);
    }
  });
  // The session reader, not the history one: only what is being played now is sent.
  const uploads = startUploadService({
    reader,
    journal,
    settings,
    cursors: uploadCursors,
    log: uploadLog,
  });
  // Push-to-talk is its own service: it outlives a question, and the settings screen talks to it
  // whether or not the assistant itself can run.
  const input = startInputService({
    bindings: settings.current().voice.push_to_talk,
    holdToTalk: settings.current().voice.hold_to_talk,
    multiClickMs: settings.current().input.multi_click_ms,
    onListen: (action) => broadcast(IpcChannel.AssistantListen, action),
  });
  // Ctrl+V on a stick button, for pasting the route's next system into the galaxy map.
  const paste = startPasteBinding({ input, settings });
  // A prototype, off unless vr.enabled: five panels of EDSSI hung around the commander as SteamVR
  // overlays, moved about with the keys in vr-overlay-service.ts. Only up while SteamVR and the game
  // are both running; capturing panels for the preview runs it at once.
  const startVr = () => startVrOverlayService({ input, edhm, settings });
  let vr: { stop(): void };
  if (vrCapturing()) vr = vrService = startVr();
  else {
    vr = startVrGate({
      enabled: () => settings.current().vr.enabled,
      onEnabledChange: (listener) => settings.onChange((next) => listener(next.vr.enabled)),
      running: runningProcesses,
      start: startVr,
      onChange: (service) => (vrService = service),
    });
  }

  const assistant = startAssistantService({
    settings,
    input,
    browser,
    dataDir: process.env['EDSSI_DATA_DIR'] ?? app.getPath('userData'),
    // Built beside this file (electron.vite.config.ts); onnxruntime only ever loads in there.
    kokoroWorker: join(import.meta.dirname, 'kokoro-worker.js'),
    toolsets: extensionToolsets,
    game: {
      session: () => journal.snapshot(),
      overview: () => journal.snapshot().overview,
      history: () => history.snapshot(),
      carriers: () => carriers.snapshot(),
      activity: () => activity.snapshot(),
      routes: () => navRoutes?.recent() ?? [],
      csvRoute: () => csvRoute.state(),
      settings: () => settings.current(),
      system: (name) => edsm.system(name),
    },
    app: {
      openTab: (tab) => broadcast(IpcChannel.UiCommand, { type: 'open-tab', tab }),
      surface,
      acknowledge: () => broadcast(IpcChannel.UiCommand, { type: 'acknowledge' }),
      copy: (text) => clipboard.writeText(text),
      viewOptions: () => viewOptions.current(),
      setViewOptions: (patch) => viewOptions.set(patch),
    },
  });

  notifyFromExtension = (text) => assistant.notify(text);

  const callouts = new ExobiologyCallouts();
  const probeCallouts = new ProbeCallouts();
  history.onLiveEvent((event, snapshot) => {
    const current = settings.current();
    if (current.voice.speech.exobiology_callouts) {
      const line = callouts.after(event, () => snapshot().survey);
      if (line) assistant.announce(line);
    }
    if (current.voice.speech.probe_callouts) {
      const line = probeCallouts.after(
        event,
        () => snapshot().survey,
        current.mission.min_probe_value,
      );
      if (line) assistant.announce(line);
    }
  });
  onRouteChecked = (route) => {
    if (!settings.current().voice.speech.route_callouts || !route.systems || !route.edsm) return;
    // A stretch of the CSV route, plotted to reach its next system: nothing new to say about it.
    if (plottedAlongCsv(route, csvRoute.state()) !== undefined) return;
    const line = routeEdsmCallout(route.systems, route.edsm);
    if (line) assistant.notify(line);
  };
  history.onPersonalBest((broken, systemName) => {
    if (!settings.current().voice.speech.personal_best_callouts) return;
    assistant.notify(personalBestCallout(broken, systemName));
  });

  const carrierAlert = startCarrierAlertService({
    reader,
    settings,
    notify: (text) => assistant.notify(text),
  });
  const carrierWebhook = startCarrierWebhookService({ reader, historyReader, settings });
  const carrierDeparture = startCarrierDepartureService({
    reader,
    settings,
    notify: (text) => assistant.notify(text),
  });
  const flightAlert = startFlightAlertService({
    reader,
    settings,
    routes: () => navRoutes?.recent() ?? [],
    csvRoute: () => csvRoute.state(),
    survey: () => history.snapshot().survey,
    edsm,
    notify: (text) => assistant.notify(text),
  });

  app.on('before-quit', () => {
    vr.stop();
    extensions.stop();
    carrierAlert.stop();
    carrierWebhook.stop();
    carrierDeparture.stop();
    shipCatalog.stop();
    flightAlert.stop();
    assistant.stop();
    uploads.stop();
    paste.stop();
    input.stop();
    settingsService.stop();
    viewOptionsService.stop();
    edhm.stop();
    settings.stop();
    void Promise.all([reader.stop(), historyReader.stop()]).finally(() => db?.close());
  });
  reader
    .start()
    .then(() => {
      csvRoute.markLive();
      commodities.markLive();
      carrierAlert.markLive();
      carrierWebhook.markLive();
      flightAlert.markLive();
    })
    .catch((error: unknown) => console.error('[journal] failed to start', error));
  historyReader
    .start()
    .then(() => {
      journal.publishHistoryOverview();
      history.markReady();
      navRoutes?.markLive();
      activity.markReady();
      materials.markReady();
      ships.markReady();
      carriers.markReady();
    })
    .catch((error: unknown) => console.error('[history] failed to start', error));
  return settings;
}

ipcMain.handle(IpcChannel.GetVersion, () => app.getVersion());
// The window is sandboxed and served from a file, so navigator.clipboard is no use to it.
ipcMain.handle(IpcChannel.ClipboardWrite, (_event, text: string) => {
  // Electron types this as returning a promise on some platforms; there is nothing to wait for.
  void clipboard.writeText(text);
});
// The tab the window is showing. The VR cockpit's main panel follows it, so it has to live here:
// the panels are windows of their own and can't see the window's state.
let windowTab: TabId = 'mission';
ipcMain.on(IpcChannel.UiSetTab, (_event, tab: unknown) => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked against the list
  if (!TAB_IDS.includes(tab as TabId) || tab === windowTab) return;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked just above
  windowTab = tab as TabId;
  broadcast(IpcChannel.UiTabChanged, windowTab);
});
ipcMain.handle(IpcChannel.UiGetTab, () => windowTab);
startWindowControls();

// Answers are spoken without anyone touching the window — the commander is in the game.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

void app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.edssi.app');

  // Before anything else: the services start processes of their own (Kokoro's worker,
  // whisper-server, the VR host), and the installer can't replace files while they hold them.
  const dataDir = process.env['EDSSI_DATA_DIR'] ?? app.getPath('userData');
  mkdirSync(dataDir, { recursive: true });
  if (await installPendingUpdate(dataDir)) return;
  const updates = startUpdateService({ dataDir });
  app.on('before-quit', () => updates.stop());

  // The window only ever asks for the microphone, and only EDSSI's own pages are loaded in it.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media');
  });

  // Before the settings file is read: they add sections of their own to it.
  await loadInstalledExtensions();
  const browser = new Browser();
  const settings = startServices(browser);
  createWindow(settings, browser);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(settings, browser);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
