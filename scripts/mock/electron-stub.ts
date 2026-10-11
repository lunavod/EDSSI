/**
 * Electron, as far as the main process's services touch it while the scenario builder runs them
 * outside Electron (scripts/build-mock-scenario.ts aliases `electron` to this): the IPC handlers
 * they register are kept, for the builder to ask what a window would.
 */

import { tmpdir } from 'node:os';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

export const handlers = new Map<string, Handler>();

/** Asks a service what a window would get over `channel`. */
export async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No service answers ${channel}`);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the caller names the channel's type
  return (await handler({ sender: undefined }, ...args)) as T;
}

export const ipcMain = {
  handle: (channel: string, handler: Handler) => void handlers.set(channel, handler),
  removeHandler: (channel: string) => void handlers.delete(channel),
  on: () => {},
};

export const BrowserWindow = { getAllWindows: () => [], fromWebContents: () => null };
export const app = { getPath: () => tmpdir(), getVersion: () => '0.0.0', isPackaged: false };
export const dialog = {};
export const shell = {};
export const clipboard = { writeText: () => {} };
