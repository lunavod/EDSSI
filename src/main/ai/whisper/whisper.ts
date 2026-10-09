/**
 * Listening on this machine, with whisper.cpp (MIT): its own Windows build (the OpenBLAS one, about
 * half again as fast on a CPU as the plain one) and a ggml model, both fetched on first use into the
 * data folder at pinned versions and checked by SHA-256. EDSSI keeps whisper.cpp's `whisper-server`
 * running with the model loaded, on a port of its own on 127.0.0.1, and posts each question to it
 * as a 16 kHz WAV — so a question costs only the transcribing, not loading the model again.
 */

import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { WhisperModel } from '../../../shared/whisper';
import { download } from '../download';

const BUILD = {
  tag: 'b5130',
  file: 'whisper-blas-bin-x64.zip',
  sha256: '55c06d09e8b9b6cfb2b0b47ddedc71803054f0e48be1f41848b3141c06c703a9',
  bytes: 21_400_000,
};

const MODEL_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';

const MODELS: Record<WhisperModel, { sha256: string; bytes: number }> = {
  'tiny.en': {
    sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f',
    bytes: 77_704_715,
  },
  'base.en': {
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
    bytes: 147_964_211,
  },
  'small.en': {
    sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d',
    bytes: 487_614_201,
  },
  'medium.en-q5_0': {
    sha256: '76733e26ad8fe1c7a5bf7531a9d41917b2adc0f20f2e4f5531688a8c6cd88eb0',
    bytes: 539_225_533,
  },
  'large-v3-turbo-q5_0': {
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    bytes: 574_041_195,
  },
};

/** How long a freshly started server gets to load its model and start answering. */
const START_TIMEOUT_MS = 60_000;

/** Windows' own tar, which (unlike Git's) reads zip files. */
const TAR = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');

export type WhisperState =
  | { kind: 'idle' }
  | { kind: 'downloading'; what: string; received: number; total: number }
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string };

export interface WhisperOptions {
  model: WhisperModel;
  threads: number;
}

interface Running {
  options: WhisperOptions;
  process: ChildProcess;
  port: number;
}

export class LocalWhisper {
  readonly #dir: string;
  readonly #onChange: () => void;
  #state: WhisperState = { kind: 'idle' };
  #running: Running | undefined;
  /** What `prepare` was last asked for, which is what a finished setup checks it still wants. */
  #wanted: WhisperOptions | undefined;
  #preparing: Promise<void> | undefined;
  #lastReported = -1;

  constructor(dataDir: string, onChange: () => void) {
    this.#dir = join(dataDir, 'whisper');
    this.#onChange = onChange;
  }

  static supported(): boolean {
    return process.platform === 'win32' && process.arch === 'x64';
  }

  state(): WhisperState {
    return this.#state;
  }

  /** What Comms should say about listening while it isn't ready; nothing once it is. */
  note(): string | undefined {
    const state = this.#state;
    switch (state.kind) {
      case 'idle':
      case 'starting':
        return 'Whisper is getting ready to listen.';
      case 'downloading': {
        const percent = Math.floor((100 * state.received) / state.total);
        const mb = Math.round(state.total / 1_000_000);
        return `Downloading ${state.what} for listening: ${percent}% of ${mb} MB.`;
      }
      case 'failed':
        return `Whisper couldn’t be set up: ${state.message}`;
      default:
        return undefined;
    }
  }

