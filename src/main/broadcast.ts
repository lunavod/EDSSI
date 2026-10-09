import { BrowserWindow } from 'electron';

import type { IpcBroadcasts } from '../shared/api';

/** Sends a message to every open window. */
export function broadcast<C extends keyof IpcBroadcasts>(
  channel: C,
  payload: IpcBroadcasts[C],
): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}
