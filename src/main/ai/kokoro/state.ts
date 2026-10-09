/**
 * Where Kokoro's voice is in getting ready, shared by the worker that runs it (`worker.ts`) and the
 * client in the main process (`client.ts`), which only ever sees it as a message.
 */

import type { KokoroState } from '../../../shared/kokoro';

export type { KokoroState };

/** What Comms should say about the voice while it isn't ready; nothing once it is. */
export function kokoroNote(state: KokoroState): string | undefined {
  switch (state.kind) {
    case 'idle':
    case 'loading':
      return 'Loading Kokoro’s voice.';
    case 'missing':
      return 'Kokoro’s voice is about to download (326 MB), the first time only.';
    case 'downloading': {
      const percent = Math.floor((100 * state.received) / state.total);
      const mb = Math.round(state.total / 1_000_000);
      return `Downloading Kokoro’s voice: ${percent}% of ${mb} MB. Answers are written until then.`;
    }
    case 'failed':
      return `Kokoro’s voice couldn’t be set up: ${state.message}`;
    default:
      return undefined;
  }
}
