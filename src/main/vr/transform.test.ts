import { describe, expect, it } from 'vitest';

import { DEFAULT_PLACEMENTS, effectiveSize, type PanelPlacement, type VrPanelId } from './panels';
import { DEFAULT_RIG } from './rig';
import { DEFAULT_SEAMS, type Seam, seamsFor } from './seams';
import {
  aimAt,
  concat,
  type Matrix34,
  panelCentre,
  panelMatrix,
  rotationY,
  seamMatrix,
  translation,
} from './transform';

/** Where a transform sends a point. */
function apply(matrix: Matrix34, [x, y, z]: [number, number, number]): [number, number, number] {
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3],
    matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7],
    matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11],
  ];
}

/** Which way the panel's face points: its own +z, turned by the transform. */
function facing(matrix: Matrix34): [number, number, number] {
  return [matrix[2], matrix[6], matrix[10]];
}

/** The default cockpit with the main panel changed, so the attached panels have to follow. */
function withMain(over: Partial<PanelPlacement>): Record<VrPanelId, PanelPlacement> {
  return { ...DEFAULT_PLACEMENTS, main: { ...DEFAULT_PLACEMENTS.main, ...over } };
}

/** One corner of a panel, in the rig's space. */
function corner(
  panels: Record<VrPanelId, PanelPlacement>,
  id: VrPanelId,
  sx: number,
  sy: number,
): [number, number, number] {
  const size = effectiveSize(panels, id);
  return apply(panelMatrix(DEFAULT_RIG, panels, id), [
    (sx * size.widthMeters) / 2,
    (sy * size.heightMeters) / 2,
    0,
  ]);
}

/** A panel's own axes in the rig's space: right, up, and the way it faces. */
function axes(matrix: Matrix34) {
  return {
    right: [matrix[0], matrix[4], matrix[8]] as const,
    up: [matrix[1], matrix[5], matrix[9]] as const,
    facing: [matrix[2], matrix[6], matrix[10]] as const,
  };
}

