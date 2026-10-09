/**
 * Kokoro's English voices, by the names its voice files go by: the first letter is the accent
 * (`a` American, `b` British), the second who is speaking (`f` a woman, `m` a man). The phonemes
 * are English either way, so the other languages' voices are left out.
 *
 * The model holds no voices of its own — each is a separate file of style vectors — so this list,
 * the revision EDSSI pins and the hashes in `main/ai/kokoro/kokoro.ts` go together. Names and
 * grades (Kokoro's own judgement of each voice, A to F) are from Kokoro's VOICES.md.
 */
const VOICES = {
  af_heart: { name: 'Heart', grade: 'A' },
  af_bella: { name: 'Bella', grade: 'A-' },
  af_nicole: { name: 'Nicole', grade: 'B-' },
  af_aoede: { name: 'Aoede', grade: 'C+' },
  af_kore: { name: 'Kore', grade: 'C+' },
  af_sarah: { name: 'Sarah', grade: 'C+' },
  af_alloy: { name: 'Alloy', grade: 'C' },
  af_nova: { name: 'Nova', grade: 'C' },
  af_sky: { name: 'Sky', grade: 'C-' },
  af_jessica: { name: 'Jessica', grade: 'D' },
  af_river: { name: 'River', grade: 'D' },
  am_michael: { name: 'Michael', grade: 'C+' },
  am_fenrir: { name: 'Fenrir', grade: 'C+' },
  am_puck: { name: 'Puck', grade: 'C+' },
  am_echo: { name: 'Echo', grade: 'D' },
  am_eric: { name: 'Eric', grade: 'D' },
  am_liam: { name: 'Liam', grade: 'D' },
  am_onyx: { name: 'Onyx', grade: 'D' },
  am_santa: { name: 'Santa', grade: 'D-' },
  am_adam: { name: 'Adam', grade: 'F+' },
  bf_emma: { name: 'Emma', grade: 'B-' },
  bf_isabella: { name: 'Isabella', grade: 'C' },
  bf_alice: { name: 'Alice', grade: 'D' },
  bf_lily: { name: 'Lily', grade: 'D' },
  bm_george: { name: 'George', grade: 'C' },
  bm_fable: { name: 'Fable', grade: 'C' },
  bm_lewis: { name: 'Lewis', grade: 'D+' },
  bm_daniel: { name: 'Daniel', grade: 'D' },
} as const;

export type KokoroVoice = keyof typeof VOICES;

/** Grouped by accent and speaker, the best-graded first within each. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the keys of the table above
export const KOKORO_VOICES = Object.keys(VOICES) as KokoroVoice[];

export const DEFAULT_KOKORO_VOICE: KokoroVoice = 'af_heart';

export function isKokoroVoice(name: string): name is KokoroVoice {
  return Object.hasOwn(VOICES, name);
}

/**
 * Where Kokoro's voice is in getting ready: not started (`idle`), its model not on disk yet
 * (`missing`), fetching it, loading it, or able to speak.
 */
export type KokoroState =
  | { kind: 'idle' }
  | { kind: 'missing' }
  | { kind: 'downloading'; received: number; total: number }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string };

/** "Heart — American woman (A)", for a list to choose from. */
export function kokoroVoiceLabel(voice: KokoroVoice): string {
  const { name, grade } = VOICES[voice];
  const accent = voice.startsWith('a') ? 'American' : 'British';
  const who = voice[1] === 'f' ? 'woman' : 'man';
  return `${name} — ${accent} ${who} (${grade})`;
}
