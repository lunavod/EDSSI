import type { ActivityTallies } from './activity';
import type { AssistantSnapshot, RecordedAudio, SpeechChunk, VoicePreview } from './assistant';
import type { BrowserBounds, BrowserState } from './browser';
import type { PlannedBuild } from './build-import';
import type { CarriersSnapshot } from './carriers';
import type {
  CommoditySearchRequest,
  CommoditySearchResult,
  CommoditySellRequest,
  CommoditySellResult,
  GamePurchase,
  PinnedPlan,
  PlanRequest,
  PlanResult,
  SellPlanRequest,
  ShoppingItem,
  ShoppingList,
  ShoppingNeed,
  SystemMarkets,
} from './commodities';
import type {
  CraftingTodo,
  NewCraftingTodo,
  TraderSearchRequest,
  TraderSearchResult,
} from './crafting';
import type { CsvRouteState } from './csv-route';
import type { FssOverlayInstallResult, FssOverlayStatus, HudColor } from './edhm';
import type { SystemExternalInfo } from './edsm';
import type { InstalledRendererExtension } from './extensions';
import type { HistorySnapshot } from './history';
import type { CaptureResult, InputSnapshot } from './input';
import type { JournalMessage, JournalSnapshot } from './journal';
import type { MaterialsSnapshot } from './materials';
import type { PlottedRoute } from './nav-routes';
import type { PromptAnswer } from './prompts';
import type { CarrierWebhookSettings, Settings, SettingsPatch } from './settings';
import type { ShipExportTarget, ShipsSnapshot, StockFit } from './ships';
import type { SpanshPlotRequest, SpanshPlotState, SpanshShipChoice } from './spansh-plot';
import type { TabId, UiCommand } from './ui';
import type { UpdateState, WhatsNew } from './updates';
import type { UploadLogEntry, UploadsSnapshot } from './uploads';
import type { ViewOptions, ViewOptionsPatch } from './view-options';

