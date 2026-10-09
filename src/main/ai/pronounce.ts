/**
 * Rewrites an answer so the voice reads it the way a pilot would. Only what is spoken changes;
 * the text on screen stays as the model wrote it.
 */

const LETTERS: Record<string, string> = {
  a: 'ay',
  b: 'bee',
  c: 'see',
  d: 'dee',
  e: 'ee',
  f: 'eff',
  g: 'gee',
  h: 'aitch',
  i: 'eye',
  j: 'jay',
  k: 'kay',
  l: 'el',
  m: 'em',
  n: 'en',
  o: 'oh',
  p: 'pee',
  q: 'cue',
  r: 'ar',
  s: 'ess',
  t: 'tee',
  u: 'you',
  v: 'vee',
  w: 'double-you',
  x: 'ex',
  y: 'why',
  z: 'zed',
};

/**
 * A body designation: a planet's number and its moons' lowercase letters, as in "Colonia 2 h" or
 * "3 a b". Left alone, speech models read "2 h" as "two hours" and "2 a" as "two uh". Not part of a
 * decimal or a longer number, and each letter stands alone.
 */
const DESIGNATION = /(?<![\d.,])\b(\d{1,2})((?: [a-z])+)(?![\w'-])/g;

export function forSpeech(text: string): string {
  return text.replace(
    DESIGNATION,
    (_, planet: string, moons: string) =>
      `${planet} ${moons
        .trim()
        .split(' ')
        .map((letter) => LETTERS[letter] ?? letter)
        .join(' ')}`,
  );
}
