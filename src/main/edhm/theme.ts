/**
 * The HUD colour of the EDHM theme in use, so EDSSI can wear it too.
 *
 * EDHM-UI writes the theme it last applied to `EDHM-ini/ThemeSettings.json`: groups of HUD
 * elements, each colour an ARGB integer in sRGB (the `.ini` files hold the same colours as linear
 * floats). A colour only shows when its element's mode is "Custom Color"; "Elite Default" and
 * "XML" leave the game's own. No element is "the main colour", so it's the one most elements use.
 */

import { join } from 'node:path';

import type { HudColor } from '../../shared/edhm';

/** EDHM's `AdvancedMode` preset for an element drawn in its own colour. */
const CUSTOM_COLOR = 100;

export function themeSettingsPath(gameDir: string): string {
  return join(gameDir, 'EDHM-ini', 'ThemeSettings.json');
}

export function hudColorFromTheme(theme: unknown): HudColor | undefined {
  const elements = list(field(theme, 'ui_groups')).flatMap((group) =>
    list(field(group, 'Elements')),
  );

  // "Chat Panel Lines Mode" sets whether "Chat Panel Lines Color" is used.
  const modes = new Map<string, unknown>();
  for (const element of elements) {
    const title = field(element, 'Title');
    if (field(element, 'Type') === 'AdvancedMode' && typeof title === 'string') {
      modes.set(title.replace(/ Mode$/, ''), field(element, 'Value'));
    }
  }

  const counts = new Map<string, number>();
  for (const element of elements) {
    const title = field(element, 'Title');
    const value = field(element, 'Value');
    if (field(element, 'ValueType') !== 'Color' || typeof value !== 'number') continue;
    const stem = typeof title === 'string' ? title.replace(/ Colou?r$/, '') : '';
    if (modes.has(stem) && modes.get(stem) !== CUSTOM_COLOR) continue;

    const rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    if (!isAccent(rgb)) continue;
    const hex = `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
    // A Map keeps the first-seen order, so a tie goes to the element EDHM lists first.
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }

  let best: string | undefined;
  for (const [hex, count] of counts) {
    if (best === undefined || count > (counts.get(best) ?? 0)) best = hex;
  }
  if (best === undefined) return undefined;

  const name = field(field(theme, 'credits'), 'theme');
  return { color: best, theme: typeof name === 'string' && name.trim() ? name.trim() : undefined };
}

/** Greys, whites and near-blacks are backgrounds and glows, not a HUD's colour. */
function isAccent([r = 0, g = 0, b = 0]: number[]): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max >= 64 && (max - min) / max >= 0.25;
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}
