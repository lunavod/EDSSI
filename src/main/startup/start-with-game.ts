/**
 * "Start with the game" (`startup.with_game`): a small PowerShell watcher, started with Windows,
 * that starts EDSSI whenever Elite Dangerous starts (`start-with-game.ps1`, beside this file). EDSSI
 * started by it is told so on its command line and shows its window without taking focus; the
 * watcher hands focus back to the game should it be taken anyway.
 *
 * Turning it on writes the script into the data folder, adds it to Windows' startup apps (the
 * Run key, through Electron's login items, so Task Manager lists and can switch it off) and starts
 * it at once. Turning it off removes the startup app and the script, which the running watcher
 * notices and ends. Only an installed EDSSI does any of it: run from source, there is no exe that
 * stays put to start.
 */

import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';

import type { SettingsStore } from '../config/store';
import script from './start-with-game.ps1?raw';

/** On the command line of an EDSSI the watcher started. */
export const STARTED_BY_GAME_FLAG = '--started-by-game';

export const WATCHER_FILE = 'start-with-game.ps1';

/** Whether this EDSSI was started by the watcher, so must not take focus from the game. */
export function startedByGame(argv: readonly string[] = process.argv): boolean {
  return argv.includes(STARTED_BY_GAME_FLAG);
}

export interface WatcherCommand {
  /** The script, in the data folder. */
  script: string;
  /** The EDSSI exe to start. */
  app: string;
  /** Names the mutex that keeps one watcher running; one per build, so EDSSI Dev has its own. */
  mutex: string;
}

/** PowerShell's arguments for running the watcher, unquoted (as `spawn` wants them). */
export function watcherArgs(command: WatcherCommand): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle',
    'Hidden',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    command.script,
    '-App',
    command.app,
    '-Mutex',
    command.mutex,
  ];
}

/** The same, quoted for the Run key, which Electron writes as the arguments joined by spaces. */
export function loginItemArgs(command: WatcherCommand): string[] {
  return watcherArgs(command).map((arg) => (/[\s"]/u.test(arg) ? `"${arg}"` : arg));
}

/** The startup app's name in the Run key and Task Manager, and the mutex's, for this build. */
export function watcherNames(appName: string): { loginItem: string; mutex: string } {
  return {
    loginItem: `${appName} start with game`,
    mutex: `Local\\${appName.replace(/[^\w-]/gu, '')}-start-with-game`,
  };
}

function powershell(): string {
  return join(
    process.env['SystemRoot'] ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
}

export function startStartWithGame(options: { settings: SettingsStore; dataDir: string }): {
  stop(): void;
} {
  const { settings, dataDir } = options;
  if (!app.isPackaged || process.platform !== 'win32') return { stop() {} };

  const names = watcherNames(app.getName());
  const command: WatcherCommand = {
    script: join(dataDir, WATCHER_FILE),
    app: process.execPath,
    mutex: names.mutex,
  };
  const loginItem = (openAtLogin: boolean) => {
    app.setLoginItemSettings({
      openAtLogin,
      path: powershell(),
      args: loginItemArgs(command),
      name: names.loginItem,
    });
  };

  let applied: boolean | undefined;
  const apply = (on: boolean) => {
    if (on === applied) return;
    applied = on;
    try {
      if (on) {
        // Written at every start, so an update's watcher replaces the last one's (from the next
        // logon: one already running carries on as it was).
        writeFileSync(command.script, script);
        loginItem(true);
        // Now rather than at the next logon; a second watcher sees the first's mutex and ends.
        spawn(powershell(), watcherArgs(command), {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        }).unref();
      } else {
        loginItem(false);
        rmSync(command.script, { force: true });
      }
    } catch (error) {
      console.error('[startup] could not', on ? 'set up' : 'remove', 'the game watcher', error);
    }
  };

  apply(settings.current().startup.with_game);
  return { stop: settings.onChange((next) => apply(next.startup.with_game)) };
}
