/**
 * Speech from Kokoro (hexgrad's Kokoro-82M, Apache-2.0), run on the CPU by onnxruntime: free,
 * offline once its files are down, and a long way ahead of the voices Windows ships. The model is
 * the fp32 ONNX export (`onnx-community/Kokoro-82M-v1.0-ONNX`), fetched on first use into the data
 * folder at a pinned revision and checked against the hashes below; each voice is a small file of
 * style vectors, fetched the first time it is used.
 *
 * The model reads token ids, one per phoneme character (`text.ts` makes the phonemes), wrapped in
 * `$` (id 0), with the style vector for that many tokens and a speed, and answers 24 kHz mono
 * samples — the rate the windows play. A sentence is one run; runs go one at a time on a few
 * threads, which keeps a long answer ahead of the voice without taking the CPU from the game.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type * as Ort from 'onnxruntime-node';

import { isKokoroVoice, type KokoroVoice } from '../../../shared/kokoro';
import { download } from '../download';
import type { KokoroState } from './state';

const REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';

const MODEL = {
  file: 'onnx/model.onnx',
  sha256: '8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb',
  bytes: 325_532_232,
};
const TOKENIZER = {
  file: 'tokenizer.json',
  sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34',
};

/** Each English voice's file at the revision above. */
const VOICE_SHA256: Record<KokoroVoice, string> = {
  af_alloy: 'c4a6b876047fd7fb472edf4ebd63cfac7c3b958a7cae7c106e8f038ca6308c45',
  af_aoede: '4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361',
  af_bella: 'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b',
  af_heart: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b',
  af_jessica: 'a240a5e3c15b43563d6e923bdca8ef5613a23471d9b77653694012435df23bd8',
  af_kore: '9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e',
  af_nicole: 'cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a',
  af_nova: '18778272caa0d0eebaea251c35fd635f038434f9eee5e691d02a174bd328414f',
  af_river: '00a2bcf82b1d86e8f19902ede58c65ccf6c0e43b44b7d74fad54e5d8933c9c30',
  af_sarah: '4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a',
  af_sky: '4435255c9744f3f31659e0d714ab7689bf65d9e77ec1cce060f083912614f0b9',
  am_adam: '162b035ed91cfc48b6046982184c645f72edcdd1b82843347f605d7bf7b15716',
  am_echo: '3968b92c3c4cd1c4416dbded36c13eaa388a90d5788d02a13e4d781f5f8cf3c3',
  am_eric: 'e8b5be17edd1e3636901ce7598baafe2dc8dd8ff707a0c23bf9e461add7e2832',
  am_fenrir: 'c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43',
  am_liam: '52403be32fd047c6a44517cb0bcd6b134f2a18baa73e70ef41651e0eab921ade',
  am_michael: '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1',
  am_onyx: 'da5d135b424164916d75a68ffb4c2abce3d7d5ccc82dd1ee6cf447ce286145e6',
  am_puck: 'fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0',
  am_santa: '61150cf726ab6c5ed7a99f90a304f91f5a72c00c592e89ec94e5df11c319227a',
  bf_alice: '08afa6ba24da61ea5e8efa139e5aadc938d83f0a6da5a900adaf763ac1da5573',
  bf_emma: '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73',
  bf_isabella: '3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f',
  bf_lily: '5e0ee32ebe64a467124976b14e69590746f1c4ce41a12b587a50c862edfea335',
  bm_daniel: '6b3194bbceffb746733cbc22c8f593dd44e401a71d53895a2dca891bc595a1e8',
  bm_fable: 'f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1',
  bm_george: 'c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc',
  bm_lewis: 'b8f671cef828c30e66fdf0b0756a76bba58f6bb3398cbbf27058642acbcedb97',
};

/** Four is about four times real time here, and leaves the rest of the CPU to the game. */
const THREADS = 4;

/** The model's context, `$` at both ends included. */
const MAX_TOKENS = 512;

/** A voice file holds one 256-wide style vector per token count, up to 510. */
const STYLE_WIDTH = 256;
const MAX_STYLE_INDEX = 509;

/** Kokoro's own pace runs well from half speed to double. */
const MIN_SPEED = 0.5;
const MAX_SPEED = 2;

function url(file: string): string {
  return `https://huggingface.co/${REPO}/resolve/${REVISION}/${file}`;
}

/** Token ids for a string of phonemes: one per character the vocabulary knows, wrapped in `$`. */
export function tokenize(phonemes: string, vocab: ReadonlyMap<string, number>): number[] {
  const ids = [0];
  for (const char of phonemes) {
    const id = vocab.get(char);
    if (id !== undefined) ids.push(id);
  }
  return [...ids.slice(0, MAX_TOKENS - 1), 0];
}

/** The style vector a voice uses for an input of `tokens` ids. */
export function styleFor(voice: Float32Array, tokens: number): Float32Array {
  const at = STYLE_WIDTH * Math.min(Math.max(tokens - 2, 0), MAX_STYLE_INDEX);
  return voice.slice(at, at + STYLE_WIDTH);
}

/** Float samples to the 16-bit little-endian PCM the windows play. */
export function toPcm16(samples: Float32Array): Uint8Array {
  const pcm = new Uint8Array(samples.length * 2);
  const view = new DataView(pcm.buffer);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]!));
    view.setInt16(index * 2, Math.round(sample * 0x7fff), true);
  }
  return pcm;
}

interface Loaded {
  ort: typeof Ort;
  session: Ort.InferenceSession;
  vocab: Map<string, number>;
}

/**
 * The model itself. It runs only in Kokoro's own utility process (`worker.ts`): onnxruntime holds
 * a process-wide lock while it loads and runs a model, which froze every window when this ran in
 * the main process.
 */
