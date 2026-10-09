/**
 * Kokoro, from the main process: a client of the utility process that runs it (`worker.ts`), so
 * onnxruntime never loads here (see the worker for why). The worker is forked the first time the
 * voice is wanted and kept, with the model loaded, until EDSSI stops it; if it dies, the voice
 * reports that and the next `prepare` forks another. There is deliberately no fallback to running
 * the model in this process.
 */

import { utilityProcess, type UtilityProcess } from 'electron';

import type { FromWorker, ToWorker } from './protocol';
import { type KokoroState, kokoroNote } from './state';

interface Pending {
  onAudio: (pcm: Uint8Array) => void;
  resolve: () => void;
  reject: (error: Error) => void;
}

export class KokoroClient {
  readonly #workerPath: string;
  readonly #dataDir: string;
  readonly #onChange: () => void;
  #child: UtilityProcess | undefined;
  /** Sent once the worker has spawned; until then, held. */
  #queue: ToWorker[] = [];
  #spawned = false;
  #state: KokoroState = { kind: 'idle' };
  #pending = new Map<number, Pending>();
  #nextId = 1;

  /** `workerPath` is the built `kokoro-worker.js`; `dataDir` is where the model is kept. */
  constructor(workerPath: string, dataDir: string, onChange: () => void) {
    this.#workerPath = workerPath;
    this.#dataDir = dataDir;
    this.#onChange = onChange;
  }

  state(): KokoroState {
    return this.#state;
  }

  note(): string | undefined {
    return kokoroNote(this.#state);
  }

  /** Starts the worker if it isn't running, and has it fetch and load the model. */
  prepare(): void {
    if (this.#state.kind === 'ready' && this.#child) return;
    // Trying again after a failure: say so at once rather than leave the failure up until the
    // worker's first word. Never from inside this call itself, which callers make mid-setup.
    if (this.#state.kind === 'failed') {
      queueMicrotask(() => {
        if (this.#state.kind === 'failed') this.#set({ kind: 'loading' });
      });
    }
    this.#send({ type: 'prepare' });
  }

  /** Reads `text` aloud in `voice`, handing on each sentence's PCM as the worker makes it. */
  speak(
    text: string,
    voice: string,
    speed: number,
    onAudio: (pcm: Uint8Array) => void,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.#state.kind !== 'ready') {
      return Promise.reject(new Error('Kokoro’s voice isn’t ready yet.'));
    }
    const id = this.#nextId++;
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error('cancelled'));
        return;
      }
      const abort = (): void => {
        this.#send({ type: 'cancel', id });
        this.#settle(id, signal.reason instanceof Error ? signal.reason : new Error('cancelled'));
      };
      signal.addEventListener('abort', abort, { once: true });
      this.#pending.set(id, {
        onAudio,
        resolve: () => {
          signal.removeEventListener('abort', abort);
          resolve();
        },
        reject: (error) => {
          signal.removeEventListener('abort', abort);
          reject(error);
        },
      });
      this.#send({ type: 'speak', id, text, voice, speed });
    });
  }

  /** Ends the worker, and with it the model in memory. */
  stop(): void {
    const child = this.#child;
    this.#child = undefined;
    this.#spawned = false;
    this.#queue = [];
    for (const id of this.#pending.keys()) this.#settle(id, new Error('Kokoro stopped.'));
    child?.kill();
  }

  #send(message: ToWorker): void {
    const child = this.#child ?? this.#fork();
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a process port, not a window
    if (this.#spawned) child.postMessage(message);
    else this.#queue.push(message);
  }

  #fork(): UtilityProcess {
    const child = utilityProcess.fork(this.#workerPath, [], {
      serviceName: 'EDSSI Kokoro voice',
      stdio: 'inherit',
    });
    this.#child = child;
    this.#spawned = false;
    this.#queue = [{ type: 'start', dataDir: this.#dataDir }, ...this.#queue];
    child.on('spawn', () => {
      if (this.#child !== child) return;
      this.#spawned = true;
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a process port, not a window
      for (const message of this.#queue) child.postMessage(message);
      this.#queue = [];
    });
    child.on('message', (message: FromWorker) => {
      if (this.#child === child) this.#receive(message);
    });
    child.on('exit', (code) => {
      // Stopped on purpose, or replaced: nothing to report.
      if (this.#child !== child) return;
      this.#child = undefined;
      this.#spawned = false;
      for (const id of this.#pending.keys()) {
        this.#settle(id, new Error('Kokoro’s process stopped.'));
      }
      console.error('[kokoro] the worker stopped', code);
      this.#set({ kind: 'failed', message: `its process stopped (exit code ${code}).` });
    });
    return child;
  }

  #receive(message: FromWorker): void {
    switch (message.type) {
      case 'state':
        this.#set(message.state);
        break;
      case 'audio':
        this.#pending.get(message.id)?.onAudio(message.pcm);
        break;
      case 'done':
        this.#settle(message.id);
        break;
      case 'failed':
        this.#settle(message.id, new Error(message.message));
        break;
      default:
        break;
    }
  }

  #settle(id: number, error?: Error): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    if (error) pending.reject(error);
    else pending.resolve();
  }

  #set(state: KokoroState): void {
    this.#state = state;
    this.#onChange();
  }
}
