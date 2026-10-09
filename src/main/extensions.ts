/**
 * Extensions: features built into EDSSI from outside this repository. Each is a folder in
 * `extensions/`, which git ignores; a build without one has none of it. See docs/extensions.md.
 *
 * The main process loads `extensions/<name>/main/index.ts`, which exports `extension`, a
 * `MainExtension`.
 */

import { BrowserWindow, ipcMain } from 'electron';
import type { z } from 'zod';

import { EXTENSION_CHANNEL_PREFIX } from '../shared/api';
import type { CsvRoute } from '../shared/csv-route';
import type { LoadoutEvent } from '../shared/journal';
import { registerSettingsSections } from '../shared/settings';
import type { Toolset } from './ai/tools/define';
import type { SettingsStore } from './config/store';
import type { SystemLocator } from './csv-route/locate';
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

export const MAIN_EXTENSIONS: readonly MainExtension[] = Object.values(modules).map(
  (module) => module.extension,
);

// Before the settings file is first read.
for (const extension of MAIN_EXTENSIONS) {
  if (extension.settings) registerSettingsSections(extension.settings);
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
