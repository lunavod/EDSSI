import { describe, expect, it } from 'vitest';

import { dayStart, describeNow, resolvePeriod } from './periods';

/** Local time, so the tests mean the same in any time zone. */
const local = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute);

const noSessions = { sessionStarts: [] };

describe('dayStart', () => {
  it('begins the day at six in the morning', () => {
    expect(dayStart(local(13, 14))).toEqual(local(13, 6));
    expect(dayStart(local(13, 6))).toEqual(local(13, 6));
  });

  it('still counts the small hours as the day before', () => {
    expect(dayStart(local(13, 1, 20))).toEqual(local(12, 6));
    expect(dayStart(local(13, 5, 59))).toEqual(local(12, 6));
  });
});

describe('resolvePeriod', () => {
  it('reads "today" late at night as the evening that is still going on', () => {
    const range = resolvePeriod('today', local(13, 2), noSessions);
    expect(range).toMatchObject({ from: local(12, 6).getTime(), to: local(13, 2).getTime() });
  });

  it("puts yesterday before the commander's day, not before midnight", () => {
    const range = resolvePeriod('yesterday', local(13, 2), noSessions);
    expect(range).toMatchObject({ from: local(11, 6).getTime(), to: local(12, 6).getTime() });
  });

  it('counts the last seven days including today', () => {
    const range = resolvePeriod('last_7_days', local(13, 20), noSessions);
    expect(range).toMatchObject({ from: local(7, 6).getTime() });
  });

  it('turns a date into that day, from six to six', () => {
    const range = resolvePeriod('today', local(20, 12), noSessions, '2026-09-10');
    expect(range).toMatchObject({ from: local(10, 6).getTime(), to: local(11, 6).getTime() });
    expect(resolvePeriod('today', local(20, 12), noSessions, 'last tuesday')).toBeTypeOf('string');
    expect(resolvePeriod('today', local(20, 12), noSessions, '2026-02-31')).toBeTypeOf('string');
  });

  it('runs "since" from that morning to now, so jumps since a date can be counted', () => {
    const now = local(20, 12);
    expect(resolvePeriod('today', now, noSessions, undefined, '2026-09-10')).toMatchObject({
      from: local(10, 6).getTime(),
      to: now.getTime(),
      label: 'since 2026-09-10 (06:00)',
    });
    expect(resolvePeriod('today', now, noSessions, undefined, '10/09/2026')).toBeTypeOf('string');
    expect(resolvePeriod('today', now, noSessions, undefined, '2026-09-30')).toBeTypeOf('string');
    expect(resolvePeriod('today', now, noSessions, '2026-09-10', '2026-09-10')).toBeTypeOf(
      'string',
    );
  });

  it('finds this and the previous session from their starts', () => {
    const sessionStarts = [local(10, 20).getTime(), local(12, 21).getTime()];
    expect(resolvePeriod('this_session', local(13, 1), { sessionStarts })).toMatchObject({
      from: sessionStarts[1],
    });
    expect(resolvePeriod('previous_session', local(13, 1), { sessionStarts })).toMatchObject({
      from: sessionStarts[0],
      to: sessionStarts[1],
    });
    expect(resolvePeriod('previous_session', local(13, 1), noSessions)).toBeTypeOf('string');
  });

  it('runs the trip from the last sale', () => {
    const lastSale = local(9, 18).getTime();
    expect(
      resolvePeriod('since_last_sale', local(13, 1), { sessionStarts: [], lastSale }),
    ).toMatchObject({ from: lastSale });
  });
});

describe('describeNow', () => {
  it("says when the commander's day began", () => {
    expect(describeNow(local(13, 1, 20))).toContain('began at 06:00 yesterday, 2026-09-12');
    expect(describeNow(local(13, 9))).toContain('2026-09-13 09:00');
  });
});
