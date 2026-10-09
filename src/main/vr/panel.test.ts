import { describe, expect, it } from 'vitest';

import {
  adjustPanel,
  DEFAULT_PANEL,
  PANEL_LIMITS,
  PANEL_STEPS,
  panelPixels,
  panelWithDefaults,
  PIXEL_LIMITS,
} from './panel';
import { DEFAULT_PLACEMENTS, effectiveSize, VR_PANEL_IDS } from './panels';

/** The width every panel starts at, which is what the default frame size is worked out from. */
const WIDTH = 1.6;

describe('panelPixels', () => {
  it('draws the default panel at the size EDSSI has always used', () => {
    expect(panelPixels(WIDTH, DEFAULT_PANEL)).toEqual({ width: 1280, height: 800 });
  });

  it('gives a bigger panel more pixels, so it shows more rather than magnifying', () => {
    const taller = adjustPanel(DEFAULT_PANEL, 'heightMeters', 4);
    const pixels = panelPixels(WIDTH, taller);
    expect(pixels.width).toBe(1280);
    expect(pixels.height).toBeGreaterThan(800);
    // The pixels per metre have not changed, so nothing on the panel changes size.
    expect(pixels.height / taller.heightMeters).toBeCloseTo(DEFAULT_PANEL.pixelsPerMeter);
  });

  it('keeps the aspect ratio, which is what sets the height in the headset', () => {
    for (const heightMeters of [0.4, 1, 2.5, 4]) {
      const pixels = panelPixels(WIDTH, { ...DEFAULT_PANEL, heightMeters });
      expect((WIDTH * pixels.height) / pixels.width).toBeCloseTo(heightMeters, 1);
    }
  });

  it('keeps that aspect ratio even when the density has to be pulled back', () => {
    // Far too big to draw at 800 px/m: the density gives way, not the shape.
    const huge = { heightMeters: 5, pixelsPerMeter: 1600 };
    const pixels = panelPixels(6, huge);
    expect(pixels.width).toBeLessThanOrEqual(PIXEL_LIMITS.width[1]);
    expect(pixels.height).toBeLessThanOrEqual(PIXEL_LIMITS.height[1]);
    expect((6 * pixels.height) / pixels.width).toBeCloseTo(5, 1);
  });

  it('leaves a thin strip at the density it asked for', () => {
    // The bug this exists for: a 1.15 x 0.20 m strip was forced from 800 to 1600 px/m to reach a
    // floor of 320 pixels, which — with type then fixed in pixels — halved its text against the
    // main panel's. A strip that thin has no use for the extra pixels.
    const strip = { heightMeters: 0.2, pixelsPerMeter: 800 };
    const pixels = panelPixels(1.15, strip);
    expect(pixels.width / 1.15).toBeCloseTo(800, 0);
    expect(pixels.height / 0.2).toBeCloseTo(800, 0);
  });

  it('gives every panel of the default cockpit the same density', () => {
    // Same density means the same physical type size, which is what makes them read alike.
    const densities = VR_PANEL_IDS.map((id) => {
      const size = effectiveSize(DEFAULT_PLACEMENTS, id);
      return (
        panelPixels(size.widthMeters, { ...DEFAULT_PLACEMENTS[id], ...size }).width /
        size.widthMeters
      );
    });
    for (const density of densities) expect(density).toBeCloseTo(densities[0]!, 0);
  });

  it('never asks for a frame outside what one may cost', () => {
    for (const widthMeters of [0.2, 1.6, 8]) {
      for (const heightMeters of PANEL_LIMITS.heightMeters) {
        for (const pixelsPerMeter of PANEL_LIMITS.pixelsPerMeter) {
          const pixels = panelPixels(widthMeters, { heightMeters, pixelsPerMeter });
          expect(pixels.width).toBeGreaterThanOrEqual(PIXEL_LIMITS.width[0]);
          expect(pixels.width).toBeLessThanOrEqual(PIXEL_LIMITS.width[1]);
          expect(pixels.height).toBeGreaterThanOrEqual(PIXEL_LIMITS.height[0]);
          expect(pixels.height).toBeLessThanOrEqual(PIXEL_LIMITS.height[1]);
        }
      }
    }
  });
});

describe('adjustPanel', () => {
  it('changes one side by whole steps and leaves the other alone', () => {
    expect(adjustPanel(DEFAULT_PANEL, 'heightMeters', 2)).toEqual({
      heightMeters: DEFAULT_PANEL.heightMeters + PANEL_STEPS.heightMeters * 2,
      pixelsPerMeter: DEFAULT_PANEL.pixelsPerMeter,
    });
  });

  it('rounds, so repeated presses do not write 1.0500000000000003', () => {
    let panel = DEFAULT_PANEL;
    for (let press = 0; press < 3; press++) panel = adjustPanel(panel, 'heightMeters', 1);
    expect(panel.heightMeters).toBe(1.15);
  });

  it('clamps at both ends', () => {
    let panel = DEFAULT_PANEL;
    for (let press = 0; press < 500; press++) panel = adjustPanel(panel, 'heightMeters', 1);
    expect(panel.heightMeters).toBe(PANEL_LIMITS.heightMeters[1]);

    for (let press = 0; press < 500; press++) panel = adjustPanel(panel, 'pixelsPerMeter', -1);
    expect(panel.pixelsPerMeter).toBe(PANEL_LIMITS.pixelsPerMeter[0]);
  });
});

describe('panelWithDefaults', () => {
  it('converts a panel saved as a pixel size, keeping the shape the commander had', () => {
    // What EDSSI wrote before the panel was measured in metres.
    const panel = panelWithDefaults({ width: 800, height: 512 }, 1.6);
    expect(panel.heightMeters).toBeCloseTo(1.024);
    expect(panel.pixelsPerMeter).toBeCloseTo(500);
    expect(panelPixels(1.6, panel)).toEqual({ width: 800, height: 512 });
  });

  it('takes the sides that are usable and defaults the rest', () => {
    expect(panelWithDefaults({ heightMeters: 1.5 }, WIDTH)).toEqual({
      heightMeters: 1.5,
      pixelsPerMeter: DEFAULT_PANEL.pixelsPerMeter,
    });
  });

  it('refuses a hand-edited size that would show nothing or cost too much', () => {
    expect(panelWithDefaults({ heightMeters: 0, pixelsPerMeter: 99_999 }, WIDTH)).toEqual({
      heightMeters: PANEL_LIMITS.heightMeters[0],
      pixelsPerMeter: PANEL_LIMITS.pixelsPerMeter[1],
    });
  });

  it('defaults anything that is not a panel', () => {
    for (const value of [null, 'big', 12, { heightMeters: 'tall' }]) {
      expect(panelWithDefaults(value, WIDTH)).toEqual(DEFAULT_PANEL);
    }
  });
});
