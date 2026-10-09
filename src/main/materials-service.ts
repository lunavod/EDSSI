import { randomUUID } from 'node:crypto';

import { ipcMain } from 'electron';

import { IpcChannel, type Outcome } from '../shared/api';
import { type PlannedBuild, planBuild, readBuilds, shipToCompare } from '../shared/build-import';
import {
  type CraftingTodo,
  recordSynthesis,
  sanitizeTodo,
  type SynthesisMade,
  synthesisByName,
  todoDone,
  type TraderSearchRequest,
  type TraderSearchResult,
} from '../shared/crafting';
import type { JournalEvent } from '../shared/journal';
import { favouriteIds, type MaterialsSnapshot, matchRecipe, recipeById } from '../shared/materials';
import { broadcast } from './broadcast';
import type { JournalReader } from './journal';
import { buildJson } from './materials/build-text';
import { MaterialsTracker } from './materials/tracker';
import { isTradedCategory, searchTraders } from './materials/traders';
import { SpanshClient } from './spansh/client';
import { type Position, positionOf, referenceFor } from './spansh/reference';
import type { CraftingTodoStore } from './store/crafting-todo-store';
import type { RecipeFavouriteStore } from './store/recipe-favourite-store';

/** Live events can come in bursts (a trader, a run of synthesis); windows hear at most this often. */
const BROADCAST_INTERVAL_MS = 250;

export interface MaterialsService {
  /** Call once `reader` has replayed the older journals. */
  markReady(): void;
  snapshot(): MaterialsSnapshot;
}

/**
 * Keeps what the commander carries to craft with and what they've crafted, from every journal,
 * which recipes they favour, and their to-do lists of blueprints and syntheses; syntheses made
 * from then on count down (blueprint rolls aren't tracked). `reader` must replay them all (`backfill: 'all'`). Without a database
 * the choices and to-dos last until EDSSI closes.
 */
