/**
 * Serves the settings file to the windows, and writes back what the settings screen changes.
 *
 * The file stays the source of truth: a save is written to disk and read straight back, so a
 * change made on the screen and a change made in an editor arrive by exactly the same path.
 */

import { ipcMain, shell } from 'electron';

import { IpcChannel, type SettingsView } from '../shared/api';
import type { SettingsPatch } from '../shared/settings';
import { broadcast } from './broadcast';
import { saveSettings } from './config/save';
import type { SettingsStore } from './config/store';

export interface SettingsService {
  stop(): void;
}

export function startSettingsService(store: SettingsStore): SettingsService {
  const view = (): SettingsView => ({
    settings: store.current(),
    path: store.path,
    problem: store.problem(),
  });

  const unsubscribe = store.onChange(() => broadcast(IpcChannel.SettingsChanged, view()));

  ipcMain.handle(IpcChannel.SettingsGet, (): SettingsView => view());
  ipcMain.handle(IpcChannel.SettingsSave, (_event, patch: SettingsPatch): SettingsView => {
    saveSettings(store.path, patch);
    // Don't make the screen wait a second for the poll to notice EDSSI's own write.
    store.reload();
    const next = view();
    // `onChange` only fires when the settings really changed; the screen is told either way.
    broadcast(IpcChannel.SettingsChanged, next);
    return next;
  });
  ipcMain.handle(IpcChannel.SettingsOpen, () => shell.openPath(store.path));

  return {
    stop: unsubscribe,
  };
}
