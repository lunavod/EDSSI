/**
 * Kokoro's utility process: the model is loaded and run here, never in the main process.
 * onnxruntime holds a process-wide lock while it loads a model and while it runs one, and in the
 * main process that froze every window for as long as each sentence took. Forked and talked to by
 * `client.ts`; the messages are `protocol.ts`.
 */

import { KokoroEngine } from './kokoro';
import type { FromWorker, ToWorker } from './protocol';

let engine: KokoroEngine | undefined;
const running = new Map<number, AbortController>();

function post(message: FromWorker): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a process port, not a window
  process.parentPort.postMessage(message);
}

process.parentPort.on('message', (event: { data: ToWorker }) => {
  const message = event.data;
  switch (message.type) {
    case 'start':
      engine ??= new KokoroEngine(message.dataDir, () => {
        if (engine) post({ type: 'state', state: engine.state() });
      });
      post({ type: 'state', state: engine.state() });
      break;
    case 'prepare':
      engine?.prepare();
      break;
    case 'speak':
      void speak(message);
      break;
    case 'cancel':
      running.get(message.id)?.abort(new Error('cancelled'));
      break;
    default:
      break;
  }
});

async function speak({ id, text, voice, speed }: Extract<ToWorker, { type: 'speak' }>) {
  const controller = new AbortController();
  running.set(id, controller);
  try {
    if (!engine) throw new Error('Kokoro wasn’t started.');
    await engine.speak(
      text,
      voice,
      speed,
      (pcm) => post({ type: 'audio', id, pcm }),
      controller.signal,
    );
    post({ type: 'done', id });
  } catch (error) {
    post({ type: 'failed', id, message: error instanceof Error ? error.message : String(error) });
  } finally {
    running.delete(id);
  }
}
