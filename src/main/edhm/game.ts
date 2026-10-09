/**
 * Finds the game folder EDHM is installed in. EDHM-UI already asked the commander where the game
 * is, so EDSSI reads its answer rather than asking again.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** EDHM-UI v3's own settings, where it keeps each game instance's folder. */
export function edhmUiSettingsPath(): string {
  return join(homedir(), 'EDHM_UI', 'Settings.json');
}

/** The game folders EDHM-UI knows, the active instance first, without duplicates. */
export function gameDirsFromEdhmUi(settings: unknown): string[] {
  const active = field(settings, 'ActiveInstance');
  const found: { instance: unknown; path: string }[] = [];
  for (const launcher of list(field(settings, 'GameInstances'))) {
    for (const game of list(field(launcher, 'games'))) {
      const recorded = field(game, 'path');
      // Older versions kept a list of paths here.
      const path = Array.isArray(recorded) ? list(recorded)[0] : recorded;
      if (typeof path === 'string' && path.trim() !== '') {
        found.push({ instance: field(game, 'instance'), path });
      }
    }
  }

  const ordered = [
    ...found.filter((game) => game.instance === active),
    ...found.filter((game) => game.instance !== active),
  ];
  return [...new Set(ordered.map((game) => game.path))];
}

/** A field of parsed JSON, whatever shape it turns out to be. */
function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** EDHM is installed: 3Dmigoto's `d3dx.ini`, and the folder it loads third-party mods from. */
export function hasEdhm(gameDir: string): boolean {
  const mods = join(gameDir, 'EDHM-ini', '3rdPartyMods');
  return existsSync(join(gameDir, 'd3dx.ini')) && existsSync(mods) && statSync(mods).isDirectory();
}

export type EdhmGame = { gameDir: string } | { problem: string };

export function findEdhmGame(settingsPath = edhmUiSettingsPath()): EdhmGame {
  let settings: unknown;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    return { problem: `EDHM-UI isn't installed (no ${settingsPath}).` };
  }

  const dirs = gameDirsFromEdhmUi(settings);
  if (dirs.length === 0) return { problem: 'EDHM-UI doesn’t know where the game is installed.' };
  const gameDir = dirs.find(hasEdhm);
  if (!gameDir) return { problem: `EDHM isn't installed in ${dirs.join(' or ')}.` };
  return { gameDir };
}
