import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  boundsOf,
  clampToWorkArea,
  type DisplayArea,
  loadBounds,
  placeOnDisplay,
  saveBounds,
  type WindowBounds,
} from './window-bounds';

/** A 1920×1080 primary with the taskbar taken off, and a second monitor to its left. */
const PRIMARY: DisplayArea = {
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};
const LEFT: DisplayArea = {
  workArea: { x: -1920, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};

function bounds(overrides: Partial<WindowBounds> = {}): WindowBounds {
  return { x: 100, y: 100, width: 1280, height: 800, ...overrides };
}

/** The three calls `boundsOf` makes, as a window on the 150% monitor answers them. */
const fakeWindow = (maximized: boolean) => ({
  isMaximized: () => maximized,
  getBounds: () => ({ x: -1440, y: 0, width: 1440, height: 2512 }),
  getNormalBounds: () => ({ x: -1440, y: 482, width: 1440, height: 1256 }),
});

describe('window bounds', () => {
  it('keeps a window that is already on a display where it is', () => {
    expect(placeOnDisplay(bounds(), [PRIMARY, LEFT])).toEqual({
      x: 100,
      y: 100,
      width: 1280,
      height: 800,
      maximized: undefined,
    });
  });

  it('picks the display holding the centre, then pulls the window fully onto it', () => {
    // Straddles the seam, but its centre is on the left monitor, so that one wins and the
    // overhang into the primary is taken back — a straddling window does not stay straddled.
    const straddling = bounds({ x: -1000, y: 200 });
    expect(placeOnDisplay(straddling, [PRIMARY, LEFT])).toMatchObject({ x: -1280, y: 200 });
  });

  it('pulls a window back inside the work area it landed on', () => {
    expect(placeOnDisplay(bounds({ x: 1800, y: 900 }), [PRIMARY])).toMatchObject({
      x: 640,
      y: 240,
      width: 1280,
      height: 800,
    });
  });

  it('shrinks a window too big for the display before moving it', () => {
    const huge = bounds({ x: 0, y: 0, width: 3000, height: 2000 });
    expect(placeOnDisplay(huge, [PRIMARY])).toMatchObject({
      x: 0,
      y: 0,
      width: 1920,
      height: 1040,
    });
  });

  it('rescues a window whose display was unplugged if enough of it still shows', () => {
    // The left monitor is gone; the window's centre is off-screen but part of it is not.
    const orphan = bounds({ x: -900, y: 100 });
    expect(placeOnDisplay(orphan, [PRIMARY])).toMatchObject({ x: 0, y: 100 });
  });

  it('gives up on a window with nothing left on any display', () => {
    expect(placeOnDisplay(bounds({ x: -5000, y: -5000 }), [PRIMARY])).toBeNull();
    expect(placeOnDisplay(bounds({ x: 1900, y: 100 }), [PRIMARY])).toBeNull();
    expect(placeOnDisplay(bounds(), [])).toBeNull();
  });

  it('carries the maximized flag through, so the restore can re-maximize', () => {
    expect(placeOnDisplay(bounds({ maximized: true }), [PRIMARY])).toMatchObject({
      maximized: true,
    });
    expect(clampToWorkArea(bounds({ maximized: true }), PRIMARY.workArea)).toMatchObject({
      maximized: true,
    });
  });

  it('saves the size Electron reports, even on a scaled display', () => {
    const scaled = { workArea: { x: -1440, y: -774, width: 1440, height: 2512 }, scaleFactor: 1.5 };
    expect(boundsOf(fakeWindow(false), scaled)).toEqual({
      x: -1440,
      y: 0,
      width: 1440,
      height: 2512,
      maximized: false,
      scaleFactor: 1.5,
    });
    // Maximized, the size to come back to is the one it had before.
    expect(boundsOf(fakeWindow(true), scaled)).toMatchObject({
      y: 482,
      height: 1256,
      maximized: true,
    });
  });

  it('round-trips through the file, and shrugs off one that is missing or broken', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edssi-bounds-'));
    const path = join(dir, 'nested', 'window-bounds.json');
    expect(loadBounds(path)).toBeNull();

    saveBounds(bounds({ maximized: true, scaleFactor: 1.5 }), path);
    expect(loadBounds(path)).toEqual(bounds({ maximized: true, scaleFactor: 1.5 }));

    writeFileSync(path, 'not json at all', 'utf8');
    expect(loadBounds(path)).toBeNull();
    writeFileSync(path, '{"x":0,"y":0,"width":"wide"}', 'utf8');
    expect(loadBounds(path)).toBeNull();
  });
});
