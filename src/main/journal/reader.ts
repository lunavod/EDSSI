// oxlint-disable typescript/no-unsafe-type-assertion -- parsed JSON is typed from the schemas,
// not validated, and handlers of different event types share one map.
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  COMPANION_NAMES,
  type CompanionName,
  type JournalEvent,
  type JournalEventMap,
  type JournalEventName,
} from '../../shared/journal';
import { isNotFound, journalSessionKey, journalSortKey, listJournalFiles } from './journal-files';
import { LineReader } from './line-reader';
import { findJournalDir } from './locate';
import { parseJournalJson } from './parse';

/** Files the game rewrites in place, each holding a single event that describes current state. */
export const COMPANION_FILES = {
  Status: 'Status.json',
  Cargo: 'Cargo.json',
  Market: 'Market.json',
  ModuleInfo: 'ModulesInfo.json',
  NavRoute: 'NavRoute.json',
  Outfitting: 'Outfitting.json',
  Shipyard: 'Shipyard.json',
  ShipLocker: 'ShipLocker.json',
  Backpack: 'Backpack.json',
  FCMaterials: 'FCMaterials.json',
} as const satisfies Record<CompanionName, string>;

/** Where a journal event was read from. `line` is 1-based and counts non-blank lines. */
export interface JournalEventSource {
  file: string;
  line: number;
}

/**
 * Which existing journal events to replay on `start()` before following new ones:
 * - `none`: only events written after `start()`.
 * - `session`: the whole current (newest) game session, across all its file parts.
 * - `all`: every journal file in the directory, oldest first.
 */
export type Backfill = 'none' | 'session' | 'all';

export interface JournalReaderOptions {
  /** Journal directory. Defaults to {@link findJournalDir}. */
  dir?: string;
  /** Defaults to `session`. */
  backfill?: Backfill;
  /** How often to look for new data. Defaults to 250 ms. */
  pollIntervalMs?: number;
}

type EventHandler = (event: JournalEvent, source: JournalEventSource) => void;
type CompanionHandler = (event: JournalEventMap[CompanionName]) => void;
type ErrorHandler = (error: Error) => void;

interface CurrentFile {
  name: string;
  reader: LineReader;
  line: number;
}

/**
 * Follows the Elite Dangerous player journal and its companion files, dispatching typed events.
 *
 * The game appends to the newest `Journal.*.log` and rewrites the companion `*.json` files in
 * place. File-change notifications are unreliable for both on Windows, so everything is polled.
 * Event payloads are typed from the community schemas but not validated at runtime.
 */
export class JournalReader {
  #dir: string | undefined;
  readonly #backfill: Backfill;
  readonly #pollIntervalMs: number;

  readonly #eventHandlers = new Map<string, Set<EventHandler>>();
  readonly #anyHandlers = new Set<EventHandler>();
  readonly #companionHandlers = new Map<string, Set<CompanionHandler>>();
  readonly #errorHandlers = new Set<ErrorHandler>();

  #current: CurrentFile | undefined;
  #initialPickDone = false;
  #started = false;
  #timer: NodeJS.Timeout | undefined;
  #tick: Promise<void> | undefined;
  /** mtime:size of the last companion file version that was dispatched (or given up on). */
  readonly #companionVersions = new Map<CompanionName, string>();
  /** Version that failed to parse on the previous poll; a second failure is reported. */
  readonly #companionFailures = new Map<CompanionName, string>();

  constructor(options: JournalReaderOptions = {}) {
    this.#dir = options.dir;
    this.#backfill = options.backfill ?? 'session';
    this.#pollIntervalMs = options.pollIntervalMs ?? 250;
  }

  /** The journal directory, once resolved by `start()`. */
  get dir(): string | undefined {
    return this.#dir;
  }

