/**
 * `~/.edssi/vr-overlay.json`: the whole VR cockpit — where the rig hangs, where each panel sits in
 * it, and which keys move what.
 *
 * The bindings live in the file rather than in the code because the commander is wearing a headset
 * and cannot be shown a settings screen — and because no two keyboards agree on which keys exist.
 * The file overrides the defaults rather than replacing them: every command it doesn't bind gets
 * its default key, or the file would freeze the set of bindings the day it was written and a
 * command added later would be unreachable.
 *
 * Moving and turning act on the whole rig, so summoning brings the cockpit with you. Size and
 * appearance have no meaning for a rig, so they always act on the panel being looked at. `scope`
 * switches moving and turning over to that panel too.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { isVrCommand, type VrCommand } from '../../shared/vr';
import { vrOverlayPath } from '../config/paths';
import { vrLog } from './log';
import {
  adjustPlacement,
  DEFAULT_PLACEMENTS,
  type PanelPlacement,
  type PlacementAxis,
  placementsWithDefaults,
  VR_PANEL_IDS,
  type VrPanelId,
} from './panels';
import {
  adjustRig,
  DEFAULT_RIG,
  placeRig,
  resetRig,
  rigWithDefaults,
  toggleRig,
  toggleRigLock,
  type VrRig,
} from './rig';
import { DEFAULT_SEAMS, type SeamStyle, seamsWithDefaults } from './seams';

export type VrScope = 'rig' | 'panel';

export interface VrLayout {
  rig: VrRig;
  panels: Record<VrPanelId, PanelPlacement>;
  /**
   * The accent lines in the gaps between the panels. Not a panel and not part of the rig: trim,
   * one set for all four seams. No key binds it, because there is no chord left worth spending and
   * it is set once rather than tuned in flight; edit `seams` in the file.
   */
  seams: SeamStyle;
  /** Whether moving and turning act on the rig or on the panel being looked at. */
  scope: VrScope;
  keys: Readonly<Record<string, VrCommand>>;
}

/**
 * Everything a binding can do, and the names the files write. They live in `src/shared/vr.ts`
 * because the settings screen binds the same commands to stick buttons and has to name them too;
 * re-exported here so nothing in the main process has to know that.
 */
export { isVrCommand, type VrCommand, VR_COMMAND_NAMES } from '../../shared/vr';

/** Scrolling isn't part of the layout; the service turns these into wheel events on the panel. */
export const SCROLL_COMMANDS: ReadonlySet<VrCommand> = new Set(['scrollUp', 'scrollDown']);

/** Moving or turning: the rig, unless the commander has switched to tuning one panel. */
function move(layout: VrLayout, gazed: VrPanelId, axis: PlacementAxis, steps: number): VrLayout {
  if (layout.scope === 'panel') return tune(layout, gazed, axis, steps);
  // The rig only knows about place and turn; the rest is a panel's business either way.
  if (
    axis === 'x' ||
    axis === 'y' ||
    axis === 'z' ||
    axis === 'yaw' ||
    axis === 'pitch' ||
    axis === 'roll'
  ) {
    return { ...layout, rig: adjustRig(layout.rig, axis, steps) };
  }

  return tune(layout, gazed, axis, steps);
}

/**
 * Always one panel: the one being looked at — except for the side a hinged panel doesn't own.
 *
 * A side panel is as tall as the main one and a strip as wide, so its own `heightMeters` or
 * `widthMeters` is ignored. Pressing "taller" while looking at the sidebar would otherwise do
 * nothing at all; what the commander means is that the cockpit should be taller, so the main panel
 * is what moves and the attached ones follow.
 */
function tune(layout: VrLayout, gazed: VrPanelId, axis: PlacementAxis, steps: number): VrLayout {
  const attach = layout.panels[gazed].attach;
  const shared =
    ((attach === 'left' || attach === 'right') && axis === 'heightMeters') ||
    ((attach === 'top' || attach === 'bottom') && axis === 'widthMeters');
  const target = shared ? 'main' : gazed;
  return {
    ...layout,
    panels: { ...layout.panels, [target]: adjustPlacement(layout.panels[target], axis, steps) },
  };
}

export const VR_COMMANDS: Readonly<
  Record<VrCommand, (layout: VrLayout, gazed: VrPanelId) => VrLayout>
