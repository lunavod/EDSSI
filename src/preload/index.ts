import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type { ActivityTallies } from '../shared/activity';
import {
  type EdssiApi,
  EXTENSION_CHANNEL_PREFIX,
  type IpcBroadcasts,
  IpcChannel,
  type SettingsView,
} from '../shared/api';
import type { AssistantSnapshot } from '../shared/assistant';
import type { BrowserState } from '../shared/browser';
import type { CarriersSnapshot } from '../shared/carriers';
import type { ShoppingList } from '../shared/commodities';
import type { CsvRouteState } from '../shared/csv-route';
import type { FssOverlayInstallResult, FssOverlayStatus, HudColor } from '../shared/edhm';
import type { SystemExternalInfo } from '../shared/edsm';
import type { HistorySnapshot } from '../shared/history';
import type { CaptureResult, InputSnapshot } from '../shared/input';
import type { JournalSnapshot } from '../shared/journal';
import type { MaterialsSnapshot } from '../shared/materials';
import type { PlottedRoute } from '../shared/nav-routes';
import type { ShipsSnapshot } from '../shared/ships';
import type { SpanshPlotState, SpanshShipChoice } from '../shared/spansh-plot';
import type { TabId } from '../shared/ui';
import type { UpdateState, WhatsNew } from '../shared/updates';
import type { UploadLogEntry, UploadsSnapshot } from '../shared/uploads';
import type { ViewOptions } from '../shared/view-options';

