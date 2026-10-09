import type { RefusedEvent, UploadStatus, UploadTarget } from '../../shared/uploads';

/**
 * Where an event sits in the journal: its timestamp, and how many events before it share that
 * timestamp (the journal only counts whole seconds, and a honk writes dozens in one).
 */
export interface JournalPosition {
  timestamp: string;
  index: number;
}

export function comparePositions(a: JournalPosition, b: JournalPosition): number {
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
  return a.index - b.index;
}

export type SendResult =
  /**
   * The service took the batch. `accepted` counts what it kept, for the status line; `consumed` is
   * how many from the front of the batch were dealt with (all of them unless it says otherwise);
   * `holdMs` asks for a longer wait before the next request, e.g. at a rate limit.
   */
  | {
      kind: 'sent';
      accepted: number;
      consumed?: number;
      holdMs?: number;
      /** Events the service turned down. */
      refused?: RefusedEvent[];
      /** Events left out because the service asked not to get them. */
      skipped?: number;
      /** What the service said about the request as a whole. */
      message?: string;
    }
  /** Worth trying again later: the network, a server error, a rate limit. */
  | { kind: 'retry'; message: string; afterMs?: number }
  /** The service refused the key or the commander; trying again won't change that. */
  | { kind: 'rejected'; message: string };

export interface BatcherOptions<T> {
  target: UploadTarget;
  send: (batch: readonly T[]) => Promise<SendResult>;
  /** The shortest gap between two requests. */
  minIntervalMs: number;
  /** How long an event may wait for company before it is sent anyway. */
  maxDelayMs: number;
  maxBatch: number;
  /** Beyond this many waiting events the oldest are dropped, so an outage can't eat memory. */
  maxQueue: number;
  /** Everything up to here has been sent or skipped, and needn't be looked at again. */
  onConfirmed: (position: JournalPosition) => void;
  onStatus: (status: UploadStatus) => void;
  /** Hears every request and its answer, with the events it covered, for the upload log. */
  onAttempt?: (batch: readonly BatchItem<T>[], result: SendResult) => void;
}

const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 10 * 60_000;

export interface BatchItem<T> {
  payload: T;
  position: JournalPosition;
}

/** How many from the front of a batch of `size` a request dealt with. */
export function consumedBy(result: SendResult, size: number): number {
  const consumed = result.kind === 'sent' ? result.consumed : undefined;
  return Math.min(size, Math.max(1, consumed ?? size));
}

/**
 * Collects events for one service and sends them in batches: soon after something that matters
 * (a jump, docking), otherwise after a while, and never faster than the service allows. A batch
 * that fails stays at the front of the queue and is tried again with a growing delay.
 */
export class Batcher<T> {
  readonly #options: BatcherOptions<T>;
  #queue: BatchItem<T>[] = [];
  /** The newest event looked at, whether or not it was queued. */
  #seen: JournalPosition | undefined;
  #urgent = false;
  #firstQueuedAt: number | undefined;
  #lastAttemptAt = Number.NEGATIVE_INFINITY;
  #retryAt: number | undefined;
  #failures = 0;
  #sending = false;
  #stopped = false;
  #timer: NodeJS.Timeout | undefined;
  #status: UploadStatus;

  constructor(options: BatcherOptions<T>) {
    this.#options = options;
    this.#status = { target: options.target, state: 'waiting', pending: 0, sent: 0 };
  }

  get status(): UploadStatus {
    return this.#status;
  }

  /** Queues an event. `urgent` sends it as soon as the service allows. */
  push(payload: T, position: JournalPosition, urgent = false): void {
    if (this.#stopped) return;
    this.#queue.push({ payload, position });
    this.#firstQueuedAt ??= Date.now();
    if (this.#queue.length > this.#options.maxQueue) {
      this.#queue.splice(0, this.#queue.length - this.#options.maxQueue);
    }
    this.see(position);
    if (urgent) this.#urgent = true;
    this.#update({ pending: this.#queue.length });
    this.#schedule();
  }

  /** Notes an event that was looked at but not queued, so the cursor can move past it. */
  see(position: JournalPosition): void {
    if (!this.#seen || comparePositions(position, this.#seen) > 0) this.#seen = position;
  }

  /** Stops sending for a reason the service knows about, e.g. another commander is playing. */
  pause(message: string): void {
    if (this.#status.state === 'rejected') return;
    this.#update({ state: 'paused', message });
  }

  resume(): void {
    if (this.#status.state !== 'paused') return;
    this.#update({ state: 'waiting', message: undefined });
    this.#schedule();
  }

  /** Sends what is waiting now (still no faster than the service allows). */
  flush(): void {
    this.#urgent = true;
    this.#schedule();
  }

  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
  }

  #schedule(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const state = this.#status.state;
    if (this.#stopped || this.#sending || this.#queue.length === 0) return;
    if (state === 'paused' || state === 'rejected') return;

    const full = this.#queue.length >= this.#options.maxBatch;
    const wanted =
      this.#urgent || full
        ? Date.now()
        : (this.#firstQueuedAt ?? Date.now()) + this.#options.maxDelayMs;
    const due = Math.max(
      wanted,
      this.#lastAttemptAt + this.#options.minIntervalMs,
      this.#retryAt ?? Number.NEGATIVE_INFINITY,
    );
    this.#timer = setTimeout(() => void this.#send(), Math.max(0, due - Date.now()));
  }

  async #send(): Promise<void> {
    this.#timer = undefined;
    if (this.#stopped || this.#sending || this.#queue.length === 0) return;
    this.#sending = true;
    this.#lastAttemptAt = Date.now();

    const batch = this.#queue.slice(0, this.#options.maxBatch);
    let result: SendResult;
    try {
      result = await this.#options.send(batch.map((item) => item.payload));
    } catch (error) {
      result = { kind: 'retry', message: error instanceof Error ? error.message : String(error) };
    }
    this.#sending = false;
    this.#options.onAttempt?.(batch.slice(0, consumedBy(result, batch.length)), result);
    if (this.#stopped) return;

    switch (result.kind) {
      case 'sent': {
        const consumed = consumedBy(result, batch.length);
        this.#queue.splice(0, consumed);
        this.#failures = 0;
        this.#retryAt = result.holdMs === undefined ? undefined : Date.now() + result.holdMs;
        if (this.#queue.length === 0) {
          this.#urgent = false;
          this.#firstQueuedAt = undefined;
        }
        // With nothing left waiting, everything looked at so far is done with.
        const confirmed = this.#queue.length === 0 ? this.#seen : batch[consumed - 1]!.position;
        if (confirmed) this.#options.onConfirmed(confirmed);
        this.#update({
          state: this.#status.state === 'paused' ? 'paused' : 'waiting',
          message: this.#status.state === 'paused' ? this.#status.message : undefined,
          pending: this.#queue.length,
          lastSentAt: new Date().toISOString(),
          sent: this.#status.sent + result.accepted,
        });
        break;
      }
      case 'retry': {
        this.#failures += 1;
        const backoff = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (this.#failures - 1));
        this.#retryAt = Date.now() + (result.afterMs ?? backoff);
        this.#update({ state: 'retrying', message: result.message });
        break;
      }
      case 'rejected':
        // Kept: once the key is fixed, a new batcher is made and these are replayed from the cursor.
        this.#update({ state: 'rejected', message: result.message });
        break;
    }
    this.#schedule();
  }

  #update(change: Partial<UploadStatus>): void {
    this.#status = { ...this.#status, ...change };
    this.#options.onStatus(this.#status);
  }
}
