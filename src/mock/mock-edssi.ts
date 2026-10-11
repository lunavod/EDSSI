/**
 * The main process, made up: an `EdssiApi` that answers from a `MockScenario` instead of the
 * game, so the real windows can be drawn anywhere — a marketing page, a design review, a test.
 *
 * Reads answer from the scenario. The writes a visitor can see the point of (favourites, to-dos,
 * the shopping list, a route system ticked off, a sort, a question to the assistant) change this
 * instance's copy of it and tell its listeners, so the page reacts as the app would; nothing is
 * kept. Whatever needs the game, the network or the desktop answers that the demo can't.
 *
 * `implements EdssiApi` makes the compiler ask for a stub here whenever the API grows.
 */

import type { EdssiApi, Outcome, SettingsView } from '../shared/api';
import type { AssistantSnapshot, TranscriptEntry } from '../shared/assistant';
import type { CraftingTodo, NewCraftingTodo } from '../shared/crafting';
import type { MaterialsSnapshot } from '../shared/materials';
import type { ViewOptions } from '../shared/view-options';
import type { MockScenario } from './scenario';

/** What a write that would need the real EDSSI answers. */
export const DEMO_ONLY = 'Not in the demo: this needs EDSSI running beside the game.';

/** How long a made-up answer takes, so the window shows its "thinking" as it would. */
const THINK_MS = 900;

class Channel<T> {
  private readonly listeners = new Set<(value: T) => void>();
  on(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(value: T): void {
    for (const listener of this.listeners) listener(value);
  }
}

const noop = () => {};
const never = (): (() => void) => noop;
const resolved = (): Promise<void> => Promise.resolve();
const unavailable = <T>(): Promise<Outcome<T>> => Promise.resolve({ error: DEMO_ONLY });

/** A copy, so one instance's changes never reach another sharing the scenario. */
function copy<T>(value: T): T {
  return structuredClone(value);
}

export class MockEdssi implements EdssiApi {
  private readonly scenario: MockScenario;
  private readonly materialsChanged = new Channel<MaterialsSnapshot>();
  private readonly assistantChanged = new Channel<AssistantSnapshot>();
  private readonly viewChanged = new Channel<ViewOptions>();
  private readonly settingsChanged = new Channel<SettingsView>();
  private readonly listChanged = new Channel<MockScenario['shoppingList']>();
  private readonly pinnedChanged = new Channel<MockScenario['pinnedPlan']>();
  private readonly csvRouteChanged = new Channel<MockScenario['csvRoute']>();
  private readonly tabChanged = new Channel<MockScenario['tab']>();
  private todoIds = 0;

  constructor(scenario: MockScenario) {
    this.scenario = copy(scenario);
  }

  getVersion = (): Promise<string> => Promise.resolve(this.scenario.version);

  updates: EdssiApi['updates'] = {
    getState: () => Promise.resolve(this.scenario.updates),
    onChange: never,
    check: resolved,
    install: resolved,
    getWhatsNew: () => Promise.resolve(this.scenario.whatsNew),
    markSeen: resolved,
  };

  journal: EdssiApi['journal'] = {
    getSnapshot: () => Promise.resolve(this.scenario.journal),
    onMessage: never,
  };

  navRoutes: EdssiApi['navRoutes'] = {
    getRecent: () => Promise.resolve(this.scenario.navRoutes),
    onChange: never,
  };

  csvRoute: EdssiApi['csvRoute'] = {
    get: () => Promise.resolve(this.scenario.csvRoute),
    onChange: (listener) => this.csvRouteChanged.on(listener),
    open: () => Promise.resolve(DEMO_ONLY),
    load: () => Promise.resolve(DEMO_ONLY),
    setPosition: (position) => {
      const { csvRoute } = this.scenario;
      this.scenario.csvRoute = {
        ...csvRoute,
        ...(position === null ? { position: undefined } : { position }),
        here: false,
      };
      this.csvRouteChanged.emit(this.scenario.csvRoute);
      return resolved();
    },
    clear: resolved,
    save: () => Promise.resolve(DEMO_ONLY),
    loadSaved: () => Promise.resolve(DEMO_ONLY),
    renameSaved: () => Promise.resolve(DEMO_ONLY),
    deleteSaved: resolved,
  };

  extensions: EdssiApi['extensions'] = {
    invoke: () => Promise.reject(new Error(DEMO_ONLY)),
    on: never,
    installed: () => Promise.resolve([]),
  };

