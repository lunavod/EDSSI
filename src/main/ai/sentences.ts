/**
 * Splits an answer into pieces that can be spoken before the rest of it has been written.
 *
 * Waiting for the model to finish puts a second or two of silence between the text appearing and
 * the voice starting, so the first sentence is sent to the speech model as soon as it is complete.
 * Later pieces are gathered up a bit: each one costs another request, and a request that lands
 * late leaves a gap in the middle of a sentence, which is worse than starting slightly later.
 */

export interface SpeechSplit {
  /** Complete pieces, in order, ready to be spoken. */
  ready: string[];
  /** What is left over, to be added to as more text arrives. */
  rest: string;
}

/**
 * Takes whole sentences off the front of `buffer`, keeping anything shorter than `minChars` back
 * so it can join the next one. A piece is only complete when something follows its full stop:
 * while text is still streaming, a trailing "2." may yet turn into "2.4 million".
 */
export function takeSpeech(buffer: string, minChars = 1): SpeechSplit {
  const ready: string[] = [];
  let start = 0;

  for (let index = 0; index < buffer.length; index++) {
    const char = buffer[index]!;
    const next = buffer[index + 1];
    const ends =
      char === '\n' ||
      ((char === '.' || char === '!' || char === '?' || char === '…') &&
        next !== undefined &&
        /\s/.test(next));
    if (!ends) continue;

    // "38.5 light years" is one number, not two sentences.
    if (char === '.' && /\d/.test(buffer[index - 1] ?? '') && /\d/.test(next ?? '')) continue;

    const piece = buffer.slice(start, index + 1).trim();
    if (piece.length >= minChars) {
      ready.push(piece);
      start = index + 1;
    }
  }

  return { ready, rest: buffer.slice(start) };
}
