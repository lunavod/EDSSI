/**
 * The accent lines that sit in the gaps between the main panel and the ones hinged to it.
 *
 * A seam is a real quad hung in the real gap, not a rule drawn at the edge of a page: the panels
 * are separate overlays with a `margin` of empty space between them, and nothing a page paints can
 * reach into that space. So each seam is an overlay of its own, a few millimetres wide, carrying a
 * texture of one flat colour — the same accent the panels are drawn in.
 *
 * It hangs halfway along the gap, in the plane that bisects the fold, so it faces between the two
 * panels rather than lying flat against either. `seamMatrix` in `transform.ts` works that out from
 * the main panel, so a line follows the middle when it is resized, moved or folded further.
 *
 * The texture is made here rather than rendered: a window per line would cost five more Chromium
 * processes to paint a few hundred identical pixels.
 */

import type { PanelPlacement, VrPanelId } from './panels';

/** Which edge of the main panel a seam fills the gap at. */
export type SeamEdge = 'left' | 'right' | 'top' | 'bottom';

/**
 * The overlay key for a seam. Kept clear of `VR_PANEL_IDS` on purpose: the service matches the
 * host's gaze replies against the panel ids, so a seam can never become the panel a tuning key
 * acts on even if the host were to offer it.
 */
export function seamId(edge: SeamEdge): string {
  return `seam-${edge}`;
}

/**
 * What EDSSI draws a seam in when EDHM has no theme applied, or matching is off: the `--accent`
 * default in `styles.css`, so the lines match the panels either way.
 */
export const DEFAULT_ACCENT = '#ff7100';

/** How the lines look. One set for all four; they are a single piece of trim, not four choices. */
export interface SeamStyle {
  /** Whether the lines are drawn at all. */
  enabled: boolean;
  /** How thick the line is, across the gap, in metres. */
  thickness: number;
  /**
   * How much of the edge it runs along, 0 to 1, before the main panel's fade is taken off each
   * end. At 1 the line matches the backing exactly: as tall as the panels on a side seam, as wide
   * as them on a strip's, less the corners neither of them reaches. Below 1 it stops shorter still.
   */
  length: number;
  /** The overlay's own alpha, as `PanelPlacement.alpha` is for a panel. */
  alpha: number;
}

export const DEFAULT_SEAMS: SeamStyle = {
  enabled: true,
  // 2 mm: about a twelfth of a degree at the main panel's distance, which is a pixel or two on
  // the headsets of the day — a drawn line, not a filled gap. Thinner than this and the runtime's
  // own filtering has more say in how it looks than this number does.
  thickness: 0.002,
  // The whole edge, corner to corner: the line trims the panel it runs beside, so stopping short
  // of the corners leaves the arrangement looking unfinished rather than deliberately inset.
  length: 1,
  alpha: 0.9,
};

export const SEAM_LIMITS: Readonly<
  Record<keyof Omit<SeamStyle, 'enabled'>, readonly [number, number]>
> = {
  // The lower end is bounded by what a seam's texture can express; see `seamPixels`.
  thickness: [0.001, 0.08],
  length: [0.1, 1],
  alpha: [0.1, 1],
};

/** One seam: which gap it fills, whose gap it is, and how big the quad is. */
export interface Seam {
  id: string;
  edge: SeamEdge;
  /**
   * The hinged panel across the gap. Its `margin` is the width of the gap and its `angle` the fold
   * the seam has to split, so the line belongs to that panel as much as to the main one.
   */
  owner: VrPanelId;
  widthMeters: number;
  heightMeters: number;
}

/**
 * Which edge of the main panel each hinged panel occupies, when it is switched on. An edge is
 * claimed by the first panel attached to it: two panels on one edge would sit inside each other
 * anyway, and one line in that gap is all there is room for.
 */
export function seamEdges(
  panels: Readonly<Record<VrPanelId, PanelPlacement>>,
  ids: readonly VrPanelId[],
): { edge: SeamEdge; owner: VrPanelId }[] {
  const claimed: { edge: SeamEdge; owner: VrPanelId }[] = [];
  for (const id of ids) {
    const placement = panels[id];
    if (!placement.enabled || placement.attach === undefined) continue;
    if (claimed.some((seam) => seam.edge === placement.attach)) continue;
    claimed.push({ edge: placement.attach, owner: id });
  }

  return claimed;
}

