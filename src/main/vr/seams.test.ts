import { describe, expect, it } from 'vitest';

import { DEFAULT_PLACEMENTS, VR_PANEL_IDS } from './panels';
import {
  DEFAULT_ACCENT,
  DEFAULT_SEAMS,
  seamPixels,
  seamsFor,
  seamsWithDefaults,
  solidFrame,
} from './seams';

describe('seamsFor', () => {
  it('gives one line to each edge a panel is hinged to', () => {
    const seams = seamsFor(DEFAULT_PLACEMENTS, VR_PANEL_IDS, DEFAULT_SEAMS);
    expect(seams.map((seam) => seam.edge).toSorted()).toEqual(['bottom', 'left', 'right', 'top']);
    expect(seams.map((seam) => seam.id)).toContain('seam-left');
  });

  it('names the panel across the gap, whose margin and fold the line has to split', () => {
    const seams = seamsFor(DEFAULT_PLACEMENTS, VR_PANEL_IDS, DEFAULT_SEAMS);
    expect(seams.find((seam) => seam.edge === 'right')?.owner).toBe('sidebar');
    expect(seams.find((seam) => seam.edge === 'top')?.owner).toBe('route');
  });

  it('runs a side line along the main panel’s height and a strip’s along its width', () => {
    // Corner to corner, once the backing has nothing left to fade: the line matches the panel.
    const flat = { ...DEFAULT_PLACEMENTS, main: { ...DEFAULT_PLACEMENTS.main, fade: 0 } };
    const whole = seamsFor(flat, VR_PANEL_IDS, { ...DEFAULT_SEAMS, length: 1 });
    const side = whole.find((seam) => seam.edge === 'right');
    const strip = whole.find((seam) => seam.edge === 'top');

    expect(side?.heightMeters).toBeCloseTo(flat.main.heightMeters, 5);
    expect(side?.widthMeters).toBeCloseTo(DEFAULT_SEAMS.thickness, 5);
    expect(strip?.widthMeters).toBeCloseTo(flat.main.widthMeters, 5);
    expect(strip?.heightMeters).toBeCloseTo(DEFAULT_SEAMS.thickness, 5);
  });

  /**
   * The backing diffuses away over the last `fade` metres of each edge, so a line that ran the
   * whole span would carry on past anything there was to draw it against.
   */
  it('stops where the backing does, a fade short of each corner', () => {
    const { main } = DEFAULT_PLACEMENTS;
    const seams = seamsFor(DEFAULT_PLACEMENTS, VR_PANEL_IDS, DEFAULT_SEAMS);
    expect(seams.find((seam) => seam.edge === 'right')?.heightMeters).toBeCloseTo(
      main.heightMeters - 2 * main.fade,
      5,
    );
    expect(seams.find((seam) => seam.edge === 'top')?.widthMeters).toBeCloseTo(
      main.widthMeters - 2 * main.fade,
      5,
    );
  });

  it('follows the fade rather than remembering a length', () => {
    const softer = {
      ...DEFAULT_PLACEMENTS,
      main: { ...DEFAULT_PLACEMENTS.main, fade: 0.05 },
    };
    const side = seamsFor(softer, VR_PANEL_IDS, DEFAULT_SEAMS).find(
      (seam) => seam.edge === 'right',
    );
    expect(side?.heightMeters).toBeCloseTo(softer.main.heightMeters - 0.1, 5);
  });

  it('leaves the gap empty where the panel across it is off', () => {
    const panels = {
      ...DEFAULT_PLACEMENTS,
      sidebar: { ...DEFAULT_PLACEMENTS.sidebar, enabled: false },
    };
    const edges = seamsFor(panels, VR_PANEL_IDS, DEFAULT_SEAMS).map((seam) => seam.edge);
    expect(edges).not.toContain('right');
    expect(edges).toContain('left');
  });

  it('draws nothing at all when the lines are switched off', () => {
    expect(
      seamsFor(DEFAULT_PLACEMENTS, VR_PANEL_IDS, { ...DEFAULT_SEAMS, enabled: false }),
    ).toEqual([]);
  });
});

describe('seamPixels', () => {
  /**
   * SteamVR takes a quad's height from the shape of its texture, so this is the line's length and
   * not a choice about detail: a texture of the wrong aspect is a line of the wrong length.
   */
  it('keeps the quad’s aspect ratio, to well within a line’s width', () => {
    for (const seam of seamsFor(DEFAULT_PLACEMENTS, VR_PANEL_IDS, DEFAULT_SEAMS)) {
      const pixels = seamPixels(seam);
      const asked = seam.widthMeters / seam.heightMeters;
      // Relative, not absolute: the ratio of a line a hundred times longer than it is thick is a
      // large number, and what matters is that its length comes out within a fraction of a percent.
      expect(Math.abs(pixels.width / pixels.height - asked) / asked).toBeLessThan(0.005);
    }
  });

  it('stays inside a texture SteamVR will take, however thin the line is set', () => {
    const seam = {
      id: 'seam-right',
      edge: 'right' as const,
      owner: 'sidebar' as const,
      widthMeters: 0.002,
      heightMeters: 6,
    };
    const pixels = seamPixels(seam);
    expect(pixels.width).toBeGreaterThanOrEqual(1);
    expect(pixels.height).toBeLessThanOrEqual(4096);
  });
});

describe('solidFrame', () => {
  it('fills the texture with the colour, as the premultiplied BGRA the protocol carries', () => {
    const bitmap = solidFrame(2, 3, '#ff7100');
    expect(bitmap.length).toBe(2 * 3 * 4);
    // BGRA: blue, green, red, alpha. Opaque, so premultiplying leaves the channels alone.
    expect([...bitmap.subarray(0, 4)]).toEqual([0x00, 0x71, 0xff, 255]);
    expect([...bitmap.subarray(20, 24)]).toEqual([0x00, 0x71, 0xff, 255]);
  });

  it('takes a short hex, and falls back rather than throwing at a colour it cannot read', () => {
    expect([...solidFrame(1, 1, '#f70').subarray(0, 3)]).toEqual([0x00, 0x77, 0xff]);
    expect([...solidFrame(1, 1, 'not a colour').subarray(0, 3)]).toEqual([
      ...solidFrame(1, 1, DEFAULT_ACCENT).subarray(0, 3),
    ]);
  });
});

describe('seamsWithDefaults', () => {
  it('takes what is there and defaults the rest', () => {
    expect(seamsWithDefaults({ thickness: 0.02 })).toEqual({ ...DEFAULT_SEAMS, thickness: 0.02 });
    expect(seamsWithDefaults(undefined)).toEqual(DEFAULT_SEAMS);
    expect(seamsWithDefaults({ enabled: false }).enabled).toBe(false);
  });

  it('clamps rather than complaining, the way every other hand-edited number does', () => {
    expect(seamsWithDefaults({ thickness: 99 }).thickness).toBe(0.08);
    expect(seamsWithDefaults({ length: -1 }).length).toBe(0.1);
    expect(seamsWithDefaults({ alpha: 'solid' }).alpha).toBe(DEFAULT_SEAMS.alpha);
  });
});
