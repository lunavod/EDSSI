import type { JournalEvent } from '../../shared/journal';
import type { RefusedEvent } from '../../shared/uploads';
import { EDSM_BASE_URL, USER_AGENT } from '../edsm';
import type { SendResult } from './batcher';
import type { GameState } from './game-state';
import { toJson } from './json';

/**
 * EDSM's journal API takes the journal as the game wrote it, plus a few fields saying where the
 * commander was, and works everything out itself. It publishes the events it doesn't want.
 *
 * EDSM's documentation sits behind a browser check, so the protocol here follows EDMarketConnector's
 * EDSM plugin, the reference client.
 */
const JOURNAL_URL = `${EDSM_BASE_URL}/api-journal-v1`;
const DISCARD_URL = `${EDSM_BASE_URL}/api-journal-v1/discard`;
const TIMEOUT_MS = 20_000;
/** The discard list changes with game updates, not by the hour. */
const DISCARD_FRESH_MS = 24 * 60 * 60_000;

/** Arriving somewhere is what EDSM shows first, so these go without waiting for company. */
const URGENT = new Set(['FSDJump', 'CarrierJump', 'Location', 'Docked', 'Shutdown']);

/**
 * One journal line, ready to send: the event with EDSM's transient fields, and who played it on
 * which build (EDSM takes both once per request).
 */
export interface EdsmEntry {
  message: Record<string, unknown>;
  commander: string;
  gameVersion: string;
  gameBuild: string;
}

export interface EdsmJournalOptions {
  software: { name: string; version: string };
  fetch?: typeof fetch;
}

export function isUrgentForEdsm(event: JournalEvent): boolean {
  return URGENT.has(event.event);
}

/**
 * The event as EDSM wants it, or nothing if it isn't worth sending. The `_`-prefixed fields carry
 * where the commander was, since most events don't say.
 */
export function edsmEntry(event: JournalEvent, state: GameState): EdsmEntry | undefined {
  // Since Odyssey these lines are often just a pointer to the companion file; EDSM would read an
  // empty one as an empty hold.
  if (event.event === 'Cargo' && !Array.isArray(event.Inventory)) return undefined;
  if (
    (event.event === 'ShipLocker' || event.event === 'Backpack') &&
    !('Items' in event && Array.isArray(event.Items))
  ) {
    return undefined;
  }
  if (state.gameVersion === undefined || state.commander === undefined) return undefined;

  return {
    commander: state.commander,
    gameVersion: state.gameVersion,
    gameBuild: state.gameBuild ?? '',
    message: {
      ...event,
      _systemAddress: state.systemAddress ?? null,
      _systemName: state.systemName ?? null,
      _systemCoordinates: state.coordinates ?? null,
      _marketId: state.marketId ?? null,
      _stationName: state.stationName ?? null,
      _shipId: state.shipId ?? null,
    },
  };
}

export class EdsmJournalApi {
  readonly #options: EdsmJournalOptions;
  readonly #fetch: typeof fetch;
  #discard: { names: Set<string>; at: number } | undefined;

