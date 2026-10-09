import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';

import { IpcChannel } from '../shared/api';

/** The window is frameless, so its own title bar minimizes, maximizes and closes it. */
export function startWindowControls(): void {
  const from = (event: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender);
  ipcMain.handle(IpcChannel.WindowMinimize, (event) => from(event)?.minimize());
  ipcMain.handle(IpcChannel.WindowToggleMaximize, (event) => {
    const win = from(event);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle(IpcChannel.WindowClose, (event) => from(event)?.close());
  ipcMain.handle(IpcChannel.WindowIsMaximized, (event) => from(event)?.isMaximized() ?? false);
}

/** Tells the window's page when it is maximized or restored, so the button can show which. */
export function reportMaximized(win: BrowserWindow): void {
  const send = () => win.webContents.send(IpcChannel.WindowMaximizedChanged, win.isMaximized());
  win.on('maximize', send);
  win.on('unmaximize', send);
}