  history: EdssiApi['history'] = {
    getSnapshot: () => Promise.resolve(this.scenario.history),
    onChange: never,
  };

  activity: EdssiApi['activity'] = {
    getTallies: () => Promise.resolve(this.scenario.activity),
    onChange: never,
  };

  materials: EdssiApi['materials'] = {
    getSnapshot: () => Promise.resolve(this.scenario.materials),
    onChange: (listener) => this.materialsChanged.on(listener),
    setFavourite: (recipe, favourite) =>
      this.changeMaterials((snapshot) => ({
        favourites: favourite
          ? [...snapshot.favourites.filter((id) => id !== recipe), recipe]
          : snapshot.favourites.filter((id) => id !== recipe),
      })),
    addTodo: (todo) => this.materials.addTodos([todo]),
    addTodos: (todos) =>
      this.changeMaterials((snapshot) => ({
        todos: [...snapshot.todos, ...todos.map((todo) => this.withId(todo))],
      })),
    readBuild: () => unavailable(),
    updateTodo: (todo) =>
      this.changeMaterials((snapshot) => ({
        todos: snapshot.todos.map((known) => (known.id === todo.id ? todo : known)),
      })),
    removeTodo: (id) =>
      this.changeMaterials((snapshot) => ({
        todos: snapshot.todos.filter((todo) => todo.id !== id),
      })),
    clearDoneTodos: (kind) =>
      this.changeMaterials((snapshot) => ({
        // Only syntheses count down here; a blueprint stays until it is crossed off by hand.
        todos: snapshot.todos.filter(
          (todo) =>
            todo.kind !== kind ||
            todo.kind !== 'synthesis' ||
            todo.counts.some((count) => count > 0),
        ),
      })),
    searchTraders: () => unavailable(),
  };

  ships: EdssiApi['ships'] = {
    getSnapshot: () => Promise.resolve(this.scenario.ships),
    onChange: never,
    refreshCatalog: resolved,
    export: () => Promise.resolve(DEMO_ONLY),
    stockFit: (ship) => Promise.resolve(this.scenario.stockFits[ship.toLowerCase()]),
  };

  carriers: EdssiApi['carriers'] = {
    getSnapshot: () => Promise.resolve(this.scenario.carriers),
    onChange: never,
  };

  commodities: EdssiApi['commodities'] = {
    getList: () => Promise.resolve(this.scenario.shoppingList),
    onListChange: (listener) => this.listChanged.on(listener),
    setList: (items) => {
      this.scenario.shoppingList = { items };
      this.listChanged.emit(this.scenario.shoppingList);
      return resolved();
    },
    pickCsv: () => Promise.resolve({ error: DEMO_ONLY }),
    readScreenshots: () => unavailable(),
    names: () => Promise.resolve(this.scenario.commodityNames),
    search: () => unavailable(),
    searchSell: () => unavailable(),
    plan: () => unavailable(),
    cancelPlan: resolved,
    sellPlan: () => unavailable(),
    cancelSellPlan: resolved,
    getPinned: () => Promise.resolve(this.scenario.pinnedPlan),
    onPinnedChange: (listener) => this.pinnedChanged.on(listener),
    onPurchase: never,
    pin: (pinned) => {
      this.scenario.pinnedPlan = pinned;
      this.pinnedChanged.emit(pinned);
      return resolved();
    },
    here: () => unavailable(),
  };

  edsm: EdssiApi['edsm'] = {
    getSystem: (name) =>
      Promise.resolve(this.scenario.systems[name] ?? { name, status: 'unknown' as const }),
  };

  assistant: EdssiApi['assistant'] = {
    getSnapshot: () => Promise.resolve(this.scenario.assistant),
    onChange: (listener) => this.assistantChanged.on(listener),
    ask: (text) => {
      this.say({ role: 'commander', text }, 'thinking');
      setTimeout(
        () =>
          this.say(
            {
              role: 'assistant',
              text:
                "I'm the demo's assistant, so I can't look anything up. In EDSSI I'd answer " +
                'from your journal, Spansh, EDSM and the web, and say it aloud.',
            },
            'idle',
          ),
        THINK_MS,
      );
      return resolved();
    },
    askByVoice: resolved,
    cancel: resolved,
    reset: () => {
      this.setAssistant({ transcript: [], phase: 'idle' });
      return resolved();
    },
    signIn: resolved,
    previewVoice: () => Promise.resolve(DEMO_ONLY),
    prepareKokoro: resolved,
    answer: resolved,
    onSpeech: never,
    onListen: never,
    playback: noop,
  };

