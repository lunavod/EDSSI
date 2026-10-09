/**
 * Reads a shopping list off screenshots of the game's colonisation panel: the construction site's
 * list of commodities and how many tonnes of each it still wants. The assistant's model does the
 * reading; this file says what to ask and makes sense of the answer.
 */

import { commodityKey, knownCommodityNames, type ShoppingNeed } from '../../shared/commodities';

/** One question about some images, answered in text, with no tools. */
export type Look = (
  request: { instructions: string; text: string; images: string[] },
  signal: AbortSignal,
) => Promise<string>;

/** More than this at once is surely a mistake, and a very large request. */
export const MAX_SCREENSHOTS = 12;

const INSTRUCTIONS = `You read screenshots of Elite Dangerous's colonisation (system construction) panel.
Each one shows part of the list of commodities a construction site needs: a commodity name, and the tonnes still needed.

Answer with JSON only, no prose and no code fence, in this shape:
{"commodities":[{"name":"Steel","quantity":3084}]}

- One entry per row, with the commodity name exactly as the panel spells it.
- The quantity is a whole number of tonnes, without thousands separators.
- If a row shows several numbers (required, provided, needed), use how much is still needed.
- The screenshots may overlap, as when the list was scrolled between them: a commodity seen in more than one is still one entry.
- Leave out rows that need nothing more, headings, totals and anything that isn't a commodity row.
- If no commodity list can be read, answer {"commodities":[]}.`;

const QUESTION = 'Which commodities does the construction site still need, and how many tonnes?';

/** Asks the model to read `images` (data URLs) and answers what they list. */
export async function readScreenshots(
  look: Look,
  images: readonly string[],
  signal: AbortSignal,
): Promise<ShoppingNeed[]> {
  if (images.length === 0) throw new Error('Add a screenshot first.');
  if (images.length > MAX_SCREENSHOTS) {
    throw new Error(`That is more than ${MAX_SCREENSHOTS} screenshots; read them in batches.`);
  }
  const answer = await look(
    { instructions: INSTRUCTIONS, text: QUESTION, images: [...images] },
    signal,
  );
  const needs = parseScreenshotAnswer(answer, knownCommodityNames());
  if (needs.length === 0) throw new Error('No commodities could be read from those screenshots.');
  return needs;
}

/**
 * The model's JSON, as needs. Tolerates a code fence or words around it. Names are put in the
 * markets' spelling where one is known ("Liquid oxygen" is "Liquid Oxygen"). A commodity listed
 * twice is one row seen in two overlapping screenshots, so the larger figure is kept rather than
 * the two added up.
 */
export function parseScreenshotAnswer(text: string, knownNames: readonly string[]): ShoppingNeed[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end < start) throw new Error("The assistant's answer wasn't a list.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The assistant's answer wasn't a list.");
  }
  const rows: unknown =
    typeof parsed === 'object' && parsed !== null && 'commodities' in parsed
      ? parsed.commodities
      : undefined;
  if (!Array.isArray(rows)) throw new Error("The assistant's answer wasn't a list.");

  const spelling = new Map(knownNames.map((name) => [commodityKey(name), name]));
  const needs = new Map<string, ShoppingNeed>();
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each field is checked below
    const { name, quantity } = row as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '') continue;
    const tonnes =
      typeof quantity === 'number'
        ? quantity
        : typeof quantity === 'string'
          ? Number(quantity.replaceAll(/[\s,'_]/g, ''))
          : Number.NaN;
    if (!Number.isFinite(tonnes) || tonnes <= 0) continue;
    const key = commodityKey(name);
    if (key === '') continue;
    const commodity = spelling.get(key) ?? name.trim();
    const known = needs.get(key);
    const amount = Math.floor(tonnes);
    if (!known) needs.set(key, { commodity, quantity: amount });
    else known.quantity = Math.max(known.quantity, amount);
  }
  return [...needs.values()];
}
