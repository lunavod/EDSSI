/**
 * Extensions: features built into EDSSI from outside this repository. Each is a folder in
 * `extensions/`, which git ignores; a build without one has none of it. See docs/extensions.md.
 *
 * The main process loads `extensions/<name>/main/index.ts`, which exports `extension`, a
 * `MainExtension`. Extensions built on their own and installed in `<config dir>/extensions/` are
 * loaded at start too (`loadInstalledExtensions`), so any build of EDSSI can have them.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron';
import * as zod from 'zod';
import type { z } from 'zod';

import { EXTENSION_CHANNEL_PREFIX, IpcChannel } from '../shared/api';
import type { CsvRoute } from '../shared/csv-route';
import {
  EXTENSION_APP_PATH_ENV,
  EXTENSION_HOST_GLOBAL,
  EXTENSION_SCHEME,
  type ExtensionInfo,
  type ExtensionsFile,
  type ExtensionsView,
  type InstalledRendererExtension,
  parseExtensionsFile,
  type SHARED_MAIN_MODULES,
} from '../shared/extensions';
import type { LoadoutEvent } from '../shared/journal';
import { registerSettingsSections } from '../shared/settings';
import type { TabId } from '../shared/ui';
import type { GameData } from './ai/game-data';
import type { Toolset } from './ai/tools/define';
import { configDir, extensionsStatePath } from './config/paths';
import type { SettingsStore } from './config/store';
import type { SystemLocator } from './csv-route/locate';
import { guardFeed, guardSessionFeed, type JournalFeed, type SessionFeed } from './extension-feed';
import {
  contentType,
  extensionFile,
  findInstalledExtensions,
  type InstalledExtension,
} from './installed-extensions';
import type { OwnedShip } from './ships-service';
import { STARTED_BY_GAME_FLAG } from './startup/start-with-game';

export interface MainExtension {
  name: string;
  /** Sections of the settings file of its own, by key, each with its schema. */
  settings?: Readonly<Record<string, z.ZodType>>;
  start(context: MainExtensionContext): { stop(): void };
}

export interface MainExtensionContext {
  settings: SettingsStore;
  /**
   * The journal as EDSSI reads it, so an extension needn't poll the files a second time. Each
   * event comes with whether it is live; handlers added while starting hear the whole replay.
   */
  journal: {
    /** The current game session, replayed from its start, with the companion files. */
    session: SessionFeed;
    /** Every journal there is, oldest first, then live: for anything kept over the career. */
    all: JournalFeed;
    /** The folder EDSSI reads them from (`EDSSI_JOURNAL_DIR`, else the game's), for another process. */
    dir: () => Promise<string>;
  };
  /**
   * What EDSSI has made of the journals, as the assistant reads it: the session, the overview,
   * the ledger and survey, carriers, activity, routes, the CSV route, the settings, EDSM.
   */
  game: GameData;
  /**
   * One question to the assistant's model, as the commander set it up, with no tools and no
   * conversation: `images` are data URLs. Fails when the assistant isn't ready.
   */
  ask(
    request: { instructions: string; text: string; images?: string[] },
    signal?: AbortSignal,
  ): Promise<string>;
  /** A folder of its own in EDSSI's data folder, made on first use. */
  dataDir(): string;
  /** Writes to EDSSI's log under the extension's name. */
  log: Pick<Console, 'info' | 'warn' | 'error'>;
  /** Brings a tab forward in the window: one of EDSSI's, or one of its own (`extensionTabId`). */
  showTab(tab: TabId): void;
  /** The commander's current system. */
  here(): string | undefined;
  /** The ship being flown, as the journal last described it: its `Loadout` and the t in its hold. */
  ship(): { loadout: LoadoutEvent; cargo: number } | undefined;
  /** Every ship the commander owns, the one being flown first, each with its last `Loadout`. */
  ships(): OwnedShip[];
  /** Follows a route on the Route tab, as though it had been loaded from a CSV file. */
  followRoute(route: CsvRoute): void;
  /**
   * Saves a route under a name on the Route tab's row of saved routes, without following it.
   * Answers its `savedId` (followed with that on it, the route is taken up as the saved one), or
   * why it couldn't be saved.
   */
  saveRoute(name: string, route: CsvRoute): { id: number } | { problem: string };
  /** Tells the commander something: spoken when speech is on, else written in Comms. */
  notify(text: string): void;
  /** Where systems are and their stars, asked before EDSM for a CSV route's systems. */
  addSystemLocator(locator: SystemLocator): void;
  /** Tools for the assistant. Only those added while starting count. */
  addToolset(toolset: Toolset): void;
  /** Answers `window.edssi.extensions.invoke(channel, …)`. */
  handle(channel: string, handler: (...args: unknown[]) => unknown): void;
  /** Sends to `window.edssi.extensions.on(channel, …)` in every window. */
  broadcast(channel: string, payload: unknown): void;
}

