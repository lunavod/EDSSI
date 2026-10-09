/**
 * EDSSI's colours from a HUD colour. The game draws its HUD over space, so a theme can be any
 * colour at all; EDSSI draws text and lines in the accent over near-black, and fills selected
 * tabs with it, so it is kept between too dark to read and too pale to tell from white. Warnings
 * are drawn in their own colour, which has to stay clear of the accent's.
 */

const MIN_LIGHTNESS = 0.45;
/** RAPTOR's own lines sit just under it; the greys mixed from the accent were measured there. */
const MAX_LIGHTNESS = 0.76;

/** An amber that reads beside a teal accent and Elite's orange alike; red-orange beside yellow. */
const WARNING = '#ffc400';
const WARNING_BESIDE_YELLOW = '#ff4f1f';

/** "Done" and "scoopable": green beside a teal or cyan accent, teal beside anything else. */
const GOOD = '#7ce3c4';
const GOOD_BESIDE_TEAL = '#5ee87a';

interface Hsl {
  /** Degrees. */
  hue: number;
  saturation: number;
  lightness: number;
}

function parse(hex: string): Hsl | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return undefined;
  const value = Number.parseInt(match[1], 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const lightness = (max + min) / 2;
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
  let sixths = 0;
  if (chroma !== 0) {
    if (max === r) sixths = ((g - b) / chroma + 6) % 6;
    else if (max === g) sixths = (b - r) / chroma + 2;
    else sixths = (r - g) / chroma + 4;
  }
  return { hue: sixths * 60, saturation, lightness };
}

function format({ hue, saturation, lightness }: Hsl): string {
  const sixths = hue / 60;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((sixths % 2) - 1));
  const m = lightness - c / 2;
  const sector = Math.floor(sixths) % 6;
  const [r, g, b] =
    sector === 0
      ? [c, x, 0]
      : sector === 1
        ? [x, c, 0]
        : sector === 2
          ? [0, c, x]
          : sector === 3
            ? [0, x, c]
            : sector === 4
              ? [x, 0, c]
              : [c, 0, x];
  const byte = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** `#rrggbb` in, `#rrggbb` out: the same hue and saturation, lightness held in range. */
export function accentFor(hex: string): string {
  const hsl = parse(hex);
  if (!hsl) return hex;
  return format({
    ...hsl,
    lightness: Math.min(MAX_LIGHTNESS, Math.max(MIN_LIGHTNESS, hsl.lightness)),
  });
}

/**
 * The warning colour to draw beside an accent: amber, unless the accent is yellow itself, when a
 * warning in it would pass for ordinary text.
 */
export function warningFor(accent: string): string {
  const hsl = parse(accent);
  if (!hsl || hsl.saturation < 0.25) return WARNING;
  if (hsl.hue >= 42 && hsl.hue < 75) return WARNING_BESIDE_YELLOW;
  return WARNING;
}

/** The colour of things done and stars that can be scooped, kept apart from the accent's hue. */
export function goodFor(accent: string): string {
  const hsl = parse(accent);
  if (!hsl || hsl.saturation < 0.25) return GOOD;
  return hsl.hue >= 150 && hsl.hue < 200 ? GOOD_BESIDE_TEAL : GOOD;
}
