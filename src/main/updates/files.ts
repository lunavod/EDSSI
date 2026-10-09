/**
 * What the updater keeps in the data folder: the marker saying an update is downloaded and waiting
 * for the next start, the last version whose "What's new" was shown, and its own log.
 */

import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** An update downloaded and waiting to be installed when EDSSI next starts. */
export interface PendingUpdate {
  version: string;
  downloadedAt: string;
}

const PENDING_FILE = 'pending-update.json';
const SEEN_FILE = 'whats-new.json';
export const UPDATER_LOG_FILE = 'updater.log';

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // Missing, or half-written by a run that was killed: either way there's nothing to go on.
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readPending(dir: string): PendingUpdate | undefined {
  const value = readJson(join(dir, PENDING_FILE));
  if (!isRecord(value) || typeof value['version'] !== 'string') return undefined;
  return {
    version: value['version'],
    downloadedAt: typeof value['downloadedAt'] === 'string' ? value['downloadedAt'] : '',
  };
}

export function writePending(dir: string, pending: PendingUpdate): void {
  writeFileSync(join(dir, PENDING_FILE), JSON.stringify(pending));
}

export function clearPending(dir: string): void {
  const path = join(dir, PENDING_FILE);
  if (existsSync(path)) unlinkSync(path);
}

/** The last version whose notes the commander has been shown; none on a first install. */
export function readSeenVersion(dir: string): string | undefined {
  const value = readJson(join(dir, SEEN_FILE));
  return isRecord(value) && typeof value['seen'] === 'string' ? value['seen'] : undefined;
}

export function writeSeenVersion(dir: string, version: string): void {
  writeFileSync(join(dir, SEEN_FILE), JSON.stringify({ seen: version }));
}

/** electron-updater's logger. */
export interface UpdaterLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

function describe(arg: unknown): string {
  if (arg instanceof Error) return arg.stack ?? arg.message;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/**
 * A log of what the updater did, one timestamped line per message, so a failed update can be
 * looked into after the fact: it happens while nobody is watching a console.
 */
export function updaterLog(path: string, now: () => Date = () => new Date()): UpdaterLogger {
  const write =
    (level: string) =>
    (...args: unknown[]): void => {
      try {
        appendFileSync(path, `${now().toISOString()} [${level}] ${args.map(describe).join(' ')}\n`);
      } catch {
        // A log that can't be written is no reason to stop updating.
      }
    };
  return { info: write('INFO'), warn: write('WARN'), error: write('ERROR'), debug: write('DEBUG') };
}

/**
 * The log without the lines older than `maxAgeMs`. A line that doesn't start with a timestamp (a
 * stack trace's) goes with the one before it.
 */
export function trimLog(text: string, now: Date, maxAgeMs: number): string {
  const cutoff = now.getTime() - maxAgeMs;
  let keep = false;
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    const stamp = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) /.exec(line);
    if (stamp) keep = Date.parse(stamp[1]!) >= cutoff;
    if (keep && line) kept.push(line);
  }
  return kept.length > 0 ? `${kept.join('\n')}\n` : '';
}

/** Trims the log file in place, as `trimLog` says. */
export function rotateLog(path: string, now: Date, maxAgeMs: number): void {
  try {
    const text = readFileSync(path, 'utf8');
    const trimmed = trimLog(text, now, maxAgeMs);
    if (trimmed !== text) writeFileSync(path, trimmed);
  } catch {
    // No log yet.
  }
}
