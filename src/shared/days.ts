/**
 * The commander's day. Commanders play late, so a day doesn't end at midnight: until
 * DAY_START_HOUR in the morning, "today" still means the evening before. Local time throughout.
 */

/** The hour, local time, at which one of the commander's days ends and the next begins. */
export const DAY_START_HOUR = 6;

/** When the commander's current day began: DAY_START_HOUR today, or yesterday before that hour. */
export function dayStart(now: Date): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), DAY_START_HOUR);
  if (now < start) start.setDate(start.getDate() - 1);
  return start;
}

/** Whether two moments fall in the same one of the commander's days. */
export function sameDay(a: Date, b: Date): boolean {
  return dayStart(a).getTime() === dayStart(b).getTime();
}