/** API exposed by the preload script on `window.edssi`. */
export interface EdssiApi {
  getVersion(): Promise<string>;
  updates: {
    /** What the updater is doing. */
    getState(): Promise<UpdateState>;
    /** Subscribes to it changing. Returns an unsubscribe function. */
    onChange(listener: (state: UpdateState) => void): () => void;
    /** Asks the update server now rather than at the next half-hourly look. */
    check(): Promise<void>;
    /** Quits, installs the downloaded update and starts EDSSI again. */
    install(): Promise<void>;
    /** The release notes: what is new since they were last shown, and every version's. */
    getWhatsNew(): Promise<WhatsNew>;
    /** The new notes have been shown; they aren't again. */
    markSeen(): Promise<void>;
  };
  journal: {
    /** The current game session so far. Messages with `seq` ≤ `snapshot.seq` are included in it. */
    getSnapshot(): Promise<JournalSnapshot>;
    /** Subscribes to live journal messages. Returns an unsubscribe function. */
    onMessage(listener: (message: JournalMessage) => void): () => void;
  };
  navRoutes: {
    /** Routes that may apply to the current session: the one in effect when it began, and every one plotted since. Oldest first. */
    getRecent(): Promise<PlottedRoute[]>;
    /** Subscribes to routes being recorded or updated (e.g. cleared). Returns an unsubscribe function. */
    onChange(listener: (route: PlottedRoute) => void): () => void;
  };
  csvRoute: {
    /** The route loaded from a CSV file, and where the commander is on it. */
    get(): Promise<CsvRouteState>;
    /** Subscribes to it changing. Returns an unsubscribe function. */
    onChange(listener: (state: CsvRouteState) => void): () => void;
    /** Asks for a CSV file and loads it. Resolves with why it couldn't be read, if it couldn't. */
    open(): Promise<string | undefined>;
    /** Loads CSV text dropped on the window. Resolves with why it couldn't be read, if it couldn't. */
    load(text: string, fileName: string): Promise<string | undefined>;
    /** Sets the route system last reached by hand; null for none yet. */
    setPosition(position: number | null): Promise<void>;
    /** Forgets the route; a saved one stays saved. */
    clear(): Promise<void>;
    /**
     * Saves the route under a name, replacing any route saved under it; from then on the saved
     * copy follows it. Resolves with why it couldn't be saved, if it couldn't.
     */
    save(name: string): Promise<string | undefined>;
    /** Follows a saved route from where it was left. Resolves with why not, if it can't. */
    loadSaved(id: number): Promise<string | undefined>;
    /** Resolves with why it couldn't be renamed (the name is taken), if it couldn't. */
    renameSaved(id: number, name: string): Promise<string | undefined>;
    /** Forgets a saved route; if it is the one loaded, it stays loaded, unsaved. */
    deleteSaved(id: number): Promise<void>;
  };
  spanshPlot: {
    /** The plot under way on the Route tab's Spansh page, and the last route plotted. */
    get(): Promise<SpanshPlotState>;
    /** Subscribes to it changing. Returns an unsubscribe function. */
    onChange(listener: (state: SpanshPlotState) => void): () => void;
    /** Every ship the commander owns, the one being flown first, to plot for. */
    ships(): Promise<SpanshShipChoice[]>;
    /** Plots a route, kept as the `result`. Resolves with why it failed (`cancelled` when stopped). */
    plot(request: SpanshPlotRequest): Promise<string | undefined>;
    /** Stops the plot under way. */
    cancel(): Promise<void>;
    /** Makes the last route plotted the CSV route followed; false if there is none. */
    follow(): Promise<boolean>;
    /** Saves the last route plotted under a name. Resolves with why it couldn't, if it couldn't. */
    save(name: string): Promise<string | undefined>;
    /** Names of systems Spansh knows starting like `prefix`, best match first. */
    systems(prefix: string): Promise<string[]>;
  };
  extensions: {
    /** Asks the main process side of an extension (`src/main/extensions.ts`). */
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    /** Subscribes to what an extension broadcasts. Returns an unsubscribe function. */
    on(channel: string, listener: (payload: unknown) => void): () => void;
    /** The installed extensions' window sides (`src/shared/extensions.ts`), to load. */
    installed(): Promise<InstalledRendererExtension[]>;
  };
  history: {
    /** The ledger and current system survey, worked out from every journal. */
    getSnapshot(): Promise<HistorySnapshot>;
    /** Subscribes to newer snapshots. Returns an unsubscribe function. */
    onChange(listener: (snapshot: HistorySnapshot) => void): () => void;
  };
  activity: {
    /** What this game session and this trip have made so far, for the Mission tab's strip. */
    getTallies(): Promise<ActivityTallies>;
    /** Subscribes to newer tallies. Returns an unsubscribe function. */
    onChange(listener: (tallies: ActivityTallies) => void): () => void;
  };
  materials: {
    /** What the commander carries to craft with, what they have crafted, and their favourite recipes. */
    getSnapshot(): Promise<MaterialsSnapshot>;
    /** Subscribes to newer snapshots. Returns an unsubscribe function. */
    onChange(listener: (snapshot: MaterialsSnapshot) => void): () => void;
    /** Marks a recipe as a favourite, or not. */
    setFavourite(recipe: string, favourite: boolean): Promise<void>;
    /** Adds a blueprint or synthesis to its to-do list, at the end. */
    addTodo(todo: NewCraftingTodo): Promise<void>;
    /** Adds several at once, in order. */
    addTodos(todos: NewCraftingTodo[]): Promise<void>;
    /**
     * Reads a ship build pasted from EDSY or Coriolis (SLEF, a `Loadout`, Coriolis' detailed
     * build, or an import link) into the blueprints it wants, less what the commander's own ship
     * of that type has.
     */
    readBuild(text: string, rolls: number | 'max'): Promise<Outcome<PlannedBuild[]>>;
    /** Replaces a to-do, found by its id. */
    updateTodo(todo: CraftingTodo): Promise<void>;
    removeTodo(id: string): Promise<void>;
    /** Takes off every to-do of that kind with nothing left to make. */
    clearDoneTodos(kind: CraftingTodo['kind']): Promise<void>;
    /** Stations with a material trader, from Spansh, nearest first. */
    searchTraders(request: TraderSearchRequest): Promise<Outcome<TraderSearchResult>>;
  };
  ships: {
    /** Every ship the commander owns, slot by slot, and how EDSY's slot tables stand. */
    getSnapshot(): Promise<ShipsSnapshot>;
    /** Subscribes to newer snapshots. Returns an unsubscribe function. */
    onChange(listener: (snapshot: ShipsSnapshot) => void): () => void;
    /** Asks EDSY for a newer database now; the snapshot that follows says how it went. */
    refreshCatalog(): Promise<void>;
    /**
     * Opens a ship's last loadout in EDSY or Coriolis, or asks where to save a CSV of its slots.
     * Resolves with why it couldn't, if it couldn't.
     */
    export(shipId: number, target: ShipExportTarget): Promise<string | undefined>;
    /** A hull as the shipyard sells it, by the journal's ship name; undefined if EDSY lacks it. */
    stockFit(ship: string): Promise<StockFit | undefined>;
  };
  carriers: {
    /** The commander's own carrier and their squadron's: where, fuel, space and cargo. */
    getSnapshot(): Promise<CarriersSnapshot>;
    /** Subscribes to newer snapshots. Returns an unsubscribe function. */
    onChange(listener: (snapshot: CarriersSnapshot) => void): () => void;
  };
  commodities: {
    /** The shopping list. */
    getList(): Promise<ShoppingList>;
    /** Subscribes to it changing, from the window or a purchase in the game. */
    onListChange(listener: (list: ShoppingList) => void): () => void;
    /** Replaces the list. */
    setList(items: ShoppingItem[]): Promise<void>;
    /**
     * Asks for a CSV of commodities and quantities and reads it; undefined if none was picked.
     * Nothing is changed until the window says whether to replace the list or add to it.
     */
    pickCsv(): Promise<Outcome<{ needs: ShoppingNeed[]; fileName: string }> | undefined>;
    /**
     * Reads the commodities and tonnes still needed off screenshots (data URLs) of the game's
     * colonisation panel, with the assistant's model. Changes nothing, as `pickCsv` doesn't.
     */
    readScreenshots(images: string[]): Promise<Outcome<ShoppingNeed[]>>;
    /** Every commodity name the markets use, for suggestions. */
    names(): Promise<string[]>;
    /** One page of markets selling every commodity asked for. */
    search(request: CommoditySearchRequest): Promise<Outcome<CommoditySearchResult>>;
    /** One page of markets buying every commodity asked for. */
    searchSell(request: CommoditySellRequest): Promise<Outcome<CommoditySellResult>>;
    /** Ways to buy what the shopping list is still missing. `cancelled` if another began. */
    plan(request: PlanRequest): Promise<Outcome<PlanResult>>;
    cancelPlan(): Promise<void>;
    /** Ways to sell commodities across several markets. `cancelled` if another began. */
    sellPlan(request: SellPlanRequest): Promise<Outcome<PlanResult>>;
    cancelSellPlan(): Promise<void>;
    /** The plan pinned on the Plan page, or null. */
    getPinned(): Promise<PinnedPlan | null>;
    /** Subscribes to it changing, from the window or a purchase along it. */
    onPinnedChange(listener: (pinned: PinnedPlan | null) => void): () => void;
    /** Each purchase made in the game, live. Returns an unsubscribe function. */
    onPurchase(listener: (purchase: GamePurchase) => void): () => void;
    /** Pins a plan in place of any pinned before; null unpins. */
    pin(pinned: PinnedPlan | null): Promise<void>;
    /** The markets in the current system selling anything on the list; looked up when asked. */
    here(): Promise<Outcome<SystemMarkets>>;
  };
  edsm: {
    /** What EDSM knows about a system; resolves even when EDSM can't be reached. */
    getSystem(name: string): Promise<SystemExternalInfo>;
  };
  assistant: {
    /** The conversation so far and what the assistant is doing. */
    getSnapshot(): Promise<AssistantSnapshot>;
    /** Subscribes to newer snapshots. Returns an unsubscribe function. */
    onChange(listener: (snapshot: AssistantSnapshot) => void): () => void;
    /** Asks a question. Resolves as soon as it has been taken, not when it is answered. */
    ask(text: string): Promise<void>;
    /** Sends recorded audio to be transcribed and answered. */
    askByVoice(audio: RecordedAudio): Promise<void>;
    /** Stops whatever is in flight, including anything being spoken. */
    cancel(): Promise<void>;
    /** Forgets the conversation and starts a new one. */
    reset(): Promise<void>;
    /** Signs in to ChatGPT in the default browser (the `codex` provider). */
    signIn(): Promise<void>;
    /**
     * Reads a line aloud in the voice described, cutting off whatever is being said. Resolves
     * once it has started, with why it couldn't, if it couldn't (Kokoro still downloading, no key).
     */
    previewVoice(preview: VoicePreview): Promise<string | undefined>;
    /** Starts Kokoro's voice loading (downloading, the first time), so a preview needn't wait. */
    prepareKokoro(): Promise<void>;
    /** Answers the prompt the assistant is waiting on; ignored if it has moved on since. */
    answer(promptId: number, answer: PromptAnswer): Promise<void>;
    /** The answer being spoken, as raw PCM. Returns an unsubscribe function. */
    onSpeech(listener: (chunk: SpeechChunk) => void): () => void;
    /** Open the microphone, or close it and send. Follows the push-to-talk bindings. */
    onListen(listener: (action: ListenAction) => void): () => void;
    /**
     * Whether this window is still playing an answer out loud.
     *
     * Speech is generated faster than it is spoken, so the main process knows when it has sent the
     * last of an answer but not when the commander has finished hearing it — and "Speaking…" is
     * meant to mean the latter. Only the window that owns the audio reports this.
     */
    playback(utterance: number, playing: boolean): void;
  };
  input: {
    /** The sticks EDSSI can see, which bindings are held, and whether a capture is running. */
    getSnapshot(): Promise<InputSnapshot>;
    /** Subscribes to newer snapshots. Returns an unsubscribe function. */
    onChange(listener: (snapshot: InputSnapshot) => void): () => void;
    /**
     * Waits for the commander to press a key or a stick button, and answers with what it was.
     * Resolves with nothing if the capture is cancelled.
     */
    capture(): Promise<CaptureResult | undefined>;
    /** Gives up on a capture in progress. */
    cancelCapture(): Promise<void>;
  };
  settings: {
    /** The settings as EDSSI is running them, plus where they came from. */
    get(): Promise<SettingsView>;
    /** Writes the given fields back to the settings file, leaving the rest of it alone. */
    save(patch: SettingsPatch): Promise<SettingsView>;
    /** Subscribes to the file changing, however it changed. Returns an unsubscribe function. */
    onChange(listener: (view: SettingsView) => void): () => void;
    /** Opens the settings file in whatever the system uses for it. */
    openFile(): Promise<void>;
  };
  edhm: {
    /** Whether EDHM is installed, and where the FSS Exobio Overlay stands. */
    getFssOverlay(): Promise<FssOverlayStatus>;
    /**
     * Installs the FSS Exobio Overlay, downloading the FSS-Overlay mod for its shaders if needed
     * and parking any mod hooking the same shaders. Rejects if EDHM isn't installed.
     */
    installFssOverlay(): Promise<FssOverlayInstallResult>;
    /** The EDHM theme's colour to draw EDSSI in; null when there's none or matching is off. */
    getHudColor(): Promise<HudColor | null>;
    /** Subscribes to that colour changing. Returns an unsubscribe function. */
    onHudColorChange(listener: (color: HudColor | null) => void): () => void;
  };
  carrierWebhook: {
    /**
     * Posts the plugin's test embed with these values over the saved ones: "Success",
     * "Missing Webhook URL", or "Error: …".
     */
    test(draft: Partial<CarrierWebhookSettings>): Promise<string>;
  };
  uploads: {
    /** Whether the journal is reaching EDSM and Inara. */
    getSnapshot(): Promise<UploadsSnapshot>;
    /** Subscribes to newer snapshots. Returns an unsubscribe function. */
    onChange(listener: (snapshot: UploadsSnapshot) => void): () => void;
    /** The latest requests to EDSM and Inara, newest first. */
    getLog(limit: number): Promise<UploadLogEntry[]>;
  };
  ui: {
    /** Something the assistant asked the window to do. Returns an unsubscribe function. */
    onCommand(listener: (command: UiCommand) => void): () => void;
    /** Says which tab the window is showing, for the VR cockpit to follow. */
    setTab(tab: TabId): void;
    /** The tab the window is showing ('mission' until it has said). */
    getTab(): Promise<TabId>;
    /** Subscribes to the window showing another tab. Returns an unsubscribe function. */
    onTabChange(listener: (tab: TabId) => void): () => void;
  };
  view: {
    /** How the views are sorted and what they show, shared by every window. */
    get(): Promise<ViewOptions>;
    /** Changes some of them; values that aren't valid are ignored. Resolves with them all. */
    set(patch: ViewOptionsPatch): Promise<ViewOptions>;
    /** Subscribes to them changing, from any window or the assistant. */
    onChange(listener: (options: ViewOptions) => void): () => void;
  };
  clipboard: {
    /** Puts text on the system clipboard, for the commander to paste into the game. */
    writeText(text: string): Promise<void>;
  };
  browser: {
    /** The page the assistant's browser is on. */
    getState(): Promise<BrowserState>;
    /** Subscribes to page changes. Returns an unsubscribe function. */
    onChange(listener: (state: BrowserState) => void): () => void;
    /** Where the Browser tab's frame is, so the page can be laid over it; null hides the page. */
    setBounds(bounds: BrowserBounds): Promise<void>;
    /** Loads what the commander typed: an address, or words to search for. */
    navigate(text: string): Promise<void>;
    back(): Promise<void>;
    forward(): Promise<void>;
    reload(): Promise<void>;
  };
  window: {
    minimize(): Promise<void>;
    /** Maximizes the window, or restores it if it already is. */
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    /** Subscribes to the window being maximized or restored. Returns an unsubscribe function. */
    onMaximizedChange(listener: (maximized: boolean) => void): () => void;
  };
}