export function startMaterialsService(
  reader: JournalReader,
  options: {
    favourites?: RecipeFavouriteStore;
    todos?: CraftingTodoStore;
    /** The commander's current system, for trader searches from "here". */
    here: () => string | undefined;
    /** A hull's name for the journal's (`panthermkii`), for naming an imported build. */
    hullName?: (ship: string) => string | undefined;
    client?: SpanshClient;
  },
): MaterialsService {
  const tracker = new MaterialsTracker();
  const client = options.client ?? new SpanshClient();
  const choices = readChoices(options.favourites);
  let todos = readTodos(options.todos);
  let ready = false;
  /** Where the commander last arrived, for systems Spansh doesn't know. */
  let position: Position | undefined;
  // Favourites and to-dos change without the journal moving, and a window must still take the
  // new snapshot.
  let changes = 0;
  let timer: NodeJS.Timeout | undefined;

  const snapshot = (): MaterialsSnapshot => ({
    version: tracker.version + changes,
    ready,
    commander: tracker.commander,
    inventory: tracker.inventory(),
    history: tracker.history(),
    favourites: favouriteIds(choices),
    todos,
    engineers: tracker.engineers(),
    ...(position && { position: { system: position.system, coords: position.coords } }),
  });
  const send = () => {
    clearTimeout(timer);
    timer = undefined;
    broadcast(IpcChannel.MaterialsChanged, snapshot());
  };
  const changed = () => {
    if (ready) timer ??= setTimeout(send, BROADCAST_INTERVAL_MS);
  };
  const setTodos = (next: CraftingTodo[], now = true) => {
    todos = next;
    try {
      options.todos?.save(todos);
    } catch (error) {
      console.error('[materials] failed to save the to-do lists', error);
    }
    changes++;
    if (now) send();
    else changed();
  };

  reader.onAny((event) => {
    const arrived = positionOf(event);
    if (arrived) position = arrived;
    // A jump moves every engineer's distance.
    if (tracker.apply(event) || arrived) changed();
    // Only crafts made while EDSSI watches count against the to-dos; older ones were before them.
    const made = ready ? synthesisMade(event) : undefined;
    const next = made && recordSynthesis(todos, made);
    if (next) setTodos(next, false);
  });
  // The journal only lists cargo and the locker in full now and then; the files always do.
  reader.onCompanion('Cargo', (event) => {
    if (tracker.applyCompanion(event)) changed();
  });
  reader.onCompanion('ShipLocker', (event) => {
    if (tracker.applyCompanion(event)) changed();
  });

  ipcMain.handle(IpcChannel.MaterialsSnapshot, snapshot);
  ipcMain.handle(IpcChannel.MaterialsFavourite, (_event, recipe: unknown, favourite: unknown) => {
    if (typeof recipe !== 'string' || typeof favourite !== 'boolean' || !recipeById(recipe)) {
      return;
    }
    choices.set(recipe, favourite);
    try {
      options.favourites?.set(recipe, favourite);
    } catch (error) {
      console.error('[materials] failed to save a favourite', error);
    }
    changes++;
    send();
  });
  ipcMain.handle(IpcChannel.MaterialsTodoAdd, (_event, todo: unknown) => {
    const checked = sanitizeTodo(todo);
    if (checked) setTodos([...todos, { ...checked, id: randomUUID() }]);
  });
  ipcMain.handle(IpcChannel.MaterialsTodoAddMany, (_event, added: unknown) => {
    if (!Array.isArray(added)) return;
    const checked = added.flatMap((todo: unknown) => {
      const one = sanitizeTodo(todo);
      return one ? [{ ...one, id: randomUUID() }] : [];
    });
    if (checked.length > 0) setTodos([...todos, ...checked]);
  });
  ipcMain.handle(
    IpcChannel.MaterialsReadBuild,
    (_event, text: unknown, rolls: unknown): Outcome<PlannedBuild[]> => {
      try {
        if (typeof text !== 'string') return { error: 'Paste a build first.' };
        const builds = readBuilds(buildJson(text));
        if (builds.length === 0) {
          return { error: "That isn't a ship build EDSSI knows: paste EDSY's or Coriolis' SLEF." };
        }
        const atTarget =
          rolls === 'max'
            ? 'max'
            : typeof rolls === 'number' && Number.isInteger(rolls)
              ? Math.min(99, Math.max(1, rolls))
              : 'max';
        const owned = tracker.ships();
        return {
          result: builds.map((build) =>
            planBuild(build, shipToCompare(build, owned), atTarget, options.hullName),
          ),
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(IpcChannel.MaterialsTodoUpdate, (_event, todo: unknown) => {
    const checked = sanitizeTodo(todo);
    const id = typeof todo === 'object' && todo !== null ? Reflect.get(todo, 'id') : undefined;
    if (!checked || !todos.some((known) => known.id === id)) return;
    setTodos(todos.map((known) => (known.id === id ? { ...checked, id: known.id } : known)));
  });
  ipcMain.handle(IpcChannel.MaterialsTodoRemove, (_event, id: unknown) => {
    if (todos.some((todo) => todo.id === id)) setTodos(todos.filter((todo) => todo.id !== id));
  });
  ipcMain.handle(IpcChannel.MaterialsTodoClearDone, (_event, kind: unknown) => {
    const standings = tracker.engineers();
    const next = todos.filter((todo) => todo.kind !== kind || !todoDone(todo, standings));
    if (next.length !== todos.length) setTodos(next);
  });
  ipcMain.handle(
    IpcChannel.MaterialsTraders,
    async (_event, request: TraderSearchRequest): Promise<Outcome<TraderSearchResult>> => {
      try {
        const { reference, label } = referenceFor(request.near, options.here(), position);
        const found = await searchTraders(
          client,
          { ...request, types: request.types.filter(isTradedCategory) },
          reference,
        );
        return { result: { ...found, reference: label } };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  return {
    snapshot,
    markReady() {
      ready = true;
      send();
    },
  };
}

/** A synthesis in the journal, as the to-do list counts it. */
function synthesisMade(event: JournalEvent): SynthesisMade | undefined {
  if (event.event !== 'Synthesis') return undefined;
  const used = event.Materials.map((item): [string, number] => [
    item.Name.toLowerCase(),
    item.Count,
  ]);
  const recipe = matchRecipe('synthesis', event.Name, used);
  if (!recipe?.grade || !synthesisByName(recipe.group)) return undefined;
  return { synthesis: recipe.group, grade: recipe.grade };
}

function readChoices(store: RecipeFavouriteStore | undefined): Map<string, boolean> {
  try {
    return store?.choices() ?? new Map();
  } catch (error) {
    console.error('[materials] failed to read favourites', error);
    return new Map();
  }
}

function readTodos(store: CraftingTodoStore | undefined): CraftingTodo[] {
  try {
    return store?.load() ?? [];
  } catch (error) {
    console.error('[materials] failed to read the to-do lists', error);
    return [];
  }
}
