/**
 * The panels the VR cockpit is made of, and where each one sits.
 *
 * The set hangs as a rig: one anchor — the commander's eye point when it was last pinned — and each
 * panel placed relative to that. Summoning the cockpit brings the whole layout, rather than five
 * windows that have to be found and placed one at a time.
 *
 * The four outer panels are `attach`ed to the main one, as though hinged along its edges: the side
 * panels share its height and hang off its left and right edges, the strips share its width and
 * hang off its top and bottom. Each folds towards the commander about that hinge, and only about
 * the axis the hinge would allow — a side panel yaws, a strip pitches, neither rolls.
 *
 * Attached panels are worked out from the main panel rather than written down, so resizing the
 * middle carries the rest with it and the seams stay shut. `yaw`/`pitch`/`roll` and `x`/`y`/`z` are
 * ignored while a panel is attached; `angle` and `margin` are what shape the arrangement.
 */

import { DEFAULT_PANEL, type PanelSize } from './panel';

export const VR_PANEL_IDS = ['main', 'sidebar', 'comms', 'route', 'stats'] as const;
export type VrPanelId = (typeof VR_PANEL_IDS)[number];

export interface PanelPlacement extends PanelSize {
  /** A panel that is off is neither drawn nor given an overlay. */
  enabled: boolean;
  /** Metres from the middle of the rig: x right, y up, z back towards the commander. */
  x: number;
  y: number;
  z: number;
  /**
   * Which edge of the main panel this one is hinged to, if any. The main panel itself is free, and
   * a panel set free again keeps `x`/`y`/`z` and its own angles.
   */
  attach?: 'left' | 'right' | 'top' | 'bottom';
  /** The gap left at the hinge, in metres, so the panels don't quite touch. */
  margin: number;
  /** How far the panel folds towards the commander about its hinge, in degrees. */
  angle: number;
  /** Turn a free panel to face the middle of the rig. Ignored while it is attached. */
  aim: boolean;
  /** Extra turn, in degrees, on top of the aim. */
  yaw: number;
  pitch: number;
  roll: number;
  /** How wide the quad is in metres; its height is `heightMeters`, inherited from `PanelSize`. */
  widthMeters: number;
  alpha: number;
  /**
   * How solid the panel's own backing is, behind the text. Not the same as `alpha`, which fades the
   * whole quad, text and all: this darkens what is behind the words while leaving them as bright.
   *
   * A panel that carries no slab of its own spends it on whatever backing it does have instead —
   * the strips have none, so theirs sets how solid each of their cells is. Either way it is the
   * one number for "how much of the cockpit does this panel hide", which is what it is reached
   * for; see `.vr-panel` in `styles.css`.
   */
  background: number;
  /**
   * How far the backing fades out before the panel's edge, in metres. A slab that simply stops
   * draws a hard rectangle across the cockpit; fading the last centimetre or two of it leaves the
   * words as bright as they were and lets the panel end in the starfield rather than against it.
   *
   * In metres because the panels are drawn at whatever density their size works out to, exactly as
   * the type is: a fade fixed in pixels would be twice as wide on a strip as on the main panel.
   */
  fade: number;
  /** 0 is flat; a little curve helps on the wide panels. */
  curvature: number;
}

/** What every panel starts from; the layout below only says how each one differs. */
const PANEL_BASE: PanelPlacement = {
  ...DEFAULT_PANEL,
  enabled: true,
  x: 0,
  y: -0.12,
  z: -1.4,
  aim: true,
  margin: 0.04,
  angle: 30,
  yaw: 0,
  pitch: 0,
  roll: 0,
  widthMeters: 1.6,
  alpha: 1,
  background: 0.9,
  fade: 0.02,
  curvature: 0,
};

/**
 * The cockpit: the mission in front, the side panel and comms to either hand, and the route and
 * the session's takings as strips above and below. The side panels are pulled closer than the main
 * one so that turning to them is a turn of the head rather than of the whole body.
 *
 * The sizes are chosen so that nothing touches anything else. `npm run vr:preview` draws the lot,
 * and the first thing it showed was a closed box: a main panel 1.6 m wide at 1.4 m subtends about
 * 60°, which crowded everything else into the periphery and left no cockpit visible between the
 * panels. 1.15 m at 1.45 m is about 43°, which reads comfortably and leaves gaps of a few degrees
 * all round.
 */
/**
 * The sizes and backings are the ones the cockpit was tuned to in a headset (2026-10), so a new
 * install starts there rather than at guesses: a big main panel well out in front, side panels
 * at its full height, and slabs all but opaque.
 */