  on<N extends JournalEventName>(
    name: N,
    handler: (event: JournalEventMap[N], source: JournalEventSource) => void,
  ): () => void {
    return subscribe(this.#eventHandlers, name, handler as EventHandler);
  }

  onAny(handler: EventHandler): () => void {
    this.#anyHandlers.add(handler);
    return () => this.#anyHandlers.delete(handler);
  }

  /**
   * Subscribes to a companion file. Its current contents are dispatched on `start()` (they are
   * a snapshot, not history), then again whenever the game rewrites it.
   */
  onCompanion<N extends CompanionName>(
    name: N,
    handler: (event: JournalEventMap[N]) => void,
  ): () => void {
    return subscribe(this.#companionHandlers, name, handler as CompanionHandler);
  }

  /** Receives unreadable lines, I/O failures and exceptions thrown by handlers. */
  onError(handler: ErrorHandler): () => void {
    this.#errorHandlers.add(handler);
    return () => this.#errorHandlers.delete(handler);
  }

  /** Reads the current contents of a companion file, or `undefined` if it doesn't exist. */
  async readCompanion<N extends CompanionName>(name: N): Promise<JournalEventMap[N] | undefined> {
    try {
      const text = await readFile(join(await this.#resolveDir(), COMPANION_FILES[name]), 'utf8');
      return parseEvent(text) as JournalEventMap[N];
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  /** Performs the backfill, then keeps polling until `stop()`. Resolves once backfill is done. */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    await this.#resolveDir();
    await this.#runTick();
  }

  /** Stops polling and waits for an in-flight poll to finish. */
  async stop(): Promise<void> {
    this.#started = false;
    clearTimeout(this.#timer);
    await this.#tick;
  }

  async #resolveDir(): Promise<string> {
    this.#dir ??= await findJournalDir();
    return this.#dir;
  }

  async #runTick(): Promise<void> {
    this.#tick = this.#poll();
    await this.#tick;
    if (this.#started) {
      this.#timer = setTimeout(() => void this.#runTick(), this.#pollIntervalMs);
    }
  }

  async #poll(): Promise<void> {
    try {
      await this.#pollJournal();
      await this.#pollCompanions();
    } catch (error) {
      this.#reportError(error);
    }
  }

  async #pollJournal(): Promise<void> {
    const dir = this.#dir!;
    let files = await listJournalFiles(dir);

    let current: CurrentFile | undefined = this.#current ?? (await this.#pickStartFile(files));
    if (!current) return;
    this.#current = current;

    for (;;) {
      this.#dispatchLines(current, await readLinesIfPresent(current.reader));

      // The game never goes back to an older file, so once a newer one exists the current one is done.
      const currentKey: string = journalSortKey(current.name)!;
      const next: string | undefined = files.find((name) => journalSortKey(name)! > currentKey);
      if (next === undefined) return;

      this.#dispatchLines(current, await readLinesIfPresent(current.reader));
      const remainder = current.reader.takeRemainder();
      if (remainder !== undefined) this.#dispatchLines(current, [remainder]);

      current = { name: next, reader: new LineReader(join(dir, next)), line: 0 };
      this.#current = current;
      files = await listJournalFiles(dir);
    }
  }

  async #pickStartFile(files: string[]): Promise<CurrentFile | undefined> {
    const isInitialPick = !this.#initialPickDone;
    this.#initialPickDone = true;
    const newest = files.at(-1);
    if (newest === undefined) return undefined;
    const dir = this.#dir!;
    const at = (name: string, offset = 0): CurrentFile => ({
      name,
      reader: new LineReader(join(dir, name), offset),
      line: 0,
    });

    // The directory was empty at start(), so whatever appeared since is new: read it all.
    if (!isInitialPick || this.#backfill === 'all') return at(files[0]!);
    if (this.#backfill === 'session') {
      const session = journalSessionKey(newest);
      return at(files.find((name) => journalSessionKey(name) === session)!);
    }
    const { size } = await stat(join(dir, newest));
    return at(newest, size);
  }

  #dispatchLines(file: CurrentFile, lines: string[]): void {
    for (const text of lines) {
      const source = { file: file.name, line: ++file.line };
      let event: JournalEvent;
      try {
        event = parseEvent(text) as JournalEvent;
      } catch (error) {
        const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text;
        this.#reportError(
          new Error(`Unreadable journal line ${source.file}:${source.line}: ${preview}`, {
            cause: error,
          }),
        );
        continue;
      }
      for (const handler of this.#eventHandlers.get(event.event) ?? []) {
        this.#call(() => handler(event, source));
      }
      for (const handler of this.#anyHandlers) this.#call(() => handler(event, source));
    }
  }

  async #pollCompanions(): Promise<void> {
    const dir = this.#dir!;
    for (const name of COMPANION_NAMES) {
      const handlers = this.#companionHandlers.get(name);
      if (!handlers?.size) continue;

      const path = join(dir, COMPANION_FILES[name]);
      let text: string;
      let version: string;
      try {
        const stats = await stat(path);
        version = `${stats.mtimeMs}:${stats.size}`;
        if (this.#companionVersions.get(name) === version) continue;
        text = await readFile(path, 'utf8');
      } catch (error) {
        if (isNotFound(error)) continue;
        throw error;
      }

      let event: JournalEventMap[CompanionName];
      try {
        event = parseEvent(text) as JournalEventMap[CompanionName];
      } catch (error) {
        // Usually we caught the game mid-write; retry on the next poll. Report only if the same
        // version fails twice, then leave it alone until it changes.
        if (this.#companionFailures.get(name) === version) {
          this.#companionVersions.set(name, version);
          this.#reportError(new Error(`Unreadable companion file ${path}`, { cause: error }));
        } else {
          this.#companionFailures.set(name, version);
        }
        continue;
      }
      this.#companionFailures.delete(name);
      this.#companionVersions.set(name, version);
      for (const handler of handlers) this.#call(() => handler(event));
    }
  }

  #call(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.#reportError(error);
    }
  }

  #reportError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    if (this.#errorHandlers.size === 0) {
      console.error('[journal]', err);
      return;
    }
    for (const handler of this.#errorHandlers) {
      try {
        handler(err);
      } catch (handlerError) {
        console.error('[journal] error handler threw', handlerError);
      }
    }
  }
}

function subscribe<H>(map: Map<string, Set<H>>, name: string, handler: H): () => void {
  let handlers = map.get(name);
  if (!handlers) map.set(name, (handlers = new Set()));
  handlers.add(handler);
  return () => handlers.delete(handler);
}

function parseEvent(text: string): unknown {
  const value = parseJournalJson(text);
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { event?: unknown }).event !== 'string' ||
    typeof (value as { timestamp?: unknown }).timestamp !== 'string'
  ) {
    throw new Error('Not a journal event (missing "event" or "timestamp")');
  }
  return value;
}

/** A journal file the user deleted mid-read just has nothing more to give. */
async function readLinesIfPresent(reader: LineReader): Promise<string[]> {
  try {
    return await reader.readLines();
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}