const modules = import.meta.glob<{ extension: MainExtension }>('../../extensions/*/main/index.ts', {
  eager: true,
});

/**
 * The extensions compiled in, then the installed ones once `loadInstalledExtensions` is done, less
 * the ones turned off.
 */
const MAIN_EXTENSIONS: MainExtension[] = Object.values(modules).map((module) => module.extension);

/** Every extension and how it stands, for the Settings tab. */
const listed: ExtensionInfo[] = [];
let installProblems: string[] = [];

// Before the settings file is first read.
for (const extension of MAIN_EXTENSIONS) {
  if (extension.settings) registerSettingsSections(extension.settings);
}

/** The installed extensions loaded, for their window side and files. */
const installed: InstalledExtension[] = [];

// Before the app is ready, or the window can't load modules from it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: EXTENSION_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

/** Where installed extensions live: a folder each, as `npm run build:extension` makes it. */
export function installedExtensionsDir(): string {
  return join(configDir(), 'extensions');
}

/**
 * Loads the installed extensions, once the app is ready and before the settings file is first
 * read. One compiled in under the same name wins; one that fails to load is reported and left
 * out, its window side with it.
 */
export async function loadInstalledExtensions(): Promise<void> {
  shareHostModules();
  const disabled = new Set(readDisabled());
  const builtIn = MAIN_EXTENSIONS.map((extension) => extension.name);
  for (const name of builtIn) {
    const enabled = !disabled.has(name);
    listed.push({ name, source: 'built-in', state: enabled ? 'running' : 'disabled', enabled });
    if (!enabled) console.info(`[extensions] ${name} is turned off`);
  }
  const kept = MAIN_EXTENSIONS.filter((extension) => !disabled.has(extension.name));
  MAIN_EXTENSIONS.splice(0, MAIN_EXTENSIONS.length, ...kept);
  const dir = installedExtensionsDir();
  const { found, problems } = findInstalledExtensions(dir);
  installProblems = problems;
  for (const problem of problems) console.error(`[extensions] ${problem}`);
  for (const extension of found) {
    const { name, main } = extension.manifest;
    const info: ExtensionInfo = {
      name,
      source: 'installed',
      state: 'running',
      enabled: !disabled.has(name),
      folder: extension.root,
    };
    listed.push(info);
    if (builtIn.includes(name)) {
      console.info(`[extensions] ${name} is built in; the one in ${dir} is left out`);
      info.state = 'shadowed';
      continue;
    }
    if (!info.enabled) {
      console.info(`[extensions] ${name} is turned off`);
      info.state = 'disabled';
      continue;
    }
    try {
      if (main !== undefined) {
        const url = pathToFileURL(join(extension.root, main)).href;
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked just below
        const module = (await import(url)) as { extension?: MainExtension };
        if (typeof module.extension?.start !== 'function') {
          throw new Error(`${main} exports no extension`);
        }
        if (module.extension.settings) registerSettingsSections(module.extension.settings);
        MAIN_EXTENSIONS.push(module.extension);
      }
      installed.push(extension);
      console.info(`[extensions] loaded ${name} from ${extension.root}`);
    } catch (error) {
      console.error(`[extensions] ${name} failed to load`, error);
      info.state = 'failed';
      info.problem = error instanceof Error ? error.message : String(error);
    }
  }
  protocol.handle(EXTENSION_SCHEME, serveExtensionFile);
  ipcMain.handle(IpcChannel.ExtensionsInstalled, (): InstalledRendererExtension[] =>
    installed.map(({ manifest: { name, renderer, style } }) => ({
      name,
      ...(renderer !== undefined && { script: `${EXTENSION_SCHEME}://${name}/${renderer}` }),
      ...(style !== undefined && { style: `${EXTENSION_SCHEME}://${name}/${style}` }),
    })),
  );
  ipcMain.handle(IpcChannel.ExtensionsList, (): ExtensionsView => extensionsView());
  ipcMain.handle(IpcChannel.ExtensionsSetEnabled, (_event, name: unknown, enabled: unknown) => {
    if (typeof name !== 'string' || typeof enabled !== 'boolean') {
      throw new TypeError('An extension is turned on or off by its name');
    }
    setEnabled(name, enabled);
    return extensionsView();
  });
  ipcMain.handle(IpcChannel.ExtensionsOpenFolder, async () => {
    mkdirSync(dir, { recursive: true });
    const problem = await shell.openPath(dir);
    if (problem) throw new Error(problem);
  });
  ipcMain.handle(IpcChannel.ExtensionsRestart, () => {
    // Asked for from the window, so the new one may take focus, whoever started this one.
    app.relaunch({ args: process.argv.slice(1).filter((arg) => arg !== STARTED_BY_GAME_FLAG) });
    app.quit();
  });
}

