/**
 * Bringing EDSSI's window in front of the game.
 *
 * `show()`/`focus()` bottom out in SetForegroundWindow, which Windows refuses when the calling
 * process doesn't own the foreground window — it just flashes the taskbar button instead. A
 * HWND_TOPMOST Z-order change (`setAlwaysOnTop`) is *not* subject to that restriction, so we turn
 * topmost on, raise, then drop back to HWND_NOTOPMOST, which leaves the window above every normal
 * window without pinning it there. Ported from OverLooker, where it is what actually works with a
 * full-screen game in front.
 */

import { BrowserWindow } from 'electron';

/** How long topmost is held before it is released; see `surface`. */
const SETTLE_MS = 300;

/** Raises one window over whatever has the foreground, then stops being always on top. */
export function surfaceWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();

  // A window the commander pinned themselves stays pinned.
  const stickyOnTop = win.isAlwaysOnTop();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.show();
  win.moveTop();
  win.focus();

  if (stickyOnTop) return;
  // Releasing topmost synchronously can land before the compositor has applied the raise, putting
  // us back under the window we were trying to clear.
  setTimeout(() => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(false);
  }, SETTLE_MS);
}

/** Raises every EDSSI window; the app has one, but a second would deserve the same. */
export function surface(): void {
  for (const win of BrowserWindow.getAllWindows()) surfaceWindow(win);
}