/** What an extension's channels are prefixed with, so they can't collide with EDSSI's own. */
export const EXTENSION_CHANNEL_PREFIX = 'ext:';

export const IpcChannel = {
  GetVersion: 'app:get-version',
  UpdatesState: 'updates:state',
  UpdatesChanged: 'updates:changed',
  UpdatesCheck: 'updates:check',
  UpdatesInstall: 'updates:install',
  UpdatesWhatsNew: 'updates:whats-new',
  UpdatesSeen: 'updates:seen',
  JournalSnapshot: 'journal:snapshot',
  JournalMessage: 'journal:message',
  NavRoutesRecent: 'nav-routes:recent',
  NavRouteChanged: 'nav-routes:changed',
  ExtensionsInstalled: 'extensions:installed',
  CsvRouteGet: 'csv-route:get',
  CsvRouteChanged: 'csv-route:changed',
  CsvRouteOpen: 'csv-route:open',
  CsvRouteLoad: 'csv-route:load',
  CsvRouteSetPosition: 'csv-route:set-position',
  CsvRouteClear: 'csv-route:clear',
  CsvRouteSave: 'csv-route:save',
  CsvRouteLoadSaved: 'csv-route:load-saved',
  CsvRouteRenameSaved: 'csv-route:rename-saved',
  CsvRouteDeleteSaved: 'csv-route:delete-saved',
  SpanshPlotGet: 'spansh-plot:get',
  SpanshPlotChanged: 'spansh-plot:changed',
  SpanshPlotShips: 'spansh-plot:ships',
  SpanshPlotPlot: 'spansh-plot:plot',
  SpanshPlotCancel: 'spansh-plot:cancel',
  SpanshPlotFollow: 'spansh-plot:follow',
  SpanshPlotSave: 'spansh-plot:save',
  SpanshPlotSystems: 'spansh-plot:systems',
  HistorySnapshot: 'history:snapshot',
  HistoryChanged: 'history:changed',
  ActivityTallies: 'activity:tallies',
  ActivityChanged: 'activity:changed',
  MaterialsSnapshot: 'materials:snapshot',
  MaterialsChanged: 'materials:changed',
  MaterialsFavourite: 'materials:favourite',
  MaterialsTodoAdd: 'materials:todo-add',
  MaterialsTodoAddMany: 'materials:todo-add-many',
  MaterialsReadBuild: 'materials:read-build',
  MaterialsTodoUpdate: 'materials:todo-update',
  MaterialsTodoRemove: 'materials:todo-remove',
  MaterialsTodoClearDone: 'materials:todo-clear-done',
  MaterialsTraders: 'materials:traders',
  ShipsSnapshot: 'ships:snapshot',
  ShipsChanged: 'ships:changed',
  ShipsRefreshCatalog: 'ships:refresh-catalog',
  ShipsExport: 'ships:export',
  ShipsStockFit: 'ships:stock-fit',
  CarriersSnapshot: 'carriers:snapshot',
  CarriersChanged: 'carriers:changed',
  CommoditiesList: 'commodities:list',
  CommoditiesListChanged: 'commodities:list-changed',
  CommoditiesSetList: 'commodities:set-list',
  CommoditiesPickCsv: 'commodities:pick-csv',
  CommoditiesReadScreenshots: 'commodities:read-screenshots',
  CommoditiesNames: 'commodities:names',
  CommoditiesSearch: 'commodities:search',
  CommoditiesSearchSell: 'commodities:search-sell',
  CommoditiesPlan: 'commodities:plan',
  CommoditiesPlanCancel: 'commodities:plan-cancel',
  CommoditiesSellPlan: 'commodities:sell-plan',
  CommoditiesSellPlanCancel: 'commodities:sell-plan-cancel',
  CommoditiesHere: 'commodities:here',
  CommoditiesPinned: 'commodities:pinned',
  CommoditiesPinnedChanged: 'commodities:pinned-changed',
  CommoditiesPin: 'commodities:pin',
  CommoditiesPurchase: 'commodities:purchase',
  EdsmSystem: 'edsm:system',
  AssistantSnapshot: 'assistant:snapshot',
  AssistantChanged: 'assistant:changed',
  AssistantAsk: 'assistant:ask',
  AssistantVoice: 'assistant:voice',
  AssistantCancel: 'assistant:cancel',
  AssistantReset: 'assistant:reset',
  AssistantSignIn: 'assistant:sign-in',
  AssistantPreviewVoice: 'assistant:preview-voice',
  AssistantPrepareKokoro: 'assistant:prepare-kokoro',
  AssistantAnswer: 'assistant:answer',
  AssistantSpeech: 'assistant:speech',
  AssistantListen: 'assistant:listen',
  AssistantPlayback: 'assistant:playback',
  InputSnapshot: 'input:snapshot',
  InputChanged: 'input:changed',
  InputCapture: 'input:capture',
  InputCaptureCancel: 'input:capture-cancel',
  SettingsGet: 'settings:get',
  SettingsSave: 'settings:save',
  SettingsChanged: 'settings:changed',
  SettingsOpen: 'settings:open',
  EdhmFssStatus: 'edhm:fss-status',
  EdhmFssInstall: 'edhm:fss-install',
  EdhmHudColor: 'edhm:hud-color',
  EdhmHudColorChanged: 'edhm:hud-color-changed',
  CarrierWebhookTest: 'carrier-webhook:test',
  UploadsSnapshot: 'uploads:snapshot',
  UploadsChanged: 'uploads:changed',
  UploadsLog: 'uploads:log',
  UiCommand: 'ui:command',
  UiSetTab: 'ui:set-tab',
  UiGetTab: 'ui:get-tab',
  UiTabChanged: 'ui:tab-changed',
  ViewOptionsGet: 'view-options:get',
  ViewOptionsSet: 'view-options:set',
  ViewOptionsChanged: 'view-options:changed',
  ClipboardWrite: 'clipboard:write',
  BrowserState: 'browser:state',
  BrowserChanged: 'browser:changed',
  BrowserBounds: 'browser:bounds',
  BrowserNavigate: 'browser:navigate',
  BrowserBack: 'browser:back',
  BrowserForward: 'browser:forward',
  BrowserReload: 'browser:reload',
  WindowMinimize: 'window:minimize',
  WindowToggleMaximize: 'window:toggle-maximize',
  WindowClose: 'window:close',
  WindowIsMaximized: 'window:is-maximized',
  WindowMaximizedChanged: 'window:maximized-changed',
} as const;