function extensionsView(): ExtensionsView {
  return {
    extensions: listed.map((info) => ({ ...info })),
    folder: installedExtensionsDir(),
    problems: installProblems,
  };
}

/** The names turned off; none when the file is missing or can't be read. */
function readDisabled(): string[] {
  const file = extensionsStatePath();
  if (!existsSync(file)) return [];
  try {
    return parseExtensionsFile(JSON.parse(readFileSync(file, 'utf8'))).disabled;
  } catch (error) {
    console.error(`[extensions] ${file} can't be read; every extension is on`, error);
    return [];
  }
}

/** Turns one on or off from the next start; this run goes on as it started. */
function setEnabled(name: string, enabled: boolean): void {
  const disabled = new Set(readDisabled());
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  mkdirSync(configDir(), { recursive: true });
  const file: ExtensionsFile = { disabled: [...disabled].toSorted() };
  writeFileSync(extensionsStatePath(), `${JSON.stringify(file, null, 2)}\n`);
  for (const info of listed) if (info.name === name) info.enabled = enabled;
}

/** What an installed extension takes from EDSSI rather than carrying a copy of its own. */
function shareHostModules(): void {
  process.env[EXTENSION_APP_PATH_ENV] = app.getAppPath();
  const shared: Record<(typeof SHARED_MAIN_MODULES)[number], unknown> = { zod };
  Object.assign(globalThis, { [EXTENSION_HOST_GLOBAL]: shared });
}

/** `edssi-ext://<name>/<file>`: a file of a loaded extension's folder, and nothing else. */
async function serveExtensionFile(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const extension = installed.find((candidate) => candidate.manifest.name === url.hostname);
  const file = extension && extensionFile(extension.root, url.pathname);
  if (!file) return new Response('Not found', { status: 404 });
  try {
    return new Response(await readFile(file), {
      headers: {
        'Content-Type': contentType(file),
        // The window's own origin is a file (or the dev server), so its module imports need CORS.
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

/** What every extension shares; `startExtensions` adds what is each one's own. */
export type SharedExtensionContext = Omit<
  MainExtensionContext,
  'handle' | 'broadcast' | 'dataDir' | 'log'
> & {
  /** EDSSI's data folder, where each extension's own folder goes. */
  dataRoot: string;
};

/** Starts every extension; one that fails to start is reported and left out. */
export function startExtensions({ dataRoot, ...context }: SharedExtensionContext): {
  stop(): void;
} {
  const started: { stop(): void }[] = [];
  for (const extension of MAIN_EXTENSIONS) {
    const prefix = `[${extension.name}]`;
    const log: MainExtensionContext['log'] = {
      info: (...args: unknown[]) => console.info(prefix, ...args),
      warn: (...args: unknown[]) => console.warn(prefix, ...args),
      error: (...args: unknown[]) => console.error(prefix, ...args),
    };
    const report = (error: unknown) => log.error('a journal handler failed', error);
    try {
      started.push(
        extension.start({
          ...context,
          journal: {
            session: guardSessionFeed(context.journal.session, report),
            all: guardFeed(context.journal.all, report),
            dir: context.journal.dir,
          },
          log,
          dataDir: () => {
            const dir = join(dataRoot, 'extensions', extension.name);
            mkdirSync(dir, { recursive: true });
            return dir;
          },
          handle: (channel, handler) =>
            ipcMain.handle(EXTENSION_CHANNEL_PREFIX + channel, (_event, ...args: unknown[]) =>
              handler(...args),
            ),
          broadcast: (channel, payload) => {
            for (const window of BrowserWindow.getAllWindows()) {
              window.webContents.send(EXTENSION_CHANNEL_PREFIX + channel, payload);
            }
          },
        }),
      );
    } catch (error) {
      console.error(`[extensions] ${extension.name} failed to start`, error);
      const info = listed.find((candidate) => candidate.name === extension.name);
      if (info) {
        info.state = 'failed';
        info.problem = error instanceof Error ? error.message : String(error);
      }
    }
  }
  return {
    stop() {
      for (const extension of started) extension.stop();
    },
  };
}
