import type { CompanionName, JournalEvent } from '../../shared/journal';
import type { EddnSettings, EdsmSettings, InaraSettings } from '../../shared/settings';
import type { UploadsSnapshot, UploadStatus, UploadTarget } from '../../shared/uploads';
import { Batcher, comparePositions, type JournalPosition, type SendResult } from './batcher';
import { type EddnEntry, eddnEncoder } from './eddn';
import { edsmEntry, type EdsmEntry, isUrgentForEdsm } from './edsm-journal';
import { type GameState, initialGameState, liveGalaxyProblem, updateGameState } from './game-state';
import type { InaraEntry } from './inara-api';
import { InaraTranslator, isUrgentForInara } from './inara-events';
import {
  describeEdsmEntry,
  describeInaraEntry,
  type LoggedEvent,
  type NewUploadLogEntry,
  uploadLogEntry,
} from './log';

export interface CursorStore {
  get(target: UploadTarget): JournalPosition | undefined;
  set(target: UploadTarget, position: JournalPosition): void;
}

export interface UploadsOptions {
  cursors: CursorStore;
  edsm: {
    send(
      batch: readonly EdsmEntry[],
      credentials: { apiKey: string; commanderName?: string },
    ): Promise<SendResult>;
  };
  inara: { send(batch: readonly InaraEntry[], apiKey: string): Promise<SendResult> };
  eddn: { send(batch: readonly EddnEntry[]): Promise<SendResult> };
  /** A companion file as it is on disk now, parsed; EDDN's station data is read from them. */
  readCompanion: (name: CompanionName) => unknown;
  onChange: (snapshot: UploadsSnapshot) => void;
  /** Records every request and its answer. */
  log?: (entry: NewUploadLogEntry) => void;
}

export interface UploadSettings {
  edsm: EdsmSettings;
  inara: InaraSettings;
  eddn: EddnSettings;
}

interface Pipeline {
  readonly status: UploadStatus;
  consider(event: JournalEvent, state: GameState, position: JournalPosition): void;
  stop(): void;
}

export interface UploadTiming {
  minIntervalMs: number;
  maxDelayMs: number;
  maxBatch: number;
  maxQueue: number;
}

/** EDSM takes a request every few seconds; the batching is mostly to be polite. */
export const EDSM_TIMING: UploadTiming = {
  minIntervalMs: 2_000,
  maxDelayMs: 30_000,
  maxBatch: 100,
  maxQueue: 5_000,
};
/** Inara asks for batches at a reasonable rate; EDMC sends at most every 35 s. */
export const INARA_TIMING: UploadTiming = {
  minIntervalMs: 35_000,
  maxDelayMs: 120_000,
  maxBatch: 500,
  maxQueue: 5_000,
};
/**
 * EDDN takes one message per request and wants it while it is news. A batch here is only how many
 * are posted one after another before the next pause.
 */
export const EDDN_TIMING: UploadTiming = {
  minIntervalMs: 1_000,
  maxDelayMs: 5_000,
  maxBatch: 20,
  maxQueue: 2_000,
};

/** What one journal line means for one service. */
export type Encoded<T> =
  | { payloads: T[]; urgent: boolean }
  /** This commander's events shouldn't go to the service, and why. */
  | { refusal: string };

/**
 * Turns journal lines into what one service is sent. It may keep state, so it must see every line
 * in order, including the ones that aren't sent (`fresh` false) and so only teach it something.
 */
export interface Encoder<T> {
  encode(event: JournalEvent, state: GameState, fresh: boolean): Encoded<T>;
  describe(payload: T): LoggedEvent;
}

export function edsmEncoder(settings: EdsmSettings): Encoder<EdsmEntry> {
  const wanted = settings.commander_name;
  return {
    encode(event, state, fresh) {
      if (wanted && state.commander && state.commander.toLowerCase() !== wanted.toLowerCase()) {
        return { refusal: `Playing as ${state.commander}, not ${wanted}.` };
      }
      const entry = fresh ? edsmEntry(event, state) : undefined;
      return { payloads: entry ? [entry] : [], urgent: isUrgentForEdsm(event) };
    },
    describe: describeEdsmEntry,
  };
}

