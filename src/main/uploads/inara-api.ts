import type { RefusedEvent } from '../../shared/uploads';
import { USER_AGENT } from '../edsm';
import type { SendResult } from './batcher';
import type { InaraEvent } from './inara-events';
import { toJson } from './json';

const API_URL = 'https://inara.cz/inapi/v1/';
const TIMEOUT_MS = 20_000;

/** An Inara event, and the commander it belongs to (Inara takes that once per request). */
export interface InaraEntry {
  event: InaraEvent;
  commander: string;
  frontierId?: string;
}

export interface InaraApiOptions {
  /** Inara only answers applications it has whitelisted, by this exact name. */
  software: { name: string; version: string };
  /** Set while developing: Inara then skips its shared records, such as community goals. */
  isBeingDeveloped: boolean;
  fetch?: typeof fetch;
}

export class InaraApi {
  readonly #options: InaraApiOptions;
  readonly #fetch: typeof fetch;

  constructor(options: InaraApiOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  /** Sends the front of the batch that belongs to one commander. */
  async send(batch: readonly InaraEntry[], apiKey: string): Promise<SendResult> {
    const first = batch[0];
    if (!first) return { kind: 'sent', accepted: 0 };
    let consumed = batch.findIndex((entry) => entry.commander !== first.commander);
    if (consumed === -1) consumed = batch.length;
    const events = batch.slice(0, consumed).map((entry) => entry.event);

    const body = toJson({
      header: {
        appName: this.#options.software.name,
        appVersion: this.#options.software.version,
        isBeingDeveloped: this.#options.isBeingDeveloped,
        APIkey: apiKey,
        commanderName: first.commander,
        ...(first.frontierId && { commanderFrontierID: first.frontierId }),
      },
      events,
    });

    let response: Response;
    try {
      response = await this.#fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return { kind: 'retry', message: `Couldn't reach Inara: ${describe(error)}` };
    }
    if (!response.ok) return { kind: 'retry', message: `Inara answered HTTP ${response.status}` };

    let reply: unknown;
    try {
      reply = await response.json();
    } catch {
      return { kind: 'retry', message: 'Inara sent an answer that isn’t JSON' };
    }

    const header = field(reply, 'header');
    const status = field(header, 'eventStatus');
    const text = textOf(field(header, 'eventStatusText'));
    if (typeof status !== 'number') {
      return { kind: 'retry', message: 'Inara sent an answer without a status' };
    }
    // The header answers for the key, the commander and the application as a whole.
    if (Math.floor(status / 100) !== 2) {
      return {
        kind: 'rejected',
        message: `Inara: ${text || 'the request was refused'} (${status})`,
      };
    }

    let accepted = events.length;
    const refused: RefusedEvent[] = [];
    const results = field(reply, 'events');
    if (Array.isArray(results)) {
      accepted = 0;
      for (const [index, result] of results.entries()) {
        const code = field(result, 'eventStatus');
        if (typeof code === 'number' && Math.floor(code / 100) === 2) {
          accepted += 1;
        } else {
          // One bad event doesn't spoil the rest; resending it would only fail again.
          const event = events[index]?.eventName ?? 'unknown';
          const message = textOf(field(result, 'eventStatusText'));
          console.warn('[uploads] Inara did not take', event, code, message);
          refused.push({ event, code: typeof code === 'number' ? code : undefined, message });
        }
      }
    }
    return { kind: 'sent', accepted, consumed, refused, message: text || undefined };
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
