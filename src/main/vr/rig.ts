/**
 * The rig: where the whole VR cockpit hangs, and whether it is up.
 *
 * One anchor for every panel, in SteamVR's right-handed space — x right, y up, z back towards the
 * eyes, so the panels in front of the commander sit at a negative z. What each panel does with that
 * is in `panels.ts`; this is only the set as a whole.
 *
 * Kept pure and tested the way `window-bounds.ts` keeps the window's geometry. Mirrored by `Rig` in
 * `tools/vr-overlay-host/Program.cs`.
 */

export interface VrRig {
  /** Whether the cockpit is up. The host shows nothing until a panel has a texture. */
  visible: boolean;
  /**
   * `head` glues the panels to the headset, so they are always in the same place in the view.
   * `world` hangs them where the commander was looking when they were last summoned, and leaves
   * them there — which is what a cockpit wants to be, since content that follows the eyes is both
   * tiring and permanently in the way.
   */
  lock: 'head' | 'world';
  /**
   * Bumped to tell the host to pin a world-locked rig where the commander is looking now. A counter
   * rather than a command, so a message is still just a statement of how things are: the host
   * re-pins whenever this differs from the one it last acted on.
   */
  anchor: number;
  /** Where the middle of the rig sits relative to that anchor, and how it is turned. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

/**
 * Where the cockpit was tuned to hang in a headset (2026-10): a little below and out in front of
 * the anchor, on top of where the panels place themselves.
 */
export const DEFAULT_RIG: VrRig = {
  visible: true,
  lock: 'world',
  anchor: 0,
  x: 0,
  y: -0.12,
  z: -1.4,
  yaw: 0,
  pitch: 0,
  roll: 0,
};

export const RIG_AXES = ['x', 'y', 'z', 'yaw', 'pitch', 'roll'] as const satisfies readonly Exclude<
  keyof VrRig,
  'visible' | 'lock' | 'anchor'
>[];

export type RigAxis = (typeof RIG_AXES)[number];

export const RIG_STEPS: Readonly<Record<RigAxis, number>> = {
  x: 0.02,
  y: 0.02,
  z: 0.05,
  yaw: 1,
  pitch: 1,
  roll: 1,
};

export const RIG_LIMITS: Readonly<Record<RigAxis, readonly [number, number]>> = {
  x: [-4, 4],
  y: [-4, 4],
  z: [-6, 6],
  yaw: [-180, 180],
  pitch: [-180, 180],
  roll: [-180, 180],
};

export function adjustRig(rig: VrRig, axis: RigAxis, steps: number): VrRig {
  const [low, high] = RIG_LIMITS[axis];
  const moved = rig[axis] + RIG_STEPS[axis] * steps;
  return { ...rig, [axis]: round(Math.min(high, Math.max(low, moved))) };
}

/**
 * Shows or hides the cockpit. Summoning it re-pins a world-locked rig where the commander is
 * looking now, which is the whole of what world lock is for: it appears in front of them, and then
 * stays where they left it.
 */
export function toggleRig(rig: VrRig): VrRig {
  const visible = !rig.visible;
  return { ...rig, visible, anchor: visible ? rig.anchor + 1 : rig.anchor };
}

/** Pins the cockpit where the commander is looking now, without hiding it first. */
export function placeRig(rig: VrRig): VrRig {
  return { ...rig, anchor: rig.anchor + 1 };
}

/** Swaps between following the head and hanging in the world, pinning it afresh either way. */
export function toggleRigLock(rig: VrRig): VrRig {
  return { ...rig, lock: rig.lock === 'head' ? 'world' : 'head', anchor: rig.anchor + 1 };
}

/**
 * Puts the rig back where it started, leaving it shown or hidden and locked as it is — and pins it
 * afresh, so this is also how a cockpit left behind is fetched back in front of the commander.
 */
export function resetRig(rig: VrRig): VrRig {
  return { ...DEFAULT_RIG, visible: rig.visible, lock: rig.lock, anchor: rig.anchor + 1 };
}

export function rigWithDefaults(value: unknown): VrRig {
  if (typeof value !== 'object' || value === null) return DEFAULT_RIG;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every field is checked below.
  const saved = value as Partial<Record<keyof VrRig, unknown>>;
  const rig: VrRig = {
    ...DEFAULT_RIG,
    ...(typeof saved.visible === 'boolean' && { visible: saved.visible }),
    ...((saved.lock === 'head' || saved.lock === 'world') && { lock: saved.lock }),
    ...(typeof saved.anchor === 'number' &&
      Number.isFinite(saved.anchor) && { anchor: Math.max(0, Math.round(saved.anchor)) }),
  };
  for (const axis of RIG_AXES) {
    const number = saved[axis];
    if (typeof number !== 'number' || !Number.isFinite(number)) continue;
    const [low, high] = RIG_LIMITS[axis];
    rig[axis] = round(Math.min(high, Math.max(low, number)));
  }

  return rig;
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}
