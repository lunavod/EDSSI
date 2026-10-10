/**
 * Extensions: features built into EDSSI from outside this repository. Each is a folder in
 * `extensions/`, which git ignores; a build without one has none of it. See docs/extensions.md.
 *
 * The main process loads `extensions/<name>/main/index.ts`, which exports `extension`, a
 * `MainExtension`. Extensions built on their own and installed in `<config dir>/extensions/` are
 * loaded at start too (`loadInstalledExtensions`), so any build of EDSSI can have them.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import * as zod from 'zod';
import type { z } from 'zod';

import { EXTENSION_CHANNEL_PREFIX, IpcChannel } from '../shared/api';
import type { CsvRoute } from '../shared/csv-route';
import {
  EXTENSION_APP_PATH_ENV,
  EXTENSION_HOST_GLOBAL,
  EXTENSION_SCHEME,
  type InstalledRendererExtension,
  type SHARED_MAIN_MODULES,
} from '../shared/extensions';
import type { LoadoutEvent } from '../shared/journal';
import { registerSettingsSections } from '../shared/settings';
import type { Toolset } from './ai/tools/define';
import { configDir } from './config/paths';
import type { SettingsStore } from './config/store';
import type { SystemLocator } from './csv-route/locate';
import {
  contentType,
  extensionFile,
  findInstalledExtensions,
  type InstalledExtension,
} from './installed-extensions';
import type { OwnedShip } from './ships-service';

export interface MainExtension {
  name: string;
  /** Sections of the settings file of its own, by key, each with its schema. */
  settings?: Readonly<Record<string, z.ZodType>>;
  start(context: MainExtensionContext): { stop(): void };
}

export interface MainExtensionContext {
  settings: SettingsStore;
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

/** The extensions compiled in, then the installed ones once `loadInstalledExtensions` is done. */
const MAIN_EXTENSIONS: MainExtension[] = Object.values(modules).map((module) => module.extension);

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
  const dir = installedExtensionsDir();
  const { found, problems } = findInstalledExtensions(dir);
  for (const problem of problems) console.error(`[extensions] ${problem}`);
  for (const extension of found) {
    const { name, main } = extension.manifest;
    if (MAIN_EXTENSIONS.some((other) => other.name === name)) {
      console.info(`[extensions] ${name} is built in; the one in ${dir} is left out`);
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

/** Starts every extension; one that fails to start is reported and left out. */
export function startExtensions(context: Omit<MainExtensionContext, 'handle' | 'broadcast'>): {
  stop(): void;
} {
  const started: { stop(): void }[] = [];
  for (const extension of MAIN_EXTENSIONS) {
    try {
      started.push(
        extension.start({
          ...context,
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
    }
  }
  return {
    stop() {
      for (const extension of started) extension.stop();
    },
  };
}
