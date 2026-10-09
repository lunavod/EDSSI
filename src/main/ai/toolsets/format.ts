/** Small helpers for the one-line briefs. Tools themselves return raw numbers, with units in the
 * field name, and let the model do the phrasing. */

/** Credits, shortened the way the game shows them: 3.2 MCr, 450 kCr, 900 CR. */
export function credits(value: number): string {
  if (Math.abs(value) >= 1e9) return `${round(value / 1e9)} GCr`;
  if (Math.abs(value) >= 1e6) return `${round(value / 1e6)} MCr`;
  if (Math.abs(value) >= 1e4) return `${round(value / 1e3)} kCr`;
  return `${Math.round(value)} CR`;
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
