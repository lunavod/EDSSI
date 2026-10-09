import { ipcMain } from 'electron';

import { IpcChannel } from '../shared/api';
import type { SystemExternalInfo } from '../shared/edsm';
import type { EdsmClient } from './edsm';

/** Answers windows' questions about systems from EDSM, through the client's cache. */
export function startEdsmService(client: EdsmClient): void {
  ipcMain.handle(
    IpcChannel.EdsmSystem,
    (_event, name: unknown): Promise<SystemExternalInfo> | undefined =>
      typeof name === 'string' && name !== '' ? client.system(name) : undefined,
  );
}
