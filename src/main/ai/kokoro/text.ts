/**
 * Text to the phonemes Kokoro reads, as kokoro-js does it (github.com/hexgrad/kokoro, `kokoro.js`,
 * Apache-2.0): numbers, money and abbreviations written out, then each stretch between punctuation
 * phonemized by eSpeak NG (the `phonemizer` package), with the punctuation kept as it was — it is
 * what gives the voice its pauses — and a few of eSpeak's symbols swapped for Kokoro's.
 */

import { phonemize } from 'phonemizer';

/** "1990" → "19 90", "2:05" → "2 oh 5"; anything with a decimal point is left for `decimal`. */
function splitNumber(match: string): string {
  if (match.includes('.')) return match;
  if (match.includes(':')) {
    const [hours, minutes] = match.split(':').map(Number);
    if (minutes === 0) return `${hours} o'clock`;
    return minutes! < 10 ? `${hours} oh ${minutes}` : `${hours} ${minutes}`;
  }
  const year = Number.parseInt(match.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return match;
  const left = match.slice(0, 2);
  const right = Number.parseInt(match.slice(2, 4), 10);
  const plural = match.endsWith('s') ? 's' : '';
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${plural}`;
    if (right < 10) return `${left} oh ${right}${plural}`;
  }
  return `${left} ${right}${plural}`;
}

function money(match: string): string {
  const unit = match[0] === '$' ? 'dollar' : 'pound';
  const amount = match.slice(1);
  if (Number.isNaN(Number(amount))) return `${amount} ${unit}s`;
  if (!amount.includes('.')) return `${amount} ${unit}${amount === '1' ? '' : 's'}`;
  const [whole, fraction = ''] = amount.split('.');
  const cents = Number.parseInt(fraction.padEnd(2, '0'), 10);
  const small =
    match[0] === '$' ? (cents === 1 ? 'cent' : 'cents') : cents === 1 ? 'penny' : 'pence';
  return `${whole} ${unit}${whole === '1' ? '' : 's'} and ${cents} ${small}`;
}

function decimal(match: string): string {
  const [whole, fraction = ''] = match.split('.');
  return `${whole} point ${fraction.split('').join(' ')}`;
}

export function normalizeText(text: string): string {
  return text
    .replaceAll(/[‘’]/gu, "'")
    .replaceAll('«', '“')
    .replaceAll('»', '”')
    .replaceAll(/[“”]/gu, '"')
    .replaceAll('(', '«')
    .replaceAll(')', '»')
    .replaceAll(/[^\S \n]/gu, ' ')
    .replace(/  +/u, ' ')
    .replaceAll(/(?<=\n) +(?=\n)/gu, '')
    .replaceAll(/\bD[Rr]\.(?= [A-Z])/gu, 'Doctor')
    .replaceAll(/\b(?:Mr\.|MR\.(?= [A-Z]))/gu, 'Mister')
    .replaceAll(/\b(?:Ms\.|MS\.(?= [A-Z]))/gu, 'Miss')
    .replaceAll(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/gu, 'Mrs')
    .replaceAll(/\betc\.(?! [A-Z])/giu, 'etc')
    .replaceAll(/\b(y)eah?\b/giu, "$1e'a")
    .replaceAll(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/gu, splitNumber)
    .replaceAll(/(?<=\d),(?=\d)/gu, '')
    .replaceAll(
      /[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/giu,
      money,
    )
    .replaceAll(/\d*\.\d+/gu, decimal)
    .replaceAll(/(?<=\d)-(?=\d)/gu, ' to ')
    .replaceAll(/(?<=\d)S/gu, ' S')
    .replaceAll(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/gu, "'S")
    .replaceAll(/(?<=X')S\b/gu, 's')
    .replaceAll(/(?:[A-Za-z]\.){2,} [a-z]/gu, (match) => match.replaceAll('.', '-'))
    .replaceAll(/(?<=[A-Z])\.(?=[A-Z])/giu, '-')
    .trim();
}

/** Runs of punctuation (and the spaces around them), which pass through unphonemized. */
const PUNCTUATION = /(\s*[;:,.!?¡¿—…"«»“”(){}[\]]+\s*)+/gu;

/** The text cut into what eSpeak reads and the punctuation between, in order. */
export function splitOnPunctuation(text: string): { punctuation: boolean; text: string }[] {
  const parts: { punctuation: boolean; text: string }[] = [];
  let at = 0;
  for (const match of text.matchAll(PUNCTUATION)) {
    if (at < match.index) parts.push({ punctuation: false, text: text.slice(at, match.index) });
    if (match[0].length > 0) parts.push({ punctuation: true, text: match[0] });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ punctuation: false, text: text.slice(at) });
  return parts;
}

/** eSpeak's symbols that Kokoro was trained on differently. */
export function adjustPhonemes(phonemes: string, american: boolean): string {
  const adjusted = phonemes
    .replaceAll('kəkˈoːɹoʊ', 'kˈoʊkəɹoʊ')
    .replaceAll('kəkˈɔːɹəʊ', 'kˈəʊkəɹəʊ')
    .replaceAll('ʲ', 'j')
    .replaceAll('r', 'ɹ')
    .replaceAll('x', 'k')
    .replaceAll('ɬ', 'l')
    .replaceAll(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/gu, ' ')
    .replaceAll(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/gu, 'z');
  return (american ? adjusted.replaceAll(/(?<=nˈaɪn)ti(?!ː)/gu, 'di') : adjusted).trim();
}

/** The phonemes for `text`, in an American accent or a British one. */
export async function toPhonemes(text: string, american: boolean): Promise<string> {
  const language = american ? 'en-us' : 'en';
  const parts = await Promise.all(
    splitOnPunctuation(normalizeText(text)).map(async (part) =>
      part.punctuation ? part.text : (await phonemize(part.text, language)).join(' '),
    ),
  );
  return adjustPhonemes(parts.join(''), american);
}
