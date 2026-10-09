import { describe, expect, it } from 'vitest';

import { ACK_NOTES, ACK_SECONDS } from './ack';

describe('ACK_NOTES', () => {
  it('rises, one note after another, and is over before the echo is', () => {
    for (const [index, note] of ACK_NOTES.entries()) {
      expect(note.to).toBeGreaterThanOrEqual(note.from);
      if (index > 0) {
        const previous = ACK_NOTES[index - 1]!;
        expect(note.at).toBeGreaterThan(previous.at);
        expect(note.from).toBeGreaterThan(previous.to);
      }
    }
    const last = ACK_NOTES.at(-1)!;
    expect(last.at + last.length).toBeLessThan(ACK_SECONDS);
  });
});
