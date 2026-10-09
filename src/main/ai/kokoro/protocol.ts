/**
 * What Kokoro's utility process and the main process say to each other. Every request but `start`
 * names an id, and what comes back for it names the same id.
 *
 *   main → worker: start { dataDir }, prepare, speak { id, text, voice, speed }, cancel { id }
 *   worker → main: state { state }, audio { id, pcm }, done { id }, failed { id, message }
 */

import type { KokoroState } from './state';

export type ToWorker =
  | { type: 'start'; dataDir: string }
  | { type: 'prepare' }
  | { type: 'speak'; id: number; text: string; voice: string; speed: number }
  | { type: 'cancel'; id: number };

export type FromWorker =
  | { type: 'state'; state: KokoroState }
  | { type: 'audio'; id: number; pcm: Uint8Array }
  | { type: 'done'; id: number }
  | { type: 'failed'; id: number; message: string };
