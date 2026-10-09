/**
 * Where each panel ends up, as a 3x4 transform SteamVR can take.
 *
 * The maths lives here rather than in the host so that it can be tested without a headset: the host
 * only composes what it gets with the anchor it took from the head. A panel's place is the rig's
 * offset, then the panel's own offset within the rig, then the turn that points it back at the
 * commander.
 *
 * Right-handed, the way SteamVR is: x right, y up, z back towards the eyes. A quad faces +z, so a
 * panel sitting at a negative z with no turn already faces the commander.
 */

import { effectiveSize, type PanelPlacement, type VrPanelId } from './panels';
import type { VrRig } from './rig';
import type { Seam } from './seams';

/** Row-major 3x4: the rotation in the first three columns, the position in the fourth. */
export type Matrix34 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

const IDENTITY: Matrix34 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

export function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function rotationX(degrees: number): Matrix34 {
  const [s, c] = [Math.sin(radians(degrees)), Math.cos(radians(degrees))];
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0];
}

export function rotationY(degrees: number): Matrix34 {
  const [s, c] = [Math.sin(radians(degrees)), Math.cos(radians(degrees))];
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0];
}

export function rotationZ(degrees: number): Matrix34 {
  const [s, c] = [Math.sin(radians(degrees)), Math.cos(radians(degrees))];
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0];
}

export function translation(x: number, y: number, z: number): Matrix34 {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
}

/** `outer` applied after `inner`, both affine. */
export function concat(outer: Matrix34, inner: Matrix34): Matrix34 {
  const product: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      // The fourth column is a position, so it carries the outer transform's own offset.
      let sum = column === 3 ? outer[row * 4 + 3]! : 0;
      for (let k = 0; k < 3; k++) sum += outer[row * 4 + k]! * inner[k * 4 + column]!;
      product.push(sum);
    }
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- twelve numbers, just built.
  return product as unknown as Matrix34;
}

export function concatAll(...matrices: Matrix34[]): Matrix34 {
  return matrices.reduce((left, right) => concat(left, right), IDENTITY);
}

/**
 * The turn that points a panel at the middle of the rig — which is where the commander's head is —
 * from wherever the panel has been put.
 *
 * Worked out rather than written down, so nudging a panel sideways keeps it readable instead of
 * leaving it edge-on. A panel at the middle has no direction to face and is left alone.
 */
export function aimAt(x: number, y: number, z: number): Matrix34 {
  const distance = Math.hypot(x, y, z);
  if (distance < 1e-4) return IDENTITY;

  // The panel faces +z in its own space. Turned by yaw then pitch, that face ends up pointing
  // (sin y·cos p, −sin p, cos y·cos p), and it has to equal −position/distance — the direction
  // from the panel back to the commander. Solving those three gives the two angles below.
  const yaw = Math.atan2(-x, -z);
  const pitch = Math.atan2(y, Math.hypot(x, z));
  return concat(rotationY((yaw * 180) / Math.PI), rotationX((pitch * 180) / Math.PI));
}

/** The rig's own offset from the anchor. */
function rigMatrix(rig: VrRig): Matrix34 {
  return concatAll(
    translation(rig.x, rig.y, rig.z),
    rotationY(rig.yaw),
    rotationX(rig.pitch),
    rotationZ(rig.roll),
  );
}

/** A free panel's own offset within the rig. */
function freeMatrix(placement: PanelPlacement): Matrix34 {
  return concatAll(
    translation(placement.x, placement.y, placement.z),
    placement.aim ? aimAt(placement.x, placement.y, placement.z) : IDENTITY,
    rotationY(placement.yaw),
    rotationX(placement.pitch),
    rotationZ(placement.roll),
  );
}

/**
 * Where an attached panel sits in the main panel's own frame: out to the hinge, fold about it, then
 * half the panel's own span to reach its middle.
 *
 * Only the axis a real hinge would allow: a panel on the left or right yaws about the vertical
 * seam, one above or below pitches about the horizontal one, and neither rolls. The sign of the
 * fold is what brings the far edge towards the commander rather than away from them.
 */