export const DEFAULT_PLACEMENTS: Readonly<Record<VrPanelId, PanelPlacement>> = {
  main: { ...PANEL_BASE, widthMeters: 1.85, heightMeters: 1.3, background: 0.99 },
  // The sides take the main panel's height, the strips its width; only the other side is theirs.
  sidebar: { ...PANEL_BASE, attach: 'right', widthMeters: 0.8, angle: 38, background: 0.98 },
  comms: { ...PANEL_BASE, attach: 'left', widthMeters: 0.8, angle: 38, background: 0.99 },
  // The route shows three lines under its heading; at a readable size in the headset they want
  // this much. No slab of their own: the cells inside are already tinted, and a black rectangle
  // behind a strip of numbers is just a bar across the cockpit. `background` is spent on those
  // cells instead, so the strips answer the same key as everything else.
  route: {
    ...PANEL_BASE,
    attach: 'top',
    heightMeters: 0.35,
    margin: 0.03,
    angle: 22,
    background: 0.98,
  },
  stats: {
    ...PANEL_BASE,
    attach: 'bottom',
    heightMeters: 0.25,
    margin: 0.03,
    angle: 22,
    background: 0.98,
  },
};

/**
 * A panel's size once its attachment has had its say: a side panel is as tall as the main one and a
 * strip as wide, because a hinge runs the whole length of the edge it is on.
 */
export function effectiveSize(
  panels: Readonly<Record<VrPanelId, PanelPlacement>>,
  id: VrPanelId,
): { widthMeters: number; heightMeters: number } {
  const placement = panels[id];
  const main = panels.main;
  if (placement.attach === 'left' || placement.attach === 'right') {
    return { widthMeters: placement.widthMeters, heightMeters: main.heightMeters };
  }
  if (placement.attach === 'top' || placement.attach === 'bottom') {
    return { widthMeters: main.widthMeters, heightMeters: placement.heightMeters };
  }

  return { widthMeters: placement.widthMeters, heightMeters: placement.heightMeters };
}

/** How far one press moves a panel. The same feel as the rig's, so neither surprises the other. */
export const PLACEMENT_STEPS = {
  x: 0.02,
  y: 0.02,
  z: 0.05,
  yaw: 1,
  pitch: 1,
  roll: 1,
  angle: 1,
  margin: 0.005,
  widthMeters: 0.05,
  heightMeters: 0.05,
  pixelsPerMeter: 40,
  alpha: 0.05,
  background: 0.05,
  fade: 0.005,
  curvature: 0.02,
} as const satisfies Partial<Record<keyof PanelPlacement, number>>;

export type PlacementAxis = keyof typeof PLACEMENT_STEPS;

/** Every axis a key can move. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the keys of PLACEMENT_STEPS.
export const PLACEMENT_AXES = Object.keys(PLACEMENT_STEPS) as readonly PlacementAxis[];

export const PLACEMENT_LIMITS: Readonly<Record<PlacementAxis, readonly [number, number]>> = {
  x: [-4, 4],
  y: [-4, 4],
  z: [-10, -0.2],
  yaw: [-180, 180],
  pitch: [-180, 180],
  roll: [-180, 180],
  // A hinge that folded past a right angle would put the panel behind the main one.
  angle: [0, 85],
  margin: [0, 0.4],
  widthMeters: [0.2, 8],
  heightMeters: [0.15, 6],
  pixelsPerMeter: [200, 1600],
  alpha: [0.1, 1],
  background: [0, 1],
  // Half a panel's smallest sensible span: past that the fades from opposite edges meet and the
  // backing never reaches full strength anywhere.
  fade: [0, 0.08],
  curvature: [0, 1],
};

/** Moves one axis of one panel by whole steps, clamped and rounded. */
export function adjustPlacement(
  placement: PanelPlacement,
  axis: PlacementAxis,
  steps: number,
): PanelPlacement {
  const [low, high] = PLACEMENT_LIMITS[axis];
  const moved = placement[axis] + PLACEMENT_STEPS[axis] * steps;
  return { ...placement, [axis]: round(Math.min(high, Math.max(low, moved))) };
}

/** Takes whichever fields of a saved placement are usable and defaults the rest. */
export function placementWithDefaults(value: unknown, id: VrPanelId): PanelPlacement {
  const base = DEFAULT_PLACEMENTS[id];
  if (typeof value !== 'object' || value === null) return base;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every field is checked below.
  const saved = value as Partial<Record<keyof PanelPlacement, unknown>>;

  const placement: PanelPlacement = {
    ...base,
    ...(typeof saved.enabled === 'boolean' && { enabled: saved.enabled }),
    ...(typeof saved.aim === 'boolean' && { aim: saved.aim }),
    ...(saved.attach === 'left' ||
    saved.attach === 'right' ||
    saved.attach === 'top' ||
    saved.attach === 'bottom'
      ? { attach: saved.attach }
      : {}),
  };
  for (const axis of PLACEMENT_AXES) {
    const number = saved[axis];
    if (typeof number !== 'number' || !Number.isFinite(number)) continue;
    const [low, high] = PLACEMENT_LIMITS[axis];
    placement[axis] = round(Math.min(high, Math.max(low, number)));
  }

  return placement;
}

export function placementsWithDefaults(value: unknown): Record<VrPanelId, PanelPlacement> {
  const saved = typeof value === 'object' && value !== null ? value : {};
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- read one key at a time below.
  const byId = saved as Partial<Record<VrPanelId, unknown>>;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- built from VR_PANEL_IDS.
  return Object.fromEntries(
    VR_PANEL_IDS.map((id) => [id, placementWithDefaults(byId[id], id)]),
  ) as Record<VrPanelId, PanelPlacement>;
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}