/** What a request to the main process answers: its result, or why there is none. */
export type Outcome<T> = { result: T } | { error: string };

/** What the push-to-talk bindings ask the window to do with the microphone. */
export type ListenAction = 'start' | 'stop' | 'toggle';

/** The settings file as the renderer sees it. */
export interface SettingsView {
  settings: Settings;
  path: string;
  /** Why the file was rejected; EDSSI is running the defaults until it is fixed. */
  problem?: string;
}

/** What main pushes to every window, by channel. */
export interface IpcBroadcasts {
  [IpcChannel.UpdatesChanged]: UpdateState;
  [IpcChannel.JournalMessage]: JournalMessage;
  [IpcChannel.NavRouteChanged]: PlottedRoute;
  [IpcChannel.CsvRouteChanged]: CsvRouteState;
  [IpcChannel.SpanshPlotChanged]: SpanshPlotState;
  [IpcChannel.HistoryChanged]: HistorySnapshot;
  [IpcChannel.ActivityChanged]: ActivityTallies;
  [IpcChannel.MaterialsChanged]: MaterialsSnapshot;
  [IpcChannel.ShipsChanged]: ShipsSnapshot;
  [IpcChannel.CarriersChanged]: CarriersSnapshot;
  [IpcChannel.CommoditiesListChanged]: ShoppingList;
  [IpcChannel.CommoditiesPinnedChanged]: PinnedPlan | null;
  [IpcChannel.CommoditiesPurchase]: GamePurchase;
  [IpcChannel.AssistantChanged]: AssistantSnapshot;
  [IpcChannel.AssistantSpeech]: SpeechChunk;
  [IpcChannel.AssistantListen]: ListenAction;
  [IpcChannel.InputChanged]: InputSnapshot;
  [IpcChannel.SettingsChanged]: SettingsView;
  [IpcChannel.UploadsChanged]: UploadsSnapshot;
  [IpcChannel.EdhmHudColorChanged]: HudColor | null;
  [IpcChannel.UiCommand]: UiCommand;
  [IpcChannel.UiTabChanged]: TabId;
  [IpcChannel.ViewOptionsChanged]: ViewOptions;
  [IpcChannel.BrowserChanged]: BrowserState;
  [IpcChannel.WindowMaximizedChanged]: boolean;
}