export class KokoroEngine {
  readonly #dir: string;
  readonly #onChange: () => void;
  #state: KokoroState;
  #loaded: Loaded | undefined;
  #preparing: Promise<void> | undefined;
  #voices = new Map<KokoroVoice, Promise<Float32Array>>();
  /** One sentence runs at a time, in the order they were asked for. */
  #queue: Promise<unknown> = Promise.resolve();
  #lastReported = 0;

  /** `dir` is the data folder; Kokoro's files go in a folder of their own under it. */
  constructor(dataDir: string, onChange: () => void) {
    this.#dir = join(dataDir, 'kokoro', REVISION);
    this.#onChange = onChange;
    this.#state = existsSync(this.#path(MODEL.file)) ? { kind: 'loading' } : { kind: 'missing' };
  }

  state(): KokoroState {
    return this.#state;
  }

  /** Fetches the model if it isn't on disk, and loads it. Does nothing while that is under way. */
  prepare(): void {
    if (this.#loaded || this.#preparing) return;
    this.#preparing = this.#prepare()
      .then(() => this.#set({ kind: 'ready' }))
      .catch((error: unknown) => {
        console.error('[kokoro] setting up failed', error);
        this.#set({
          kind: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.#preparing = undefined;
      });
  }

  /** Reads `text` aloud in `voice`, handing on each sentence's PCM as it is made. */
  async speak(
    text: string,
    voice: string,
    speed: number,
    onAudio: (pcm: Uint8Array) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const loaded = this.#loaded;
    if (!loaded) throw new Error('Kokoro’s voice isn’t ready yet.');
    if (!isKokoroVoice(voice)) throw new Error(`Kokoro has no voice called ${voice}.`);

    const { toPhonemes } = await import('./text');
    const [phonemes, style] = await Promise.all([
      toPhonemes(text, voice.startsWith('a')),
      this.#voice(voice),
    ]);
    const ids = tokenize(phonemes, loaded.vocab);
    if (ids.length <= 2) return;

    const run = this.#queue.then(async () => {
      signal.throwIfAborted();
      const { ort, session } = loaded;
      const { waveform } = await session.run({
        input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
        style: new ort.Tensor('float32', styleFor(style, ids.length), [1, STYLE_WIDTH]),
        speed: new ort.Tensor(
          'float32',
          new Float32Array([Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed))]),
          [1],
        ),
      });
      return waveform?.data;
    });
    this.#queue = run.catch(() => undefined);

    const samples = await run;
    signal.throwIfAborted();
    if (samples instanceof Float32Array && samples.length > 0) onAudio(toPcm16(samples));
  }

  stop(): void {
    const loaded = this.#loaded;
    this.#loaded = undefined;
    void loaded?.session.release();
  }

  async #prepare(): Promise<void> {
    // Never a word to the owner from inside `prepare` itself, which it may call while it is still
    // setting itself up: everything from here on is reported after the call has returned.
    await Promise.resolve();
    if (!existsSync(this.#path(TOKENIZER.file))) {
      await download(url(TOKENIZER.file), this.#path(TOKENIZER.file), TOKENIZER.sha256);
    }
    if (!existsSync(this.#path(MODEL.file))) {
      this.#set({ kind: 'downloading', received: 0, total: MODEL.bytes });
      await download(url(MODEL.file), this.#path(MODEL.file), MODEL.sha256, (received, total) =>
        this.#progress(received, total ?? MODEL.bytes),
      );
    }

    this.#set({ kind: 'loading' });
    // Loaded only now, so a machine where the native module won't load loses only this voice.
    const module: typeof Ort & { default?: typeof Ort } = await import('onnxruntime-node');
    // A CommonJS module: what it exports is on `default` when imported from ESM.
    const ort = module.default ?? module;
    const session = await ort.InferenceSession.create(this.#path(MODEL.file), {
      intraOpNumThreads: THREADS,
      interOpNumThreads: 1,
      graphOptimizationLevel: 'all',
    });
    const tokenizer: unknown = JSON.parse(await readFile(this.#path(TOKENIZER.file), 'utf8'));
    this.#loaded = { ort, session, vocab: readVocab(tokenizer) };
  }

  #voice(voice: KokoroVoice): Promise<Float32Array> {
    let pending = this.#voices.get(voice);
    if (!pending) {
      const path = this.#path(`voices/${voice}.bin`);
      pending = (async () => {
        if (!existsSync(path)) {
          await download(url(`voices/${voice}.bin`), path, VOICE_SHA256[voice]);
        }
        const bytes = await readFile(path);
        return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice();
      })();
      // A failed fetch is tried again next time rather than remembered.
      pending.catch(() => this.#voices.delete(voice));
      this.#voices.set(voice, pending);
    }
    return pending;
  }

  /** Progress is reported at each whole percent, not on every chunk. */
  #progress(received: number, total: number): void {
    const percent = Math.floor((100 * received) / total);
    if (percent === this.#lastReported) return;
    this.#lastReported = percent;
    this.#set({ kind: 'downloading', received, total });
  }

  #set(state: KokoroState): void {
    this.#state = state;
    this.#onChange();
  }

  #path(file: string): string {
    return join(this.#dir, file);
  }
}

/** The character-to-id table in a Hugging Face `tokenizer.json`. */
export function readVocab(tokenizer: unknown): Map<string, number> {
  const model = field(tokenizer, 'model');
  const vocab = field(model, 'vocab');
  if (typeof vocab !== 'object' || vocab === null) throw new Error('The tokenizer has no vocab.');
  const map = new Map<string, number>();
  for (const [char, id] of Object.entries(vocab)) if (typeof id === 'number') map.set(char, id);
  return map;
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const found: unknown = Reflect.get(value, key);
  return found;
}
