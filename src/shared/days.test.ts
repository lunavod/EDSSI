import { describe, expect, it } from 'vitest';

import { sameDay } from './days';

const local = (day: number, hour: number) => new Date(2026, 8, day, hour);

describe('sameDay', () => {
  it('keeps the small hours with the evening before', () => {
    expect(sameDay(local(13, 2), local(12, 22))).toBe(true);
    expect(sameDay(local(13, 7), local(13, 2))).toBe(false);
    expect(sameDay(local(13, 23), local(13, 6))).toBe(true);
  });
});