/**
 * The seams to hang, given the panels that are up. A side seam runs along the main panel's height
 * and a top or bottom one along its width — the same rule `effectiveSize` applies to the panels
 * themselves — less the fade at each end.
 *
 * Less the fade because the backing does not reach the corners: it diffuses away over the last
 * `fade` metres of every edge, so a line drawn the whole span would carry on past the point where
 * there is anything left behind it and end in mid-air. Inset by that much at both ends, it stops
 * exactly where the panel stops looking like a panel. At `fade: 0` there is nothing to subtract
 * and the line runs corner to corner again.
 */
export function seamsFor(
  panels: Readonly<Record<VrPanelId, PanelPlacement>>,
  ids: readonly VrPanelId[],
  style: SeamStyle,
): Seam[] {
  if (!style.enabled) return [];
  const main = panels.main;
  if (!main.enabled) return [];

  return seamEdges(panels, ids).map(({ edge, owner }) => {
    const upright = edge === 'left' || edge === 'right';
    const along = upright ? main.heightMeters : main.widthMeters;
    const run = Math.max(0.01, along * style.length - 2 * main.fade);
    return {
      id: seamId(edge),
      edge,
      owner,
      widthMeters: upright ? style.thickness : run,
      heightMeters: upright ? run : style.thickness,
    };
  });
}

/**
 * How long the seam's texture is. SteamVR takes a quad's height from the shape of its texture, so
 * the aspect ratio is the height — it is not a choice about detail, the way a panel's density is.
 *
 * The long side is aimed at this many pixels and the thin side worked back from it, rather than
 * the other way round: a line a few hundred times longer than it is thick would otherwise need a
 * texture thousands of pixels long to keep a thin side of even one pixel.
 */
const SEAM_LONG_PIXELS = 512;

/** The texture for a seam this shape: the smallest one whose aspect ratio is the quad's. */
export function seamPixels(seam: Seam): { width: number; height: number } {
  const ratio =
    Math.max(seam.widthMeters, seam.heightMeters) / Math.min(seam.widthMeters, seam.heightMeters);
  // Never one pixel across: a texture that thin is at the mercy of whatever filtering the runtime
  // applies, and there is no reason to find out the hard way when two costs nothing. The long side
  // is worked back from whatever this comes to, so the aspect ratio — the line's length — holds.
  const thin = Math.min(64, Math.max(2, Math.round(SEAM_LONG_PIXELS / ratio)));
  const long = Math.min(4096, Math.max(2, Math.round(thin * ratio)));
  return seam.widthMeters >= seam.heightMeters
    ? { width: long, height: thin }
    : { width: thin, height: long };
}

/**
 * A texture of one flat colour, in the premultiplied BGRA an offscreen window would have painted —
 * which is what the protocol carries and what the host swizzles. Opaque, so premultiplying is the
 * identity; a seam is faded with the overlay's alpha instead, the same as a panel.
 */
export function solidFrame(width: number, height: number, colour: string): Buffer {
  const [red, green, blue] = channels(colour);
  const bitmap = Buffer.allocUnsafe(width * height * 4);
  for (let at = 0; at < bitmap.length; at += 4) {
    bitmap[at] = blue;
    bitmap[at + 1] = green;
    bitmap[at + 2] = red;
    bitmap[at + 3] = 255;
  }

  return bitmap;
}

/** `#rgb` or `#rrggbb`, falling back to the default accent rather than throwing at a bad theme. */
function channels(colour: string): [number, number, number] {
  const hex = colour.trim().replace(/^#/, '');
  const full =
    hex.length === 3
      ? hex.replaceAll(/[\da-f]/gi, (digit) => `${digit}${digit}`)
      : hex.length === 6
        ? hex
        : DEFAULT_ACCENT.slice(1);
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return channels(DEFAULT_ACCENT);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Takes whichever fields of a saved seam style are usable and defaults the rest. */
export function seamsWithDefaults(value: unknown): SeamStyle {
  if (typeof value !== 'object' || value === null) return DEFAULT_SEAMS;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every field is checked below.
  const saved = value as Partial<Record<keyof SeamStyle, unknown>>;
  const style: SeamStyle = {
    ...DEFAULT_SEAMS,
    ...(typeof saved.enabled === 'boolean' && { enabled: saved.enabled }),
  };
  for (const key of ['thickness', 'length', 'alpha'] as const) {
    const number = saved[key];
    if (typeof number !== 'number' || !Number.isFinite(number)) continue;
    const [low, high] = SEAM_LIMITS[key];
    style[key] = Math.round(Math.min(high, Math.max(low, number)) * 1e4) / 1e4;
  }

  return style;
}