  /**
   * Fetches what is missing and starts the server, or restarts it on another model or thread
   * count. Asking again for what is running, or being set up, does nothing.
   */
  prepare(options: WhisperOptions): void {
    if (!LocalWhisper.supported()) {
      this.#set({ kind: 'failed', message: 'whisper.cpp is only set up for 64-bit Windows.' });
      return;
    }
    // The same settings saved again are the same request, not a new one to start over for.
    if (!same(this.#wanted, options)) this.#wanted = options;
    if (this.#running && same(this.#running.options, options)) return;
    if (this.#preparing) return;
    let failed = false;
    this.#preparing = this.#prepare(this.#wanted!)
      .catch((error: unknown) => {
        if (error instanceof Superseded) return;
        failed = true;
        console.error('[whisper] setting up failed', error);
        this.#set({
          kind: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.#preparing = undefined;
        // The settings changed while this was under way: catch up. A failure waits for the next
        // change of settings rather than trying again straight away.
        const wanted = this.#wanted;
        if (wanted && !failed && !same(this.#running?.options, wanted)) this.prepare(wanted);
      });
  }

  /** Text from a 16 kHz mono WAV. `prompt` is what the model is told it will hear. */
  async transcribe(
    wav: Uint8Array,
    prompt: string,
    language: string | undefined,
    signal: AbortSignal,
  ): Promise<string> {
    const running = this.#running;
    if (!running || this.#state.kind !== 'ready') throw new Error('Whisper isn’t ready yet.');
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(wav)], { type: 'audio/wav' }), 'speech.wav');
    form.append('response_format', 'json');
    form.append('temperature', '0');
    form.append('language', language ?? 'auto');
    form.append('prompt', prompt);
    const response = await fetch(`http://127.0.0.1:${running.port}/inference`, {
      method: 'POST',
      body: form,
      signal,
    });
    const answer: unknown = await response.json().catch(() => undefined);
    const text =
      typeof answer === 'object' && answer !== null && 'text' in answer ? answer.text : undefined;
    if (!response.ok || typeof text !== 'string') {
      throw new Error(`Whisper couldn’t transcribe that (${response.status}).`);
    }
    return text.trim();
  }

  /** Stops the server, and any setup under way, which then starts nothing. */
  stop(): void {
    this.#wanted = undefined;
    this.#running?.process.kill();
    this.#running = undefined;
    // Stopping what never started says nothing.
    if (this.#state.kind !== 'failed' && this.#state.kind !== 'idle') this.#set({ kind: 'idle' });
  }

  async #prepare(options: WhisperOptions): Promise<void> {
    // As with Kokoro: nothing is reported until `prepare` has returned to its caller.
    await Promise.resolve();
    // Each step can take a while; what was asked for may have changed, or been stopped, by the end.
    const stillWanted = (): void => {
      if (this.#wanted !== options) throw new Superseded();
    };
    const server = await this.#install();
    stillWanted();
    const model = await this.#model(options.model);
    stillWanted();

    this.#set({ kind: 'starting' });
    this.#running?.process.kill();
    this.#running = undefined;
    const port = await freePort();
    stillWanted();
    const child = spawn(
      server,
      // No timestamps: they are of no use for one spoken question.
      [
        '-m',
        model,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '-t',
        String(options.threads),
        '-nt',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
    );
    let stderr = '';
    child.stderr?.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString('utf8')).slice(-4000);
    });
    const running: Running = { options, process: child, port };
    this.#running = running;
    child.on('exit', (code) => {
      if (this.#running !== running) return;
      this.#running = undefined;
      console.error('[whisper] the server stopped', code, stderr);
      this.#set({
        kind: 'failed',
        message: `whisper-server stopped (exit code ${code ?? 'none'}).`,
      });
    });

    try {
      await waitUntilAnswering(port, child);
    } catch (error) {
      // Stopped, or replaced, while it was starting: that is not a failure.
      if (this.#running !== running) throw new Superseded();
      throw error;
    }
    if (this.#running !== running) throw new Superseded();
    this.#set({ kind: 'ready' });
  }

  /** whisper.cpp's Windows build, unzipped; its server's path. */
  async #install(): Promise<string> {
    const folder = join(this.#dir, BUILD.tag);
    const server = join(folder, 'Release', 'whisper-server.exe');
    if (existsSync(server)) return server;
    const zip = join(folder, BUILD.file);
    await download(
      `https://github.com/ggml-org/whisper.cpp/releases/download/${BUILD.tag}/${BUILD.file}`,
      zip,
      BUILD.sha256,
      (received, total) => this.#progress('whisper.cpp', received, total ?? BUILD.bytes),
    );
    await promisify(execFile)(TAR, ['-xf', zip, '-C', folder], { windowsHide: true });
    await rm(zip, { force: true });
    if (!existsSync(server)) throw new Error('The whisper.cpp download has no whisper-server.exe.');
    return server;
  }

  async #model(model: WhisperModel): Promise<string> {
    const path = join(this.#dir, 'models', `ggml-${model}.bin`);
    if (existsSync(path)) return path;
    const { sha256, bytes } = MODELS[model];
    await download(
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}/ggml-${model}.bin`,
      path,
      sha256,
      (received, total) => this.#progress(`Whisper ${model}`, received, total ?? bytes),
    );
    return path;
  }

  #progress(what: string, received: number, total: number): void {
    const percent = Math.floor((100 * received) / total);
    if (percent === this.#lastReported) return;
    this.#lastReported = percent;
    this.#set({ kind: 'downloading', what, received, total });
  }

  #set(state: WhisperState): void {
    this.#state = state;
    this.#onChange();
  }
}

function same(a: WhisperOptions | undefined, b: WhisperOptions): boolean {
  return a !== undefined && a.model === b.model && a.threads === b.threads;
}

/** A port nothing is listening on, from the system. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('No free port.'))));
    });
  });
}

async function waitUntilAnswering(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // Killed shows as a signal rather than an exit code.
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('whisper-server stopped while starting.');
    }
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error('whisper-server didn’t start in time.');
}

/** A setup that was no longer wanted by the time it got somewhere. */
class Superseded extends Error {}