> = {
  left: (layout, gazed) => move(layout, gazed, 'x', -1),
  right: (layout, gazed) => move(layout, gazed, 'x', 1),
  up: (layout, gazed) => move(layout, gazed, 'y', 1),
  down: (layout, gazed) => move(layout, gazed, 'y', -1),
  nearer: (layout, gazed) => move(layout, gazed, 'z', 1),
  further: (layout, gazed) => move(layout, gazed, 'z', -1),
  yawLeft: (layout, gazed) => move(layout, gazed, 'yaw', -1),
  yawRight: (layout, gazed) => move(layout, gazed, 'yaw', 1),
  pitchUp: (layout, gazed) => move(layout, gazed, 'pitch', 1),
  pitchDown: (layout, gazed) => move(layout, gazed, 'pitch', -1),
  rollLeft: (layout, gazed) => move(layout, gazed, 'roll', -1),
  rollRight: (layout, gazed) => move(layout, gazed, 'roll', 1),
  wider: (layout, gazed) => tune(layout, gazed, 'widthMeters', 1),
  narrower: (layout, gazed) => tune(layout, gazed, 'widthMeters', -1),
  taller: (layout, gazed) => tune(layout, gazed, 'heightMeters', 1),
  shorter: (layout, gazed) => tune(layout, gazed, 'heightMeters', -1),
  sharper: (layout, gazed) => tune(layout, gazed, 'pixelsPerMeter', 1),
  coarser: (layout, gazed) => tune(layout, gazed, 'pixelsPerMeter', -1),
  moreOpaque: (layout, gazed) => tune(layout, gazed, 'alpha', 1),
  lessOpaque: (layout, gazed) => tune(layout, gazed, 'alpha', -1),
  moreBackground: (layout, gazed) => tune(layout, gazed, 'background', 1),
  lessBackground: (layout, gazed) => tune(layout, gazed, 'background', -1),
  moreCurve: (layout, gazed) => tune(layout, gazed, 'curvature', 1),
  lessCurve: (layout, gazed) => tune(layout, gazed, 'curvature', -1),
  // Handled by the service, which turns them into wheel events; the layout is unchanged.
  scrollUp: (layout) => layout,
  scrollDown: (layout) => layout,
  togglePanel: (layout, gazed) => ({
    ...layout,
    panels: {
      ...layout.panels,
      [gazed]: { ...layout.panels[gazed], enabled: !layout.panels[gazed].enabled },
    },
  }),
  toggleScope: (layout) => ({ ...layout, scope: layout.scope === 'rig' ? 'panel' : 'rig' }),
  toggle: (layout) => ({ ...layout, rig: toggleRig(layout.rig) }),
  place: (layout) => ({ ...layout, rig: placeRig(layout.rig) }),
  toggleLock: (layout) => ({ ...layout, rig: toggleRigLock(layout.rig) }),
  reset: (layout) => ({
    ...layout,
    rig: resetRig(layout.rig),
    panels: { ...DEFAULT_PLACEMENTS },
    seams: { ...DEFAULT_SEAMS },
  }),
};

/**
 * The keys out of the box. Only keys every keyboard has: the arrow cluster, which can be found by
 * touch inside a headset, and punctuation under the right hand for the things that are set once.
 *
 * `Control+Shift` moves and sizes; adding `Alt` turns and reshapes. `Control+Alt` on its own is
 * deliberately avoided — with Intel graphics, `Control+Alt+Arrow` rotates the desktop.
 */
export const DEFAULT_KEYS: Readonly<Record<string, VrCommand>> = {
  'Control+Shift+Up': 'up',
  'Control+Shift+Down': 'down',
  'Control+Shift+Left': 'left',
  'Control+Shift+Right': 'right',
  'Control+Alt+Shift+Up': 'pitchUp',
  'Control+Alt+Shift+Down': 'pitchDown',
  'Control+Alt+Shift+Left': 'yawLeft',
  'Control+Alt+Shift+Right': 'yawRight',
  'Control+Alt+Shift+,': 'rollLeft',
  'Control+Alt+Shift+.': 'rollRight',
  'Control+Shift+-': 'further',
  'Control+Shift+=': 'nearer',
  'Control+Shift+[': 'narrower',
  'Control+Shift+]': 'wider',
  'Control+Alt+Shift+[': 'shorter',
  'Control+Alt+Shift+]': 'taller',
  "Control+Alt+Shift+'": 'sharper',
  'Control+Alt+Shift+;': 'coarser',
  'Control+Shift+,': 'lessOpaque',
  'Control+Shift+.': 'moreOpaque',
  'Control+Shift+;': 'lessCurve',
  "Control+Shift+'": 'moreCurve',
  'Control+Shift+9': 'lessBackground',
  'Control+Shift+0': 'moreBackground',
  'Control+Shift+PageUp': 'scrollUp',
  'Control+Shift+PageDown': 'scrollDown',
  'Control+Shift+Backspace': 'togglePanel',
  'Control+Shift+Tab': 'toggleScope',
  'Control+Shift+H': 'toggle',
  'Control+Shift+R': 'reset',
  'Control+Shift+P': 'place',
  'Control+Alt+Shift+H': 'toggleLock',
};

export const DEFAULT_LAYOUT: VrLayout = {
  rig: DEFAULT_RIG,
  panels: DEFAULT_PLACEMENTS,
  seams: DEFAULT_SEAMS,
  scope: 'rig',
  keys: DEFAULT_KEYS,
};

