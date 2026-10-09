import type { JournalEvent } from '../../shared/journal';
import type { UploadTarget } from '../../shared/uploads';
import {
  type BatchItem,
  comparePositions,
  consumedBy,
  type JournalPosition,
  type SendResult,
} from './batcher';
import { initialGameState, updateGameState } from './game-state';
import { type NewUploadLogEntry, uploadLogEntry } from './log';
import { type Encoder, nextPosition, sendingProblem, type UploadTiming } from './uploads';

/** What a past stretch of journal comes to for one service. */
export interface BackfillPlan<T> {
  items: BatchItem<T>[];
  /** Lines that weren't sent, by the reason (a beta, another commander's crew…). */
  held: Map<string, number>;
  /** Lines left out because the live upload had already got past them. */
  alreadySent: number;
}

/**
 * Works out what the live upload would have sent for `events`, which must be whole game sessions
 * in order. Lines at or after `until` — the service's cursor — are left to the live upload, which
 * has sent them or will.
 */
export function planBackfill<T>(
  events: readonly JournalEvent[],
  encoder: Encoder<T>,
  until?: JournalPosition,
): BackfillPlan<T> {
  const items: BatchItem<T>[] = [];
  const held = new Map<string, number>();
  let alreadySent = 0;
  let state = initialGameState();
  let position: JournalPosition | undefined;

  for (const event of events) {
    position = nextPosition(position, event);
    state = updateGameState(state, event);
    const fresh = until === undefined || comparePositions(position, until) < 0;
    const problem = sendingProblem(state);
    if (problem) {
      // The version is only known once the Fileheader is read; that alone holds nothing back.
      if (state.gameVersion !== undefined) held.set(problem, (held.get(problem) ?? 0) + 1);
      continue;
    }
    let encoded;
    try {
      encoded = encoder.encode(event, state, fresh);
    } catch (error) {
      console.error(`[backfill] couldn't handle a ${event.event} line`, error);
      continue;
    }
    if ('refusal' in encoded) {
      held.set(encoded.refusal, (held.get(encoded.refusal) ?? 0) + 1);
      continue;
    }
    if (!fresh) {
      alreadySent += 1;
      continue;
    }
    for (const payload of encoded.payloads) items.push({ payload, position });
  }
  return { items, held, alreadySent };
}

export interface BackfillOutcome {
  /** Events the service kept. */
  accepted: number;
  /** Events it answered for, kept or not. */
  answered: number;
  requests: number;
  /** Why sending stopped before the end, if it did. */
  stopped?: string;
}

const MAX_RETRIES = 5;

/**
 * Sends `items` one request at a time, no faster than `timing` allows, logging every request. A
 * failure that may pass is retried a few times with a growing wait; a refused key stops at once.
 */
export async function sendBackfill<T>(options: {
  target: UploadTarget;
  items: readonly BatchItem<T>[];
  encoder: Encoder<T>;
  timing: UploadTiming;
  send: (batch: readonly T[]) => Promise<SendResult>;
  log: (entry: NewUploadLogEntry) => void;
  /** Hears each answer, for progress. */
  onResult?: (result: SendResult, done: number, total: number) => void;
  sleep?: (ms: number) => Promise<void>;
}): Promise<BackfillOutcome> {
  const { items, timing } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const outcome: BackfillOutcome = { accepted: 0, answered: 0, requests: 0 };
  let next = 0;
  let failures = 0;

  while (next < items.length) {
    const batch = items.slice(next, next + timing.maxBatch);
    let result: SendResult;
    try {
      result = await options.send(batch.map((item) => item.payload));
    } catch (error) {
      result = { kind: 'retry', message: error instanceof Error ? error.message : String(error) };
    }
    outcome.requests += 1;
    const covered = batch.slice(0, consumedBy(result, batch.length));
    options.log(
      uploadLogEntry({
        target: options.target,
        source: 'backfill',
        batch: covered,
        describe: (payload) => options.encoder.describe(payload),
        result,
      }),
    );

    let wait = timing.minIntervalMs;
    if (result.kind === 'sent') {
      failures = 0;
      next += covered.length;
      outcome.answered += covered.length;
      outcome.accepted += result.accepted;
      wait = Math.max(wait, result.holdMs ?? 0);
    } else if (result.kind === 'retry') {
      failures += 1;
      if (failures > MAX_RETRIES) {
        outcome.stopped = `Gave up after ${MAX_RETRIES} retries: ${result.message}`;
        options.onResult?.(result, next, items.length);
        return outcome;
      }
      wait = Math.max(wait, result.afterMs ?? 15_000 * 2 ** (failures - 1));
    } else {
      outcome.stopped = result.message;
      options.onResult?.(result, next, items.length);
      return outcome;
    }
    options.onResult?.(result, next, items.length);
    if (next < items.length) await sleep(wait);
  }
  return outcome;
}