/** Listens to a broadcast channel; returns a function that stops listening. */
function listen<C extends keyof IpcBroadcasts>(
  channel: C,
  listener: (payload: IpcBroadcasts[C]) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, payload: IpcBroadcasts[C]) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: EdssiApi = {
  getVersion: () => ipcRenderer.invoke(IpcChannel.GetVersion),
  updates: {
    getState: (): Promise<UpdateState> => ipcRenderer.invoke(IpcChannel.UpdatesState),
    onChange: (listener) => listen(IpcChannel.UpdatesChanged, listener),
    check: () => ipcRenderer.invoke(IpcChannel.UpdatesCheck),
    install: () => ipcRenderer.invoke(IpcChannel.UpdatesInstall),
    getWhatsNew: (): Promise<WhatsNew> => ipcRenderer.invoke(IpcChannel.UpdatesWhatsNew),
    markSeen: () => ipcRenderer.invoke(IpcChannel.UpdatesSeen),
  },
  journal: {
    getSnapshot: (): Promise<JournalSnapshot> => ipcRenderer.invoke(IpcChannel.JournalSnapshot),
    onMessage: (listener) => listen(IpcChannel.JournalMessage, listener),
  },
  navRoutes: {
    getRecent: (): Promise<PlottedRoute[]> => ipcRenderer.invoke(IpcChannel.NavRoutesRecent),
    onChange: (listener) => listen(IpcChannel.NavRouteChanged, listener),
  },
  csvRoute: {
    get: (): Promise<CsvRouteState> => ipcRenderer.invoke(IpcChannel.CsvRouteGet),
    onChange: (listener) => listen(IpcChannel.CsvRouteChanged, listener),
    open: (): Promise<string | undefined> => ipcRenderer.invoke(IpcChannel.CsvRouteOpen),
    load: (text, fileName): Promise<string | undefined> =>
      ipcRenderer.invoke(IpcChannel.CsvRouteLoad, text, fileName),
    setPosition: (position) => ipcRenderer.invoke(IpcChannel.CsvRouteSetPosition, position),
    clear: () => ipcRenderer.invoke(IpcChannel.CsvRouteClear),
    save: (name): Promise<string | undefined> => ipcRenderer.invoke(IpcChannel.CsvRouteSave, name),
    loadSaved: (id): Promise<string | undefined> =>
      ipcRenderer.invoke(IpcChannel.CsvRouteLoadSaved, id),
    renameSaved: (id, name): Promise<string | undefined> =>
      ipcRenderer.invoke(IpcChannel.CsvRouteRenameSaved, id, name),
    deleteSaved: (id) => ipcRenderer.invoke(IpcChannel.CsvRouteDeleteSaved, id),
  },
  spanshPlot: {
    get: (): Promise<SpanshPlotState> => ipcRenderer.invoke(IpcChannel.SpanshPlotGet),
    onChange: (listener) => listen(IpcChannel.SpanshPlotChanged, listener),
    ships: (): Promise<SpanshShipChoice[]> => ipcRenderer.invoke(IpcChannel.SpanshPlotShips),
    plot: (request): Promise<string | undefined> =>
      ipcRenderer.invoke(IpcChannel.SpanshPlotPlot, request),
    cancel: () => ipcRenderer.invoke(IpcChannel.SpanshPlotCancel),
    follow: (): Promise<boolean> => ipcRenderer.invoke(IpcChannel.SpanshPlotFollow),
    save: (name): Promise<string | undefined> =>
      ipcRenderer.invoke(IpcChannel.SpanshPlotSave, name),
    systems: (prefix): Promise<string[]> =>
      ipcRenderer.invoke(IpcChannel.SpanshPlotSystems, prefix),
  },
  extensions: {
    invoke: (channel, ...args) => ipcRenderer.invoke(EXTENSION_CHANNEL_PREFIX + channel, ...args),
    on: (channel, listener) => {
      const handler = (_event: IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on(EXTENSION_CHANNEL_PREFIX + channel, handler);
      return () => {
        ipcRenderer.removeListener(EXTENSION_CHANNEL_PREFIX + channel, handler);
      };
    },
    installed: () => ipcRenderer.invoke(IpcChannel.ExtensionsInstalled),
  },
  history: {
    getSnapshot: (): Promise<HistorySnapshot> => ipcRenderer.invoke(IpcChannel.HistorySnapshot),
    onChange: (listener) => listen(IpcChannel.HistoryChanged, listener),
  },
  activity: {
    getTallies: (): Promise<ActivityTallies> => ipcRenderer.invoke(IpcChannel.ActivityTallies),
    onChange: (listener) => listen(IpcChannel.ActivityChanged, listener),
  },
  materials: {
    getSnapshot: (): Promise<MaterialsSnapshot> => ipcRenderer.invoke(IpcChannel.MaterialsSnapshot),
    onChange: (listener) => listen(IpcChannel.MaterialsChanged, listener),
    setFavourite: (recipe, favourite) =>
      ipcRenderer.invoke(IpcChannel.MaterialsFavourite, recipe, favourite),
    addTodo: (todo) => ipcRenderer.invoke(IpcChannel.MaterialsTodoAdd, todo),
    addTodos: (todos) => ipcRenderer.invoke(IpcChannel.MaterialsTodoAddMany, todos),
    readBuild: (text, rolls) => ipcRenderer.invoke(IpcChannel.MaterialsReadBuild, text, rolls),
    updateTodo: (todo) => ipcRenderer.invoke(IpcChannel.MaterialsTodoUpdate, todo),
    removeTodo: (id) => ipcRenderer.invoke(IpcChannel.MaterialsTodoRemove, id),
    clearDoneTodos: (kind) => ipcRenderer.invoke(IpcChannel.MaterialsTodoClearDone, kind),
    searchTraders: (request) => ipcRenderer.invoke(IpcChannel.MaterialsTraders, request),
  },
  ships: {
    getSnapshot: (): Promise<ShipsSnapshot> => ipcRenderer.invoke(IpcChannel.ShipsSnapshot),
    onChange: (listener) => listen(IpcChannel.ShipsChanged, listener),
    refreshCatalog: () => ipcRenderer.invoke(IpcChannel.ShipsRefreshCatalog),
    export: (shipId, target) => ipcRenderer.invoke(IpcChannel.ShipsExport, shipId, target),
    stockFit: (ship) => ipcRenderer.invoke(IpcChannel.ShipsStockFit, ship),
  },
  carriers: {
    getSnapshot: (): Promise<CarriersSnapshot> => ipcRenderer.invoke(IpcChannel.CarriersSnapshot),
    onChange: (listener) => listen(IpcChannel.CarriersChanged, listener),
  },
  commodities: {
    getList: (): Promise<ShoppingList> => ipcRenderer.invoke(IpcChannel.CommoditiesList),
    onListChange: (listener) => listen(IpcChannel.CommoditiesListChanged, listener),
    setList: (items) => ipcRenderer.invoke(IpcChannel.CommoditiesSetList, items),
    pickCsv: () => ipcRenderer.invoke(IpcChannel.CommoditiesPickCsv),
    readScreenshots: (images) => ipcRenderer.invoke(IpcChannel.CommoditiesReadScreenshots, images),
    names: (): Promise<string[]> => ipcRenderer.invoke(IpcChannel.CommoditiesNames),
    search: (request) => ipcRenderer.invoke(IpcChannel.CommoditiesSearch, request),
    searchSell: (request) => ipcRenderer.invoke(IpcChannel.CommoditiesSearchSell, request),
    plan: (request) => ipcRenderer.invoke(IpcChannel.CommoditiesPlan, request),
    cancelPlan: () => ipcRenderer.invoke(IpcChannel.CommoditiesPlanCancel),
    sellPlan: (request) => ipcRenderer.invoke(IpcChannel.CommoditiesSellPlan, request),
    cancelSellPlan: () => ipcRenderer.invoke(IpcChannel.CommoditiesSellPlanCancel),
    here: () => ipcRenderer.invoke(IpcChannel.CommoditiesHere),
    getPinned: () => ipcRenderer.invoke(IpcChannel.CommoditiesPinned),
    onPinnedChange: (listener) => listen(IpcChannel.CommoditiesPinnedChanged, listener),
    pin: (pinned) => ipcRenderer.invoke(IpcChannel.CommoditiesPin, pinned),
    onPurchase: (listener) => listen(IpcChannel.CommoditiesPurchase, listener),
  },
  edsm: {
    getSystem: (name): Promise<SystemExternalInfo> =>
      ipcRenderer.invoke(IpcChannel.EdsmSystem, name),
  },
  assistant: {
    getSnapshot: (): Promise<AssistantSnapshot> => ipcRenderer.invoke(IpcChannel.AssistantSnapshot),
    onChange: (listener) => listen(IpcChannel.AssistantChanged, listener),
    ask: (text) => ipcRenderer.invoke(IpcChannel.AssistantAsk, text),
    askByVoice: (audio) => ipcRenderer.invoke(IpcChannel.AssistantVoice, audio),
    cancel: () => ipcRenderer.invoke(IpcChannel.AssistantCancel),
    reset: () => ipcRenderer.invoke(IpcChannel.AssistantReset),
    signIn: () => ipcRenderer.invoke(IpcChannel.AssistantSignIn),
    previewVoice: (preview): Promise<string | undefined> =>
      ipcRenderer.invoke(IpcChannel.AssistantPreviewVoice, preview),
    prepareKokoro: () => ipcRenderer.invoke(IpcChannel.AssistantPrepareKokoro),
    answer: (promptId, answer) => ipcRenderer.invoke(IpcChannel.AssistantAnswer, promptId, answer),
    onSpeech: (listener) => listen(IpcChannel.AssistantSpeech, listener),
    onListen: (listener) => listen(IpcChannel.AssistantListen, listener),
    playback: (utterance, playing) =>
      ipcRenderer.send(IpcChannel.AssistantPlayback, utterance, playing),
  },
  input: {
    getSnapshot: (): Promise<InputSnapshot> => ipcRenderer.invoke(IpcChannel.InputSnapshot),
    onChange: (listener) => listen(IpcChannel.InputChanged, listener),
    capture: (): Promise<CaptureResult | undefined> => ipcRenderer.invoke(IpcChannel.InputCapture),
    cancelCapture: () => ipcRenderer.invoke(IpcChannel.InputCaptureCancel),
  },
  settings: {
    get: (): Promise<SettingsView> => ipcRenderer.invoke(IpcChannel.SettingsGet),
    save: (patch): Promise<SettingsView> => ipcRenderer.invoke(IpcChannel.SettingsSave, patch),
    onChange: (listener) => listen(IpcChannel.SettingsChanged, listener),
    openFile: () => ipcRenderer.invoke(IpcChannel.SettingsOpen),
  },
  edhm: {
    getFssOverlay: (): Promise<FssOverlayStatus> => ipcRenderer.invoke(IpcChannel.EdhmFssStatus),
    installFssOverlay: (): Promise<FssOverlayInstallResult> =>
      ipcRenderer.invoke(IpcChannel.EdhmFssInstall),
    getHudColor: (): Promise<HudColor | null> => ipcRenderer.invoke(IpcChannel.EdhmHudColor),
    onHudColorChange: (listener) => listen(IpcChannel.EdhmHudColorChanged, listener),
  },
  carrierWebhook: {
    test: (draft): Promise<string> => ipcRenderer.invoke(IpcChannel.CarrierWebhookTest, draft),
  },
  uploads: {
    getSnapshot: (): Promise<UploadsSnapshot> => ipcRenderer.invoke(IpcChannel.UploadsSnapshot),
    onChange: (listener) => listen(IpcChannel.UploadsChanged, listener),
    getLog: (limit): Promise<UploadLogEntry[]> => ipcRenderer.invoke(IpcChannel.UploadsLog, limit),
  },
  ui: {
    onCommand: (listener) => listen(IpcChannel.UiCommand, listener),
    setTab: (tab) => ipcRenderer.send(IpcChannel.UiSetTab, tab),
    getTab: (): Promise<TabId> => ipcRenderer.invoke(IpcChannel.UiGetTab),
    onTabChange: (listener) => listen(IpcChannel.UiTabChanged, listener),
  },
  view: {
    get: (): Promise<ViewOptions> => ipcRenderer.invoke(IpcChannel.ViewOptionsGet),
    set: (patch): Promise<ViewOptions> => ipcRenderer.invoke(IpcChannel.ViewOptionsSet, patch),
    onChange: (listener) => listen(IpcChannel.ViewOptionsChanged, listener),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(IpcChannel.ClipboardWrite, text),
  },
  browser: {
    getState: (): Promise<BrowserState> => ipcRenderer.invoke(IpcChannel.BrowserState),
    onChange: (listener) => listen(IpcChannel.BrowserChanged, listener),
    setBounds: (bounds) => ipcRenderer.invoke(IpcChannel.BrowserBounds, bounds),
    navigate: (text) => ipcRenderer.invoke(IpcChannel.BrowserNavigate, text),
    back: () => ipcRenderer.invoke(IpcChannel.BrowserBack),
    forward: () => ipcRenderer.invoke(IpcChannel.BrowserForward),
    reload: () => ipcRenderer.invoke(IpcChannel.BrowserReload),
  },
  window: {
    minimize: () => ipcRenderer.invoke(IpcChannel.WindowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IpcChannel.WindowToggleMaximize),
    close: () => ipcRenderer.invoke(IpcChannel.WindowClose),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IpcChannel.WindowIsMaximized),
    onMaximizedChange: (listener) => listen(IpcChannel.WindowMaximizedChanged, listener),
  },
};

contextBridge.exposeInMainWorld('edssi', api);