/**
 * The layout in the file, or nothing at all when it can't be read.
 *
 * Nothing, rather than the defaults, because this is also what the live reload reads: a file being
 * watched is caught half-written surprisingly often, and answering "the defaults" to a truncated
 * read would throw the commander's whole cockpit away for the moment it takes them to finish
 * saving. A caller starting up wants `loadLayout`, which does fall back.
 */
export function readLayout(path = vrOverlayPath()): VrLayout | undefined {
  try {
    if (!existsSync(path)) return undefined;
    return layoutWithDefaults(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
}

export function loadLayout(path = vrOverlayPath()): VrLayout {
  return readLayout(path) ?? DEFAULT_LAYOUT;
}

/**
 * Writes only what the commander has actually changed.
 *
 * Writing the lot looks friendlier — the whole cockpit there to edit — but it silently freezes
 * every default the day the file is first written. A value nobody chose, saved because everything
 * was saved, then outranks a better default forever; that caught the bindings, the panel sizes and
 * the panels' backing in turn. What is absent here follows the code, and what is present was meant.
 */
export function saveLayout(layout: VrLayout, path = vrOverlayPath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(changesFrom(layout), null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error('[vr] the overlay layout could not be saved', error);
  }
}

/** Everything in a layout that differs from the default one, and nothing that doesn't. */
export function changesFrom(layout: VrLayout): Record<string, unknown> {
  const saved: Record<string, unknown> = {};

  const rig = differing(layout.rig, DEFAULT_RIG);
  if (Object.keys(rig).length > 0) saved.rig = rig;

  const panels: Record<string, unknown> = {};
  for (const id of VR_PANEL_IDS) {
    const changed = differing(layout.panels[id], DEFAULT_PLACEMENTS[id]);
    if (Object.keys(changed).length > 0) panels[id] = changed;
  }
  if (Object.keys(panels).length > 0) saved.panels = panels;

  const seams = differing(layout.seams, DEFAULT_SEAMS);
  if (Object.keys(seams).length > 0) saved.seams = seams;

  if (layout.scope !== DEFAULT_LAYOUT.scope) saved.scope = layout.scope;

  const keys: Record<string, string> = {};
  for (const [accelerator, command] of Object.entries(layout.keys)) {
    if (DEFAULT_KEYS[accelerator] !== command) keys[accelerator] = command;
  }
  if (Object.keys(keys).length > 0) saved.keys = keys;

  return saved;
}

/** The fields of `value` that are not what `fallback` says they should be. */
function differing<T extends object>(value: T, fallback: T): Partial<T> {
  const changed: Partial<T> = {};
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] !== fallback[key]) changed[key] = value[key];
  }

  return changed;
}

export function layoutWithDefaults(value: unknown): VrLayout {
  if (typeof value !== 'object' || value === null) return DEFAULT_LAYOUT;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every field is checked below.
  const saved = value as {
    rig?: unknown;
    panels?: unknown;
    seams?: unknown;
    scope?: unknown;
    keys?: unknown;
  };
  return {
    rig: rigFrom(saved),
    panels: placementsWithDefaults(saved.panels),
    seams: seamsWithDefaults(saved.seams),
    scope: saved.scope === 'panel' ? 'panel' : 'rig',
    keys: keysWithDefaults(saved.keys),
  };
}

/**
 * A file written before the cockpit had a rig kept the single panel's pose at the top level, under
 * `pose`; reading that keeps a commander's saved position through the change.
 */
function rigFrom(saved: { rig?: unknown; pose?: unknown }): VrRig {
  return rigWithDefaults(saved.rig ?? saved.pose ?? saved);
}

/**
 * The commander's bindings, with a default key filled in for every command they haven't bound. A
 * default is only added when neither that command nor that chord is already spoken for, so
 * rebinding wins; the cost is that a binding deleted from the file comes back.
 */
function keysWithDefaults(value: unknown): Readonly<Record<string, VrCommand>> {
  if (typeof value !== 'object' || value === null) return DEFAULT_KEYS;

  const keys: Record<string, VrCommand> = {};
  for (const [accelerator, command] of Object.entries(value)) {
    if (isVrCommand(command)) keys[accelerator] = command;
    else console.error(`[vr] ${accelerator} is bound to "${String(command)}", not a command`);
  }

  const bound = new Set(Object.values(keys));
  const added: string[] = [];
  for (const [accelerator, command] of Object.entries(DEFAULT_KEYS)) {
    if (bound.has(command) || accelerator in keys) continue;
    keys[accelerator] = command;
    added.push(`${accelerator} → ${command}`);
  }

  if (added.length > 0) vrLog(`[vr] default keys added: ${added.join(', ')}`);
  return keys;
}