export function inaraEncoder(): Encoder<InaraEntry> {
  const translator = new InaraTranslator();
  return {
    encode(event, state, fresh) {
      // Translated even when not sent: the translator has to see the ranks, the docking and the
      // last cargo to make sense of what follows.
      const events = translator.translate(event, state);
      const commander = state.commander;
      if (!fresh || !commander) return { payloads: [], urgent: false };
      return {
        payloads: events.map((translated) => ({
          event: translated,
          commander,
          frontierId: state.frontierId,
        })),
        urgent: events.some(isUrgentForInara),
      };
    },
    describe: describeInaraEntry,
  };
}

/** Why nothing at all is sent right now: a beta, the legacy galaxy, or someone else's crew. */
export function sendingProblem(state: GameState): string | undefined {
  return (
    liveGalaxyProblem(state) ??
    (state.inCrew ? "In another commander's crew; their journal is the one sent." : undefined)
  );
}

/**
 * Sends the journal to EDSM, Inara and EDDN as it is written. Every event goes through here,
 * including the current session's replay on start; only what comes after each service's cursor is
 * sent, so a restart picks up where the last run stopped rather than sending the session twice.
 */
export class Uploads {
  readonly #options: UploadsOptions;
  #state = initialGameState();
  #position: JournalPosition | undefined;
  readonly #pipelines = new Map<UploadTarget, { key: string; pipeline: Pipeline }>();
  #version = 0;
  #logVersion = 0;

  constructor(options: UploadsOptions) {
    this.#options = options;
  }

  apply(event: JournalEvent): void {
    this.#position = nextPosition(this.#position, event);
    this.#state = updateGameState(this.#state, event);
    for (const { pipeline } of this.#pipelines.values()) {
      considerSafely(pipeline, event, this.#state, this.#position);
    }
  }

  /**
   * Starts, restarts or stops each service to match the settings. A service whose settings changed
   * starts over and is fed `session` — the events seen so far — so what it missed is still sent.
   */
  configure(settings: UploadSettings, session: readonly JournalEvent[]): void {
    this.#configure('edsm', settings.edsm, session, () => this.#edsm(settings.edsm));
    this.#configure('inara', settings.inara, session, () => this.#inara(settings.inara));
    this.#configure('eddn', settings.eddn, session, () => this.#eddn());
    this.#changed();
  }

  snapshot(): UploadsSnapshot {
    return {
      version: this.#version,
      targets: [...this.#pipelines.values()].map(({ pipeline }) => pipeline.status),
      logVersion: this.#logVersion,
    };
  }

  stop(): void {
    for (const { pipeline } of this.#pipelines.values()) pipeline.stop();
  }

  #configure(
    target: UploadTarget,
    settings: EdsmSettings | InaraSettings | EddnSettings,
    session: readonly JournalEvent[],
    create: () => Pipeline,
  ): void {
    const key = JSON.stringify(settings);
    const existing = this.#pipelines.get(target);
    if (existing?.key === key) return;
    existing?.pipeline.stop();

    // EDDN has no accounts, so no key to wait for.
    const noKey = target !== 'eddn' && !('api_key' in settings && settings.api_key);
    const off = !settings.upload || noKey;
    const pipeline = off
      ? offPipeline(target, settings.upload ? 'No API key yet.' : 'Turned off.')
      : create();
    this.#pipelines.set(target, { key, pipeline });
    if (off) return;

    let state = initialGameState();
    let position: JournalPosition | undefined;
    for (const event of session) {
      position = nextPosition(position, event);
      state = updateGameState(state, event);
      considerSafely(pipeline, event, state, position);
    }
  }

  #edsm(settings: EdsmSettings): Pipeline {
    const apiKey = settings.api_key!;
    const commanderName = settings.commander_name;
    return this.#pipeline('edsm', edsmEncoder(settings), EDSM_TIMING, (batch) =>
      this.#options.edsm.send(batch, { apiKey, commanderName }),
    );
  }