  constructor(options: EdsmJournalOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  /**
   * Sends the front of the batch that shares one commander and game build. Events EDSM has asked
   * not to get are dropped here rather than when they are queued, so a fresh discard list applies
   * to what is already waiting.
   */
  async send(
    batch: readonly EdsmEntry[],
    credentials: { apiKey: string; commanderName?: string },
  ): Promise<SendResult> {
    const first = batch[0];
    if (!first) return { kind: 'sent', accepted: 0 };
    let consumed = batch.findIndex(
      (entry) =>
        entry.commander !== first.commander ||
        entry.gameVersion !== first.gameVersion ||
        entry.gameBuild !== first.gameBuild,
    );
    if (consumed === -1) consumed = batch.length;

    let discard: Set<string>;
    try {
      discard = await this.#discarded();
    } catch (error) {
      return { kind: 'retry', message: `Couldn't get EDSM's discard list: ${describe(error)}` };
    }
    const messages = batch
      .slice(0, consumed)
      .map((entry) => entry.message)
      .filter((message) => !discard.has(String(message['event'])));
    const skipped = consumed - messages.length;
    if (messages.length === 0) return { kind: 'sent', accepted: 0, consumed, skipped };

    const body = new URLSearchParams({
      commanderName: credentials.commanderName ?? first.commander,
      apiKey: credentials.apiKey,
      fromSoftware: this.#options.software.name,
      fromSoftwareVersion: this.#options.software.version,
      fromGameVersion: first.gameVersion,
      fromGameBuild: first.gameBuild,
      message: toJson(messages),
    });

    let response: Response;
    try {
      response = await this.#fetch(JOURNAL_URL, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return { kind: 'retry', message: `Couldn't reach EDSM: ${describe(error)}` };
    }

    const holdMs = rateLimitHold(response.headers);
    if (!response.ok) {
      return { kind: 'retry', message: `EDSM answered HTTP ${response.status}`, afterMs: holdMs };
    }

    let reply: unknown;
    try {
      reply = await response.json();
    } catch {
      return { kind: 'retry', message: 'EDSM sent an answer that isn’t JSON' };
    }
    const msgnum = field(reply, 'msgnum');
    const msg = textOf(field(reply, 'msg'));
    if (typeof msgnum !== 'number') {
      return { kind: 'retry', message: 'EDSM sent an answer without a status' };
    }

    // 1xx: taken. 5xx: taken, to be processed later. 2xx: the request itself was refused.
    if (Math.floor(msgnum / 100) === 2) {
      // 201–205 are about the commander, the key or the software, which retrying won't fix.
      if (msgnum <= 205) return { kind: 'rejected', message: `EDSM: ${msg} (${msgnum})` };
      // The batch itself is bad. Holding on to it would block everything behind it.
      console.warn('[uploads] EDSM refused a batch', msgnum, msg);
      const message = `${msg} (${msgnum})`;
      return { kind: 'sent', accepted: 0, consumed, holdMs, skipped, message };
    }

    const events = field(reply, 'events');
    let accepted = messages.length;
    const refused: RefusedEvent[] = [];
    if (Array.isArray(events)) {
      accepted = 0;
      for (const [index, result] of events.entries()) {
        const code = field(result, 'msgnum');
        if (typeof code === 'number' && Math.floor(code / 100) === 1) accepted += 1;
        else {
          const name = messages[index]?.['event'];
          const event = typeof name === 'string' ? name : 'unknown';
          const text = textOf(field(result, 'msg'));
          console.warn('[uploads] EDSM did not take', event, code, text);
          refused.push({ event, code: typeof code === 'number' ? code : undefined, message: text });
        }
      }
    }
    const message = `${msg} (${msgnum})`;
    return { kind: 'sent', accepted, consumed, holdMs, skipped, refused, message };
  }

  async #discarded(): Promise<Set<string>> {
    if (this.#discard && Date.now() - this.#discard.at < DISCARD_FRESH_MS) {
      return this.#discard.names;
    }
    const response = await this.#fetch(DISCARD_URL, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const names: unknown = await response.json();
    if (!Array.isArray(names) || names.length === 0) {
      throw new Error('the list was empty');
    }
    this.#discard = { names: new Set(names.map(String)), at: Date.now() };
    return this.#discard.names;
  }
}

/** When EDSM says the allowance is used up, how long until it comes back. */
function rateLimitHold(headers: Headers): number | undefined {
  const remaining = Number(headers.get('X-Rate-Limit-Remaining') ?? Number.NaN);
  const reset = Number(headers.get('X-Rate-Limit-Reset') ?? Number.NaN);
  if (remaining !== 0 || !Number.isFinite(reset)) return undefined;
  return Math.max(0, reset * 1000 - Date.now());
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
