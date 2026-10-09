import { describe, expect, it } from 'vitest';

import { PAGE_WINDOW_CHARS, pageWindow } from './web';

describe('pageWindow', () => {
  it('gives a short page whole', () => {
    expect(pageWindow({ url: 'https://a.org/', title: 'A', text: 'short' }, 0)).toEqual({
      url: 'https://a.org/',
      title: 'A',
      text: 'short',
    });
  });

  it('reads a long page in windows that end at a line break', () => {
    const line = `${'x'.repeat(99)}\n`;
    const text = line.repeat(150);
    const first = pageWindow({ url: 'https://a.org/', text }, 0);
    expect(first.text.length).toBeLessThanOrEqual(PAGE_WINDOW_CHARS);
    expect(first.text.endsWith('\n')).toBe(true);
    expect(first.next_offset).toBe(first.text.length);

    let offset = 0;
    let read = '';
    for (;;) {
      const window = pageWindow({ url: 'https://a.org/', text }, offset);
      read += window.text;
      if (window.next_offset === undefined) break;
      offset = window.next_offset;
    }
    expect(read).toBe(text);
  });

  it('says so when there is nothing to read', () => {
    expect(pageWindow({ url: 'https://a.org/', text: '' }, 0).note).toMatch(/no readable text/);
  });
});
