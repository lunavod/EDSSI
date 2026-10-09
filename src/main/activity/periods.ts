/**
 * Turning "today", "yesterday" or "this session" into a span of time, by the commander's day (see
 * `shared/days.ts`). Everything here works in the computer's local time, the way the commander
 * talks.
 */

import { DAY_START_HOUR, dayStart } from '../../shared/days';

export { DAY_START_HOUR, dayStart };

export const PERIODS = [
  'today',
  'yesterday',
  'this_session',
  'previous_session',
  'last_7_days',
  'last_30_days',
  'since_last_sale',
  'all_time',
] as const;

export type Period = (typeof PERIODS)[number];

/** Milliseconds since the epoch, `from` inclusive and `to` exclusive. */
export interface TimeRange {
  from: number;
  to: number;
  /** What the range covers, in words, e.g. "today (since 06:00)". */
  label: string;
}

/** What some periods need to know about the journal. */
export interface PeriodContext {
  /** When each game session began, oldest first. */
  sessionStarts: readonly number[];
  /** The last sale of exploration or organic data. */
  lastSale?: number;
}

/** `days` whole days before `start`, counted on the calendar so a clock change doesn't shift it. */
function daysBefore(start: Date, days: number): Date {
  const shifted = new Date(start);
  shifted.setDate(shifted.getDate() - days);
  return shifted;
}

/** A commander's day, from DAY_START_HOUR that morning, or undefined if `date` isn't YYYY-MM-DD. */
function parseDay(date: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return undefined;
  const [year, month, dayOfMonth] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const start = new Date(year, month - 1, dayOfMonth, DAY_START_HOUR);
  // `new Date` rolls 2026-02-31 over into March, so check the parts came back unchanged.
  if (start.getMonth() !== month - 1 || start.getDate() !== dayOfMonth) return undefined;
  return start;
}

/**
 * The span a period covers, as of `now`. `date` (YYYY-MM-DD) picks one of the commander's days
 * instead, from DAY_START_HOUR that morning to the next; `since` (YYYY-MM-DD) runs from that
 * morning to now. Returns a sentence when there is no such span, e.g. no earlier session.
 */
export function resolvePeriod(
  period: Period,
  now: Date,
  context: PeriodContext,
  date?: string,
  since?: string,
): TimeRange | string {
  const to = now.getTime();
  if (date !== undefined && since !== undefined) {
    return 'Ask for either one day (date) or everything since a day (since), not both.';
  }
  if (date !== undefined) {
    const start = parseDay(date);
    if (!start) return `"${date}" is not a date written as YYYY-MM-DD.`;
    const end = daysBefore(start, -1);
    return { from: start.getTime(), to: Math.min(end.getTime(), to), label: `the day of ${date}` };
  }
  if (since !== undefined) {
    const start = parseDay(since);
    if (!start) return `"${since}" is not a date written as YYYY-MM-DD.`;
    if (start.getTime() > to) return `${since} hasn't come yet.`;
    return { from: start.getTime(), to, label: `since ${day(start)} (${clock(start)})` };
  }

  const today = dayStart(now);
  switch (period) {
    case 'today':
      return { from: today.getTime(), to, label: `today (since ${clock(today)})` };
    case 'yesterday': {
      const start = daysBefore(today, 1);
      return { from: start.getTime(), to: today.getTime(), label: `yesterday (${day(start)})` };
    }
    case 'last_7_days':
    case 'last_30_days': {
      const days = period === 'last_7_days' ? 7 : 30;
      const start = daysBefore(today, days - 1);
      return { from: start.getTime(), to, label: `the last ${days} days (since ${day(start)})` };
    }
    case 'this_session': {
      const start = context.sessionStarts.at(-1);
      if (start === undefined) return 'No game session has started yet.';
      return { from: start, to, label: `this session (since ${stamp(start)})` };
    }
    case 'previous_session': {
      const starts = context.sessionStarts;
      if (starts.length < 2) return 'There is no earlier game session in the journals.';
      const from = starts.at(-2)!;
      return { from, to: starts.at(-1)!, label: `the previous session (${stamp(from)})` };
    }
    case 'since_last_sale':
      if (context.lastSale === undefined) {
        return { from: 0, to, label: 'since the first journal (no data has ever been sold)' };
      }
      return {
        from: context.lastSale,
        to,
        label: `since the last data sale (${stamp(context.lastSale)})`,
      };
    case 'all_time':
      return { from: 0, to, label: 'since the first journal' };
  }
  return `There is no period called ${String(period)}.`;
}

/** "2026-09-13 01:20", local time: how times are put in front of the model. */
export function stamp(ms: number): string {
  const at = new Date(ms);
  return `${day(at)} ${clock(at)}`;
}

/** The time line in front of every question, so the model knows the hour and the commander's day. */
export function describeNow(now: Date): string {
  const weekday = now.toLocaleDateString('en-GB', { weekday: 'long' });
  const offset = -now.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const zone = `UTC${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  const start = dayStart(now);
  const began =
    start.getDate() === now.getDate()
      ? `at ${clock(start)}`
      : `at ${clock(start)} yesterday, ${day(start)}`;
  return `Local time: ${weekday} ${stamp(now.getTime())} (${zone}). The commander's day began ${began}.`;
}

function day(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function clock(at: Date): string {
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
