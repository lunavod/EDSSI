import { describe, expect, it, vi } from 'vitest';

import {
  loginItemArgs,
  STARTED_BY_GAME_FLAG,
  startedByGame,
  watcherArgs,
  watcherNames,
} from './start-with-game';
import script from './start-with-game.ps1?raw';

vi.mock('electron', () => ({ app: {} }));

const command = {
  script: 'C:\\Users\\Cmdr Jameson\\AppData\\Roaming\\EDSSI\\start-with-game.ps1',
  app: 'C:\\Users\\Cmdr Jameson\\AppData\\Local\\Programs\\EDSSI\\edssi.exe',
  mutex: 'Local\\EDSSI-start-with-game',
};

describe('the start-with-game watcher', () => {
  it('runs the script hidden, naming the exe and the mutex', () => {
    expect(watcherArgs(command)).toEqual([
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
    ]);
  });

  it('quotes the paths with spaces for the Run key', () => {
    const args = loginItemArgs(command);
    expect(args).toContain(`"${command.script}"`);
    expect(args).toContain(`"${command.app}"`);
    expect(args).toContain(command.mutex);
    expect(args).toContain('-File');
  });

  it('names the startup app and mutex per build', () => {
    expect(watcherNames('EDSSI')).toEqual({
      loginItem: 'EDSSI start with game',
      mutex: 'Local\\EDSSI-start-with-game',
    });
    expect(watcherNames('EDSSI Dev').mutex).toBe('Local\\EDSSIDev-start-with-game');
  });

  it('knows an EDSSI it started', () => {
    expect(startedByGame(['edssi.exe', STARTED_BY_GAME_FLAG])).toBe(true);
    expect(startedByGame(['edssi.exe'])).toBe(false);
  });

  it('passes the flag the app looks for', () => {
    expect(script).toContain(`[string]$Flag = '${STARTED_BY_GAME_FLAG}'`);
  });

  it('is plain ASCII, as Windows PowerShell reads a script with no BOM in the ANSI code page', () => {
    // oxlint-disable-next-line no-control-regex -- ASCII is the point
    expect(script).toMatch(/^[\x00-\x7f]*$/u);
  });
});
