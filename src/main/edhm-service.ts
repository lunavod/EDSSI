/**
 * Serves the Settings tab's EDHM panel (the FSS Exobio Overlay) and the EDHM theme's colour,
 * which every window draws itself in while `display.match_hud_color` is on.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { app, ipcMain } from 'electron';

import { IpcChannel } from '../shared/api';
import type { FssOverlayInstallResult, FssOverlayStatus, HudColor } from '../shared/edhm';
import { broadcast } from './broadcast';
import type { SettingsStore } from './config/store';
import { downloadOriginal, fssOverlayStatus, installFssOverlay } from './edhm/fss-overlay';
import { findEdhmGame } from './edhm/game';
import { hudColorFromTheme, themeSettingsPath } from './edhm/theme';

/** A theme is applied from EDHM-UI now and then; a few seconds' notice is plenty. */
const THEME_POLL_MS = 3000;

export interface EdhmService {
  /**
   * The theme's colour as it stands, for the parts of the main process that draw in it themselves
   * rather than through a page — the VR cockpit's seam lines. `null` while no theme is applied or
   * matching is off, which is the same thing the windows are told.
   */
  hudColor(): HudColor | null;
  /** Called whenever that changes, and unsubscribed by the function it answers with. */
  onHudColor(listener: (hud: HudColor | null) => void): () => void;
  stop(): void;
}

/** The mods EDSSI ships: `resources/edhm` in the repository, `extraResources` once packaged. */
function bundleDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'edhm', '3rdPartyMods')
    : join(app.getAppPath(), 'resources', 'edhm', '3rdPartyMods');
}

function status(): FssOverlayStatus {
  const game = findEdhmGame();
  return 'problem' in game
    ? { state: 'no-edhm', message: game.problem }
    : fssOverlayStatus(game.gameDir);
}

export function startEdhmService(settings: SettingsStore): EdhmService {
  ipcMain.handle(IpcChannel.EdhmFssStatus, (): FssOverlayStatus => status());
  ipcMain.handle(IpcChannel.EdhmFssInstall, async (): Promise<FssOverlayInstallResult> => {
    const game = findEdhmGame();
    if ('problem' in game) throw new Error(game.problem);
    return installFssOverlay({
      gameDir: game.gameDir,
      bundleDir: bundleDir(),
      download: () => downloadOriginal(),
    });
  });

  // The theme file is only read again when it, or where it is, changes.
  let seen = '';
  let theme: HudColor | null = null;
  const readTheme = (): void => {
    const game = findEdhmGame();
    const path = 'gameDir' in game ? themeSettingsPath(game.gameDir) : undefined;
    let stamp = '';
    try {
      if (path) stamp = `${path}|${statSync(path).mtimeMs}`;
    } catch {
      // No theme applied yet.
    }
    if (stamp === seen) return;
    seen = stamp;
    theme = null;
    if (!path || !stamp) return;
    try {
      theme = hudColorFromTheme(JSON.parse(readFileSync(path, 'utf8'))) ?? null;
    } catch (error) {
      // Caught mid-write, most likely: forget the stamp so the next poll reads it again.
      console.error('[edhm] failed to read the theme', error);
      seen = '';
    }
  };
  const current = (): HudColor | null =>
    settings.current().display.match_hud_color ? theme : null;

  const listeners = new Set<(hud: HudColor | null) => void>();
  let sent = 'null';
  const update = (): void => {
    readTheme();
    const next = JSON.stringify(current());
    if (next === sent) return;
    sent = next;
    broadcast(IpcChannel.EdhmHudColorChanged, current());
    for (const listener of listeners) listener(current());
  };

  update();
  ipcMain.handle(IpcChannel.EdhmHudColor, (): HudColor | null => current());
  const timer = setInterval(update, THEME_POLL_MS);
  const unsubscribe = settings.onChange(update);

  return {
    hudColor: current,
    onHudColor(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      clearInterval(timer);
      unsubscribe();
      listeners.clear();
    },
  };
}
