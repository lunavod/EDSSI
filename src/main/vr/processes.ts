/**
 * Which programs are running, so the VR cockpit is only up while there is a headset and a game to
 * hang it over. `tasklist` rather than a native module: it is on every Windows, and asked once every
 * few seconds its cost is nothing.
 */

import { execFile } from 'node:child_process';

/** SteamVR's server: running from the moment SteamVR starts until it is closed. */
export const STEAMVR_PROCESS = 'vrserver.exe';

/** Elite Dangerous itself — Odyssey and Horizons alike — rather than its launcher. */
export const ELITE_PROCESS = 'elitedangerous64.exe';

/** The image names in `tasklist /FO CSV /NH`'s output, lower-cased. */
export function parseTasklist(output: string): Set<string> {
  const names = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^"([^"]+)"/.exec(line.trim());
    if (match?.[1] !== undefined) names.add(match[1].toLowerCase());
  }
  return names;
}

/**
 * The image names of every running process, lower-cased; undefined if `tasklist` couldn't be run,
 * which is not the same as nothing running.
 */
export function runningProcesses(): Promise<Set<string> | undefined> {
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FO', 'CSV', '/NH'],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => resolve(error ? undefined : parseTasklist(stdout)),
    );
  });
}

/** The Khronos loader every OpenXR program loads; the game holds it while it is in VR. */
export const OPENXR_LOADER = 'openxr_loader.dll';

/** Whether the `tasklist /M` listing has the game in it, i.e. the game has the module loaded. */
export function parseModuleTasklist(output: string): boolean {
  return parseTasklist(output).has(ELITE_PROCESS);
}

/**
 * Whether the game has the OpenXR loader loaded, i.e. is in VR through OpenXR; undefined if that
 * couldn't be found out. Asked only while the game is running, and only of the game.
 */
export function gameUsesOpenXr(): Promise<boolean | undefined> {
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FI', `IMAGENAME eq ${ELITE_PROCESS}`, '/M', OPENXR_LOADER, '/FO', 'CSV', '/NH'],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? undefined : parseModuleTasklist(stdout)),
    );
  });
}
