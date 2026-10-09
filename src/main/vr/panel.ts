/**
 * How big the VR panel is, and how finely it is drawn.
 *
 * The panel's size is in metres, because that is the only size the commander can see. SteamVR is
 * told the quad's width (`widthMeters` on the pose) and takes its height from the shape of the
 * texture it is given — so the pixels are not a size in their own right, they are how the height is
 * expressed and how much detail there is to see. They are worked out here rather than chosen:
 * `pixelsPerMeter` fixes how crisp the panel is, and a panel made bigger simply gets more pixels
 * and shows more, instead of magnifying what it already had.
 *
 * Getting this the wrong way round is what made the size keys feel broken: changing both sides'
 * pixels together left the aspect ratio, and so the panel in the headset, almost exactly as it was.
 */

/** The half of the panel's size that isn't on the pose. Its width in metres is `pose.widthMeters`. */
export interface PanelSize {
  /** How tall the quad is, in metres. */
  heightMeters: number;
  /** How many pixels are drawn per metre: how crisp the panel is, and what each frame costs. */
  pixelsPerMeter: number;
}

/** A metre tall, at 800 px/m — which, at the default 1.6 m wide, is a 1280x800 frame. */
export const DEFAULT_PANEL: PanelSize = { heightMeters: 1, pixelsPerMeter: 800 };

/** One press. The height matches the width's step on the pose, so the two feel the same. */
export const PANEL_STEPS: Readonly<Record<keyof PanelSize, number>> = {
  heightMeters: 0.05,
  pixelsPerMeter: 40,
};

export const PANEL_LIMITS: Readonly<Record<keyof PanelSize, readonly [number, number]>> = {
  heightMeters: [0.15, 6],
  pixelsPerMeter: [200, 1600],
};

/** What a frame may be. The high ends are about cost: 2560x1600 is already a 16 MB frame. */
export const PIXEL_LIMITS = {
  width: [480, 2560],
  // 160, not 320: a strip a fifth of a metre tall has no use for more, and forcing one up to reach
  // a floor doubled its density — and, before the type was sized in metres, halved its text.
  height: [160, 1600],
} as const;

export interface PanelPixels {
  width: number;
  height: number;
}

/**
 * The frame to draw for a panel this big. The density is pulled within whatever range keeps both
 * sides inside `PIXEL_LIMITS`, which costs sharpness but leaves the aspect ratio — and so the
 * panel's height in the headset — exactly as asked for.
 */
export function panelPixels(widthMeters: number, panel: PanelSize): PanelPixels {
  const { heightMeters, pixelsPerMeter } = panel;
  const floor = Math.max(
    PIXEL_LIMITS.width[0] / widthMeters,
    PIXEL_LIMITS.height[0] / heightMeters,
  );
  const ceiling = Math.min(
    PIXEL_LIMITS.width[1] / widthMeters,
    PIXEL_LIMITS.height[1] / heightMeters,
  );
  // A panel long and thin enough for the two to cross can't have both; the ceiling wins, since it
  // is the one that is about what a frame costs.
  const density = Math.min(Math.max(pixelsPerMeter, Math.min(floor, ceiling)), ceiling);

  return {
    width: clampPixels(Math.round(widthMeters * density), PIXEL_LIMITS.width),
    height: clampPixels(Math.round(heightMeters * density), PIXEL_LIMITS.height),
  };
}

/** Changes the height or the sharpness by whole steps, clamped and rounded. */
export function adjustPanel(panel: PanelSize, side: keyof PanelSize, steps: number): PanelSize {
  const [low, high] = PANEL_LIMITS[side];
  const moved = panel[side] + PANEL_STEPS[side] * steps;
  const clamped = Math.min(high, Math.max(low, moved));
  return { ...panel, [side]: Math.round(clamped * 1e4) / 1e4 };
}

/**
 * Takes whichever fields of a saved panel are usable and defaults the rest. A panel saved as a
 * pixel size — which is what EDSSI wrote before the size was kept in metres — is converted, so a
 * commander who had found a shape they liked keeps it.
 */
export function panelWithDefaults(value: unknown, widthMeters: number): PanelSize {
  if (typeof value !== 'object' || value === null) return DEFAULT_PANEL;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every field is checked below.
  const saved = value as Partial<Record<keyof PanelSize | 'width' | 'height', unknown>>;

  if (isSize(saved.width) && isSize(saved.height) && saved.heightMeters === undefined) {
    return clampPanel({
      heightMeters: (widthMeters * saved.height) / saved.width,
      pixelsPerMeter: saved.width / widthMeters,
    });
  }

  const panel = { ...DEFAULT_PANEL };
  for (const side of ['heightMeters', 'pixelsPerMeter'] as const) {
    const number = saved[side];
    if (typeof number === 'number' && Number.isFinite(number)) panel[side] = number;
  }

  return clampPanel(panel);
}

function clampPanel(panel: PanelSize): PanelSize {
  let clamped = panel;
  for (const side of ['heightMeters', 'pixelsPerMeter'] as const) {
    const [low, high] = PANEL_LIMITS[side];
    clamped = {
      ...clamped,
      [side]: Math.round(Math.min(high, Math.max(low, clamped[side])) * 1e4) / 1e4,
    };
  }

  return clamped;
}

function clampPixels(pixels: number, [low, high]: readonly [number, number]): number {
  return Math.min(high, Math.max(low, pixels));
}

function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
