/**
 * Works out which bit of a device's input report is the button the commander just pressed.
 *
 * EDSSI never reads a report descriptor, so it has to tell a button from an axis by how the bytes
 * behave. Four things separate them, and all four are needed — each one alone lets something
 * through:
 *
 * - A button flips exactly one bit. An axis or a counter is a number, so it usually carries several
 *   bits at once when it changes.
 * - An axis moves again and again; a button changes twice, once down and once up. A byte that has
 *   already moved more than a handful of times this capture is an axis.
 * - A held button's byte goes quiet. An axis being swept changes every few milliseconds.
 * - An axis's high byte only moves while its low byte is moving, and that one jitters constantly —
 *   so a byte next to a byte that is moving is part of a number, not a button.
 *
 * Nothing here reads the clock or sets a timer: the caller passes the time in, so this can be
 * replayed against a recording of real sticks.
 */

/** One bit of one report, as the capture found it. */
export interface ButtonCandidate {
  reportId: number;
  byte: number;
  bit: number;
}

export interface ButtonDetectorOptions {
  /** Edges in the first moment are ignored, so arming the capture can't catch a stray report. */
  settleMs?: number;
  /** How long the byte must stay quiet before the press is believed. */
  holdMs?: number;
  /** How close a neighbouring byte may move without disqualifying the candidate. */
  quietMs?: number;
  /** A byte that has changed more often than this in one capture is an axis. */
  busyLimit?: number;
}

/** What one byte of one report has been doing during this capture. */
interface ByteLog {
  count: number;
  /** The most recent change times; older ones are dropped, as only the recent ones are asked about. */
  times: number[];
}

interface Pending extends ButtonCandidate {
  at: number;
}

interface ReportState {
  last: Uint8Array;
  bytes: Map<number, ByteLog>;
}

/** Enough history for the questions asked, which never look back further than `quietMs`. */
const MAX_TIMES = 16;

export class ButtonDetector {
  readonly #settleMs: number;
  readonly #holdMs: number;
  readonly #quietMs: number;
  readonly #busyLimit: number;

  readonly #reports = new Map<number, ReportState>();
  #pending: Pending[] = [];
  #startedAt: number | undefined;

  constructor(options: ButtonDetectorOptions = {}) {
    this.#settleMs = options.settleMs ?? 250;
    this.#holdMs = options.holdMs ?? 150;
    this.#quietMs = options.quietMs ?? 150;
    this.#busyLimit = options.busyLimit ?? 8;
  }

  /** Feeds one report in, as the device sends it. */
  observe(reportId: number, report: Uint8Array, now: number): void {
    this.#startedAt ??= now;
    const state = this.#reports.get(reportId);
    if (!state) {
      this.#reports.set(reportId, { last: Uint8Array.from(report), bytes: new Map() });
      return;
    }

    const before = state.last;
    state.last = Uint8Array.from(report);
    const settling = now - this.#startedAt < this.#settleMs;
    const length = Math.min(before.length, report.length);

    for (let index = 0; index < length; index++) {
      const changed = before[index]! ^ report[index]!;
      if (changed === 0) continue;

      const log = this.#log(state, index);
      log.count++;
      log.times.push(now);
      if (log.times.length > MAX_TIMES) log.times.shift();
      if (settling) continue;

      // A number carries several bits when it changes; a button carries one.
      if ((changed & (changed - 1)) !== 0) continue;
      // Only a press, not a release.
      if ((report[index]! & changed) === 0) continue;
      // A byte that keeps moving is an axis, whatever this one change looks like.
      if (log.count > this.#busyLimit) continue;

      const bit = Math.log2(changed);
      this.#pending.push({ reportId, byte: index, bit, at: now });
    }
  }

  /**
   * The button that has now proved itself, if one has. Call this regularly: a candidate can only
   * be judged once enough time has passed to see whether its byte went quiet.
   */
  take(now: number): ButtonCandidate | undefined {
    const waiting: Pending[] = [];
    let found: ButtonCandidate | undefined;

    for (const candidate of this.#pending) {
      if (found) break;
      // Not yet old enough to judge.
      if (now - candidate.at < this.#holdMs) {
        waiting.push(candidate);
        continue;
      }
      if (this.#confirms(candidate)) {
        found = { reportId: candidate.reportId, byte: candidate.byte, bit: candidate.bit };
      }
    }

    this.#pending = found ? [] : waiting;
    return found;
  }

  #confirms(candidate: Pending): boolean {
    const state = this.#reports.get(candidate.reportId);
    if (!state) return false;

    // The button is still held, so its byte has not moved since.
    const log = state.bytes.get(candidate.byte);
    if (log?.times.some((time) => time > candidate.at) === true) return false;

    // Part of a number: the byte beside it was moving at the same moment.
    for (const neighbour of [candidate.byte - 1, candidate.byte + 1]) {
      const beside = state.bytes.get(neighbour);
      if (beside?.times.some((time) => Math.abs(time - candidate.at) <= this.#quietMs) === true) {
        return false;
      }
    }

    // Whatever else is true, the bit has to still be down.
    return (state.last[candidate.byte]! & (1 << candidate.bit)) !== 0;
  }

  #log(state: ReportState, index: number): ByteLog {
    let log = state.bytes.get(index);
    if (!log) {
      log = { count: 0, times: [] };
      state.bytes.set(index, log);
    }
    return log;
  }
}