  input: EdssiApi['input'] = {
    getSnapshot: () => Promise.resolve(this.scenario.input),
    onChange: never,
    capture: () => Promise.resolve(undefined),
    cancelCapture: resolved,
  };

  settings: EdssiApi['settings'] = {
    get: () => Promise.resolve(this.scenario.settings),
    save: (patch) => {
      // Shallow per section, which is how the Settings tab saves: one section's fields at a time.
      const settings = { ...this.scenario.settings.settings } as Record<string, unknown>;
      for (const [section, fields] of Object.entries(patch)) {
        const current = settings[section];
        settings[section] =
          typeof current === 'object' && current !== null && typeof fields === 'object'
            ? { ...current, ...fields }
            : fields;
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the patch's own shape
      this.scenario.settings = { ...this.scenario.settings, settings: settings as never };
      this.settingsChanged.emit(this.scenario.settings);
      return Promise.resolve(this.scenario.settings);
    },
    onChange: (listener) => this.settingsChanged.on(listener),
    openFile: resolved,
  };

  edhm: EdssiApi['edhm'] = {
    getFssOverlay: () => Promise.resolve(this.scenario.fssOverlay),
    installFssOverlay: () => Promise.reject(new Error(DEMO_ONLY)),
    getHudColor: () => Promise.resolve(this.scenario.hudColor),
    onHudColorChange: never,
  };

  carrierWebhook: EdssiApi['carrierWebhook'] = {
    test: () => Promise.resolve(`Error: ${DEMO_ONLY}`),
  };

  uploads: EdssiApi['uploads'] = {
    getSnapshot: () => Promise.resolve(this.scenario.uploads),
    onChange: never,
    getLog: (limit) => Promise.resolve(this.scenario.uploadLog.slice(0, limit)),
  };

  ui: EdssiApi['ui'] = {
    onCommand: never,
    setTab: (tab) => {
      this.scenario.tab = tab;
      this.tabChanged.emit(tab);
    },
    getTab: () => Promise.resolve(this.scenario.tab),
    onTabChange: (listener) => this.tabChanged.on(listener),
  };

  view: EdssiApi['view'] = {
    get: () => Promise.resolve(this.scenario.viewOptions),
    set: (patch) => {
      this.scenario.viewOptions = { ...this.scenario.viewOptions, ...patch };
      this.viewChanged.emit(this.scenario.viewOptions);
      return Promise.resolve(this.scenario.viewOptions);
    },
    onChange: (listener) => this.viewChanged.on(listener),
  };

  clipboard: EdssiApi['clipboard'] = {
    // The page's own clipboard, where the browser allows it; a copy button should still copy.
    writeText: (text) => navigator.clipboard?.writeText(text).catch(noop) ?? resolved(),
  };

  browser: EdssiApi['browser'] = {
    getState: () => Promise.resolve(this.scenario.browser),
    onChange: never,
    setBounds: resolved,
    navigate: resolved,
    back: resolved,
    forward: resolved,
    reload: resolved,
  };

  window: EdssiApi['window'] = {
    minimize: resolved,
    toggleMaximize: resolved,
    close: resolved,
    isMaximized: () => Promise.resolve(false),
    onMaximizedChange: never,
  };

  private changeMaterials(
    change: (snapshot: MaterialsSnapshot) => Partial<MaterialsSnapshot>,
  ): Promise<void> {
    const snapshot = this.scenario.materials;
    this.scenario.materials = { ...snapshot, ...change(snapshot), version: snapshot.version + 1 };
    this.materialsChanged.emit(this.scenario.materials);
    return resolved();
  }

  private withId(todo: NewCraftingTodo): CraftingTodo {
    return { ...todo, id: `mock-${++this.todoIds}` };
  }

  private setAssistant(change: Partial<AssistantSnapshot>): void {
    const snapshot = this.scenario.assistant;
    this.scenario.assistant = { ...snapshot, ...change, version: snapshot.version + 1 };
    this.assistantChanged.emit(this.scenario.assistant);
  }

  private say(
    entry: Pick<TranscriptEntry, 'role' | 'text'>,
    phase: AssistantSnapshot['phase'],
  ): void {
    const { transcript } = this.scenario.assistant;
    const id = Math.max(0, ...transcript.map((known) => known.id)) + 1;
    this.setAssistant({
      phase,
      transcript: [...transcript, { ...entry, id, at: new Date().toISOString() }],
    });
  }
}