  #inara(settings: InaraSettings): Pipeline {
    const apiKey = settings.api_key!;
    return this.#pipeline('inara', inaraEncoder(), INARA_TIMING, (batch) =>
      this.#options.inara.send(batch, apiKey),
    );
  }

  #eddn(): Pipeline {
    const encoder = eddnEncoder({ readCompanion: this.#options.readCompanion });
    return this.#pipeline('eddn', encoder, EDDN_TIMING, (batch) => this.#options.eddn.send(batch));
  }

  /**
   * What every service shares: nothing from before the cursor is sent, and nothing at all while the
   * commander is in someone else's crew or playing a beta or the legacy galaxy. `handle` sends the
   * event, or answers why this commander's events shouldn't go.
   */
  #pipeline<T>(
    target: UploadTarget,
    encoder: Encoder<T>,
    timing: UploadTiming,
    send: (batch: readonly T[]) => Promise<SendResult>,
  ): Pipeline {
    const batcher = new Batcher<T>({
      target,
      ...timing,
      send,
      onConfirmed: (position) => this.#options.cursors.set(target, position),
      onStatus: () => this.#changed(),
      onAttempt: (batch, result) => {
        const log = this.#options.log;
        if (!log) return;
        try {
          log(
            uploadLogEntry({
              target,
              source: 'live',
              batch,
              describe: (payload) => encoder.describe(payload),
              result,
            }),
          );
        } catch (error) {
          console.error("[uploads] couldn't write the upload log", error);
        }
        this.#logVersion += 1;
        this.#changed();
      },
    });
    let cursor = this.#options.cursors.get(target);
    if (!cursor) {
      // First time on: from now on, not the whole session the commander may have already sent
      // with another tool.
      cursor = { timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), index: 0 };
      this.#options.cursors.set(target, cursor);
    }
    const since = cursor;

    return {
      get status() {
        return batcher.status;
      },
      stop: () => batcher.stop(),
      consider: (event, state, position) => {
        const fresh = comparePositions(position, since) > 0;
        const problem = sendingProblem(state);
        if (problem) {
          // The version is only known once the Fileheader is read; that alone isn't a pause.
          if (fresh && state.gameVersion !== undefined) batcher.pause(problem);
          batcher.see(position);
          return;
        }
        const encoded = encoder.encode(event, state, fresh);
        if ('refusal' in encoded) {
          batcher.pause(encoded.refusal);
        } else {
          for (const payload of encoded.payloads) batcher.push(payload, position, encoded.urgent);
          batcher.resume();
        }
        batcher.see(position);
      },
    };
  }

  #changed(): void {
    this.#version += 1;
    this.#options.onChange(this.snapshot());
  }
}

/** Payloads aren't validated: a line of an unexpected shape costs that line, not the upload. */
function considerSafely(
  pipeline: Pipeline,
  event: JournalEvent,
  state: GameState,
  position: JournalPosition,
): void {
  try {
    pipeline.consider(event, state, position);
  } catch (error) {
    console.error(`[uploads] couldn't handle a ${event.event} line`, error);
  }
}

/** Where `event` sits, given the position of the line before it. */
export function nextPosition(
  last: JournalPosition | undefined,
  event: JournalEvent,
): JournalPosition {
  return last?.timestamp === event.timestamp
    ? { timestamp: event.timestamp, index: last.index + 1 }
    : { timestamp: event.timestamp, index: 0 };
}

function offPipeline(target: UploadTarget, message: string): Pipeline {
  return {
    status: { target, state: 'off', message, pending: 0, sent: 0 },
    consider: () => {},
    stop: () => {},
  };
}