function hingeMatrix(
  main: PanelPlacement,
  placement: PanelPlacement,
  size: { widthMeters: number; heightMeters: number },
): Matrix34 {
  const { angle, margin } = placement;
  switch (placement.attach) {
    case 'right': {
      const hinge = main.widthMeters / 2 + margin;
      return concatAll(
        translation(hinge, 0, 0),
        rotationY(-angle),
        translation(size.widthMeters / 2, 0, 0),
      );
    }
    case 'left': {
      const hinge = main.widthMeters / 2 + margin;
      return concatAll(
        translation(-hinge, 0, 0),
        rotationY(angle),
        translation(-size.widthMeters / 2, 0, 0),
      );
    }
    case 'top': {
      const hinge = main.heightMeters / 2 + margin;
      return concatAll(
        translation(0, hinge, 0),
        rotationX(angle),
        translation(0, size.heightMeters / 2, 0),
      );
    }
    case 'bottom': {
      const hinge = main.heightMeters / 2 + margin;
      return concatAll(
        translation(0, -hinge, 0),
        rotationX(-angle),
        translation(0, -size.heightMeters / 2, 0),
      );
    }
    default:
      return IDENTITY;
  }
}

/**
 * Where one panel hangs, relative to the anchor the host took from the head. An attached panel is
 * worked out in the main panel's frame, so moving or turning the middle carries the rest with it
 * and the seams stay shut.
 */
export function panelMatrix(
  rig: VrRig,
  panels: Readonly<Record<VrPanelId, PanelPlacement>>,
  id: VrPanelId,
): Matrix34 {
  const placement = panels[id];
  const main = concat(rigMatrix(rig), freeMatrix(panels.main));
  if (placement.attach === undefined) {
    return id === 'main' ? main : concat(rigMatrix(rig), freeMatrix(placement));
  }

  return concat(main, hingeMatrix(panels.main, placement, effectiveSize(panels, id)));
}

/**
 * Where a seam's line hangs: in the gap between the main panel's edge and the panel hinged across
 * it, lying in the plane that splits the fold.
 *
 * Unlike `hingeMatrix` this places the line and then turns it where it stands, rather than folding
 * it about the hinge. The gap runs straight from the main panel's edge to the hinge the other
 * panel turns about — that hinge is where the other panel's near edge sits, whatever angle it has
 * folded to — so the middle of the gap is the midpoint of that straight run, and folding to reach
 * it would land the line on the arc instead. Turning in place by half the fold leaves it there
 * while pointing it between the two panels rather than flat against either.
 *
 * Both halves follow the main panel, so resizing or moving the middle carries the trim with it.
 */
export function seamMatrix(
  rig: VrRig,
  panels: Readonly<Record<VrPanelId, PanelPlacement>>,
  seam: Seam,
): Matrix34 {
  const main = panels.main;
  const { margin, angle } = panels[seam.owner];
  const half = angle / 2;
  const middle = concat(rigMatrix(rig), freeMatrix(main));
  // Out to the panel's edge and then half the gap: the middle of the empty space.
  const across = main.widthMeters / 2 + margin / 2;
  const above = main.heightMeters / 2 + margin / 2;

  switch (seam.edge) {
    case 'right':
      return concatAll(middle, translation(across, 0, 0), rotationY(-half));
    case 'left':
      return concatAll(middle, translation(-across, 0, 0), rotationY(half));
    case 'top':
      return concatAll(middle, translation(0, above, 0), rotationX(half));
    case 'bottom':
      return concatAll(middle, translation(0, -above, 0), rotationX(-half));
    default:
      return middle;
  }
}

/** Where a panel's middle sits, for deciding which one is being looked at. */
export function panelCentre(
  rig: VrRig,
  panels: Readonly<Record<VrPanelId, PanelPlacement>>,
  id: VrPanelId,
): [number, number, number] {
  const matrix = panelMatrix(rig, panels, id);
  return [matrix[3], matrix[7], matrix[11]];
}