/** How far apart two directions are, in degrees. */
function between(a: readonly number[], b: readonly number[]): number {
  const dot = a.reduce((sum, value, index) => sum + value * b[index]!, 0);
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

function close(a: readonly number[], b: readonly number[]): void {
  a.forEach((value, index) => expect(value).toBeCloseTo(b[index]!, 5));
}

describe('concat', () => {
  it('applies the inner transform first, then the outer', () => {
    // Turned a quarter turn about y, then moved: the move happens in the outer frame.
    const matrix = concat(translation(1, 0, 0), rotationY(90));
    expect(apply(matrix, [0, 0, 1]).map(Math.round)).toEqual([2, 0, 0]);
  });
});

describe('aimAt', () => {
  it('leaves a panel dead ahead facing the commander', () => {
    expect(facing(aimAt(0, 0, -1.4)).map((n) => Math.round(n))).toEqual([0, 0, 1]);
  });

  it('turns a panel on the right to face back inwards', () => {
    const face = facing(aimAt(1, 0, -1));
    // Facing back towards the origin means pointing left and towards the eyes.
    expect(face[0]).toBeLessThan(0);
    expect(face[2]).toBeGreaterThan(0);
  });

  it('turns a panel on the left the other way', () => {
    expect(facing(aimAt(-1, 0, -1))[0]).toBeGreaterThan(0);
  });

  it('tilts a panel above the commander downwards', () => {
    expect(facing(aimAt(0, 1, -1))[1]).toBeLessThan(0);
  });

  it('tilts one below them upwards', () => {
    expect(facing(aimAt(0, -1, -1))[1]).toBeGreaterThan(0);
  });

  it('leaves a panel with nowhere to point alone', () => {
    expect(facing(aimAt(0, 0, 0)).map(Math.round)).toEqual([0, 0, 1]);
  });
});

describe('attached panels', () => {
  const panels = DEFAULT_PLACEMENTS;

  it('gives the sides the main panel’s height and the strips its width', () => {
    expect(effectiveSize(panels, 'sidebar').heightMeters).toBe(panels.main.heightMeters);
    expect(effectiveSize(panels, 'comms').heightMeters).toBe(panels.main.heightMeters);
    expect(effectiveSize(panels, 'route').widthMeters).toBe(panels.main.widthMeters);
    expect(effectiveSize(panels, 'stats').widthMeters).toBe(panels.main.widthMeters);
  });

  it('joins each panel to the main one along a seam, a margin away', () => {
    // The sidebar's inner edge should sit exactly where the main panel's right edge is, plus the
    // margin — top and bottom both, which is what makes it a hinge rather than a single point.
    for (const sy of [1, -1]) {
      const inner = corner(panels, 'sidebar', -1, sy);
      const edge = apply(panelMatrix(DEFAULT_RIG, panels, 'main'), [
        panels.main.widthMeters / 2 + panels.sidebar.margin,
        (sy * panels.main.heightMeters) / 2,
        0,
      ]);
      close(inner, edge);
    }
  });

  it('joins the strips along their whole width too', () => {
    for (const sx of [1, -1]) {
      const inner = corner(panels, 'route', sx, -1);
      const edge = apply(panelMatrix(DEFAULT_RIG, panels, 'main'), [
        (sx * panels.main.widthMeters) / 2,
        panels.main.heightMeters / 2 + panels.route.margin,
        0,
      ]);
      close(inner, edge);
    }
  });

  it('turns a side panel only about the upright, as its hinge would allow', () => {
    // Against the main panel's own axes, not the world's: the assembly is rigid, so the main
    // panel's own tilt is carried by everything hinged to it. What a hinge forbids is turning
    // relative to the panel it is hinged to.
    const main = axes(panelMatrix(DEFAULT_RIG, panels, 'main'));
    for (const id of ['sidebar', 'comms'] as const) {
      // Yaw about the seam leaves "up" shared with the main panel; pitch or roll would tip it.
      close(axes(panelMatrix(DEFAULT_RIG, panels, id)).up, main.up);
    }
  });

  it('turns a strip only about the horizontal, as its hinge would allow', () => {
    const main = axes(panelMatrix(DEFAULT_RIG, panels, 'main'));
    for (const id of ['route', 'stats'] as const) {
      // Pitch about the seam leaves "right" shared; yaw or roll would swing it.
      close(axes(panelMatrix(DEFAULT_RIG, panels, id)).right, main.right);
    }
  });

  it('folds every panel towards the commander, never away', () => {
    for (const id of ['sidebar', 'comms', 'route', 'stats'] as const) {
      const [, , hingeZ] = corner(panels, id, id === 'sidebar' ? -1 : 1, id === 'stats' ? 1 : -1);
      const [, , centreZ] = panelCentre(DEFAULT_RIG, panels, id);
      // The far edge is nearer the eye than the seam: z runs back towards the commander.
      expect(centreZ, id).toBeGreaterThan(hingeZ - 1e-6);
    }
  });

  it('carries the attached panels when the main one is resized', () => {
    const wider = withMain({ widthMeters: 2 });
    const seam = corner(wider, 'sidebar', -1, 1);
    const edge = apply(panelMatrix(DEFAULT_RIG, wider, 'main'), [
      1 + wider.sidebar.margin,
      wider.main.heightMeters / 2,
      0,
    ]);
    close(seam, edge);
    // And the strips grow with it.
    expect(effectiveSize(wider, 'route').widthMeters).toBe(2);
  });

  it('carries them when the main one is moved, seam and all', () => {
    const moved = withMain({ x: 0.4, y: 0.2 });
    const seam = corner(moved, 'sidebar', -1, 1);
    const edge = apply(panelMatrix(DEFAULT_RIG, moved, 'main'), [
      moved.main.widthMeters / 2 + moved.sidebar.margin,
      moved.main.heightMeters / 2,
      0,
    ]);
    close(seam, edge);
  });
});

describe('seamMatrix', () => {
  const panels = DEFAULT_PLACEMENTS;
  const ids = ['main', 'sidebar', 'comms', 'route', 'stats'] as const;
  const seams = seamsFor(panels, ids, DEFAULT_SEAMS);
  const find = (edge: Seam['edge']): Seam => {
    const seam = seams.find((candidate) => candidate.edge === edge);
    if (seam === undefined) throw new Error(`no ${edge} seam`);
    return seam;
  };

  it('hangs the line inside the gap, between the main panel’s edge and the hinge', () => {
    // Measured in the main panel's own frame, where the gap is a known stretch of one axis.
    const main = panelMatrix(DEFAULT_RIG, panels, 'main');
    const edge = apply(main, [panels.main.widthMeters / 2, 0, 0]);
    const hinge = apply(main, [panels.main.widthMeters / 2 + panels.sidebar.margin, 0, 0]);
    const [x, y, z] = apply(seamMatrix(DEFAULT_RIG, panels, find('right')), [0, 0, 0]);

    const span = Math.hypot(hinge[0] - edge[0], hinge[1] - edge[1], hinge[2] - edge[2]);
    const fromEdge = Math.hypot(x - edge[0], y - edge[1], z - edge[2]);
    const fromHinge = Math.hypot(x - hinge[0], y - hinge[1], z - hinge[2]);
    expect(fromEdge).toBeLessThan(span);
    expect(fromHinge).toBeLessThan(span);
    // Halfway along it, which is what "in the middle of the gap" has to mean.
    expect(fromEdge).toBeCloseTo(fromHinge, 4);
  });

  it('lies in the plane that splits the fold, facing between the two panels', () => {
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      const seam = find(edge);
      const fold = panels[seam.owner].angle;
      const main = facing(panelMatrix(DEFAULT_RIG, panels, 'main'));
      const line = facing(seamMatrix(DEFAULT_RIG, panels, seam));
      const panel = facing(panelMatrix(DEFAULT_RIG, panels, seam.owner));
      // Half the fold from the middle panel, and half from the one across the gap.
      expect(between(line, main), edge).toBeCloseTo(fold / 2, 4);
      expect(between(line, panel), edge).toBeCloseTo(fold / 2, 4);
    }
  });

  it('runs along the seam it fills, not across it', () => {
    // A side line is upright and a strip's lies flat: its long axis is the edge it trims.
    const side = axes(seamMatrix(DEFAULT_RIG, panels, find('right')));
    const strip = axes(seamMatrix(DEFAULT_RIG, panels, find('top')));
    const main = axes(panelMatrix(DEFAULT_RIG, panels, 'main'));
    close(side.up, main.up);
    close(strip.right, main.right);
  });

  it('carries the line when the main panel is resized or moved', () => {
    for (const over of [{ widthMeters: 2 }, { x: 0.4, y: 0.2 }, { heightMeters: 1.4 }]) {
      const moved = withMain(over);
      const seam = seamsFor(moved, ids, DEFAULT_SEAMS).find(({ edge }) => edge === 'right')!;
      const main = panelMatrix(DEFAULT_RIG, moved, 'main');
      const edge = apply(main, [moved.main.widthMeters / 2, 0, 0]);
      const hinge = apply(main, [moved.main.widthMeters / 2 + moved.sidebar.margin, 0, 0]);
      const centre = apply(seamMatrix(DEFAULT_RIG, moved, seam), [0, 0, 0]);
      close(centre, [(edge[0] + hinge[0]) / 2, (edge[1] + hinge[1]) / 2, (edge[2] + hinge[2]) / 2]);
    }
  });

  it('never reaches past the corners of the edge it trims', () => {
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      const seam = find(edge);
      const along = edge === 'left' || edge === 'right' ? seam.heightMeters : seam.widthMeters;
      const span =
        edge === 'left' || edge === 'right' ? panels.main.heightMeters : panels.main.widthMeters;
      expect(along, edge).toBeLessThanOrEqual(span + 1e-9);
    }
  });
});
