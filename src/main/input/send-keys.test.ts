import { describe, expect, it } from 'vitest';

import { parseAccelerator } from './keyboard';
import { chordKeys, scanKey } from './send-keys';

describe('scanKey', () => {
  it('takes the scan code from a plain key', () => {
    expect(scanKey(47)).toEqual({ scan: 0x2f, extended: false });
  });

  it('marks the keys libuiohook writes with an E0 prefix as extended', () => {
    expect(scanKey(3613)).toEqual({ scan: 0x1d, extended: true });
    expect(scanKey(57416)).toEqual({ scan: 0x48, extended: true });
  });
});

describe('chordKeys', () => {
  it('puts the left Ctrl down before V', () => {
    expect(chordKeys(parseAccelerator('Control+V')!)).toEqual([
      { scan: 0x1d, extended: false },
      { scan: 0x2f, extended: false },
    ]);
  });
});
