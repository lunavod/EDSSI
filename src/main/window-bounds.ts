/**
 * Remembers where the commander put the window. Ported from OverLooker, which learnt the hard
 * part: a monitor that isn't there any more must not strand the window off-screen.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { BrowserWindow, Rectangle } from 'electron';

import { windowBoundsPath } from './config/paths';

/** How long to wait after the last move or resize before writing the file. */
const SETTLE_MS = 300;
/** How much of the window must be on a display for that display to count as showing it. */
const VISIBLE_MARGIN = 100;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized?: boolean;
  /** What the display was scaled by when this was written, for diagnosing a bad restore. */
  scaleFactor?: number;
}

/** The part of Electron's `Display` the geometry needs; a real `Display` satisfies it. */
export interface DisplayArea {
  workArea: Rectangle;
  scaleFactor: number;
}

/** The last bounds written, or null if there are none or the file is unreadable. */
export function loadBounds(path = windowBoundsPath()): WindowBounds | null {
  try {
    if (!existsSync(path)) return null;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- isBounds checks it below.
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as WindowBounds;
    return isBounds(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveBounds(bounds: WindowBounds, path = windowBoundsPath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(bounds), 'utf8');
  } catch (error) {
    console.error('[window] could not save the window position', error);
  }
}

function isBounds(value: unknown): value is WindowBounds {
  if (typeof value !== 'object' || value === null) return false;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every field is read as unknown.
  const bounds = value as Partial<WindowBounds>;
  return (['x', 'y', 'width', 'height'] as const).every(
    (key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]),
  );
}

/**
 * Where to put a window saved at `bounds` now, given the displays that are actually connected.
 * Null when none of them can show it, so the caller falls back to its default size and lets the
 * platform place it.
 */
export function placeOnDisplay(
  bounds: WindowBounds,
  displays: readonly DisplayArea[],
): WindowBounds | null {
  const centreX = bounds.x + bounds.width / 2;
  const centreY = bounds.y + bounds.height / 2;
  const holding = displays.find(({ workArea: area }) => {
    return (
      centreX >= area.x &&
      centreX < area.x + area.width &&
      centreY >= area.y &&
      centreY < area.y + area.height
    );
  });
  if (holding) return clampToWorkArea(bounds, holding.workArea);

  // The centre is off every display — a monitor was unplugged, or the layout changed. Settle for
  // one showing a decent slice of the window.
  const showing = displays.find(({ workArea: area }) => {
    return (
      bounds.x + bounds.width > area.x + VISIBLE_MARGIN &&
      bounds.x < area.x + area.width - VISIBLE_MARGIN &&
      bounds.y + bounds.height > area.y + VISIBLE_MARGIN &&
      bounds.y < area.y + area.height - VISIBLE_MARGIN
    );
  });
  return showing ? clampToWorkArea(bounds, showing.workArea) : null;
}

/** Shrinks the window to fit the work area, then pulls it fully inside. */
export function clampToWorkArea(bounds: WindowBounds, area: Rectangle): WindowBounds {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
    width,
    height,
    maximized: bounds.maximized,
  };
}

/**
 * What to write for a window as it stands. Maximized windows report the whole screen, so the
 * restored bounds are kept instead: un-maximizing after a restart should go back where it was.
 */
export function boundsOf(
  win: Pick<BrowserWindow, 'isMaximized' | 'getBounds' | 'getNormalBounds'>,
  display: DisplayArea,
): WindowBounds {
  const maximized = win.isMaximized();
  const raw = maximized ? win.getNormalBounds() : win.getBounds();
  // Stored as Electron reports them. Position and size are both in logical pixels, on a scaled
  // display too: measured on a 150% monitor, a window made 968 wide reads back 968 wide. OverLooker
  // divided the size by the scale factor, which shrank the window by that much at every restart.
  return { ...raw, maximized, scaleFactor: display.scaleFactor };
}

/**
 * Writes the window's bounds whenever it settles, and once more as it closes so a move made in
 * the last moment isn't lost.
 */
export function rememberBounds(
  win: BrowserWindow,
  displayFor: (rect: Rectangle) => DisplayArea,
): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = (): void => {
    timer = undefined;
    if (win.isDestroyed()) return;
    saveBounds(boundsOf(win, displayFor(win.getBounds())));
  };
  const settle = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, SETTLE_MS);
  };
  win.on('resize', settle);
  win.on('move', settle);
  win.on('maximize', settle);
  win.on('unmaximize', settle);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    write();
  });
}
