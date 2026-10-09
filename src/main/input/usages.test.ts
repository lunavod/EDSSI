import { describe, expect, it } from 'vitest';

import { BUTTON_USAGE_PAGE, type ControlBinding } from '../../shared/input';
import {
  AXIS_THRESHOLD,
  axisValue,
  CAPTURE_AXIS_THRESHOLD,
  type ControlState,
  controlHeld,
  controlStrength,
  pressedControls,
  type ValueCap,
} from './usages';

/** The VKB Gladiator EVO's own numbers, as `native/hid-usages` reports them. */
const RX: ValueCap = {
  usagePage: 1,
  usage: 0x33,
  logicalMin: 0,
  logicalMax: 1023,
  bitSize: 16,
  hasNull: false,
};
const HAT: ValueCap = {
  usagePage: 1,
  usage: 0x39,
  logicalMin: 0,
  logicalMax: 7,
  bitSize: 4,
  hasNull: true,
};

function state(values: [number, number][], down: string[] = []): ControlState {
  return { values: new Map(values), down: new Set(down) };
}

function axis(direction: 'low' | 'high'): ControlBinding {
  return {
    kind: 'control',
    vendorId: 0x231d,
    productId: 0x200,
    usagePage: 1,
    usage: 0x33,
    mode: 'axis',
    direction,
  };
}

describe('axisValue', () => {
  it('puts the middle of the declared range at zero', () => {
    expect(axisValue(RX, 512)).toBeCloseTo(0, 2);
    expect(axisValue(RX, 0)).toBe(-1);
    expect(axisValue(RX, 1023)).toBe(1);
  });

  it('works the same whatever the range, which is the point of asking the device', () => {
    const wide: ValueCap = { ...RX, logicalMax: 4095 };
    expect(axisValue(wide, 2048)).toBeCloseTo(0, 2);
    expect(axisValue(wide, 4095)).toBe(1);
  });

  it('refuses to divide by a range of nothing', () => {
    expect(axisValue({ ...RX, logicalMin: 7, logicalMax: 7 }, 7)).toBe(0);
  });
});

describe('controlHeld', () => {
  it('holds a button while its usage is down', () => {
    const binding: ControlBinding = {
      kind: 'control',
      vendorId: 0x231d,
      productId: 0x200,
      usagePage: BUTTON_USAGE_PAGE,
      usage: 35,
      mode: 'button',
    };
    expect(controlHeld(binding, state([], ['9:35']), [])).toBe(true);
    expect(controlHeld(binding, state([], ['9:34']), [])).toBe(false);
  });

  it('holds a hat only in its own direction', () => {
    const up: ControlBinding = {
      kind: 'control',
      vendorId: 0x231d,
      productId: 0x200,
      usagePage: 1,
      usage: 0x39,
      mode: 'hat',
      value: 0,
    };
    expect(controlHeld(up, state([[0x39, 0]]), [HAT])).toBe(true);
    expect(controlHeld(up, state([[0x39, 4]]), [HAT])).toBe(false);
    // 8 is outside the declared 0..7: the hat is centred, which is what `hasNull` means.
    expect(controlHeld(up, state([[0x39, 8]]), [HAT])).toBe(false);
  });

  it('holds an axis once it is pushed far enough, and only that way', () => {
    const pushed = Math.round((1 + AXIS_THRESHOLD + 0.05) * 0.5 * 1023);
    expect(controlHeld(axis('high'), state([[0x33, pushed]]), [RX])).toBe(true);
    expect(controlHeld(axis('low'), state([[0x33, pushed]]), [RX])).toBe(false);
    expect(controlHeld(axis('high'), state([[0x33, 1023 - pushed]]), [RX])).toBe(false);
    expect(controlHeld(axis('low'), state([[0x33, 1023 - pushed]]), [RX])).toBe(true);
  });

  it('leaves a resting axis alone, however much its centre wanders', () => {
    for (const raw of [480, 500, 512, 530, 560]) {
      expect(controlHeld(axis('high'), state([[0x33, raw]]), [RX]), String(raw)).toBe(false);
      expect(controlHeld(axis('low'), state([[0x33, raw]]), [RX]), String(raw)).toBe(false);
    }
  });

  it('is not held by a control the device has not reported', () => {
    expect(controlHeld(axis('high'), state([]), [RX])).toBe(false);
  });

  it('is not held when the device never declared that axis', () => {
    expect(controlHeld(axis('high'), state([[0x33, 1023]]), [])).toBe(false);
  });
});

describe('pressedControls', () => {
  it('finds a button that has gone down since the capture began', () => {
    const before = state([], ['9:12']);
    const now = state([], ['9:12', '9:35']);
    // Only the new one: a button already held when the screen started listening was not the answer
    // to the question it asked.
    expect(pressedControls([], now, before)).toEqual([{ usagePage: 9, usage: 35, mode: 'button' }]);
  });

  it('finds a hat being pushed, and which way', () => {
    const before = state([[0x39, 8]]);
    expect(pressedControls([HAT], state([[0x39, 2]]), before)).toEqual([
      { usagePage: 1, usage: 0x39, mode: 'hat', value: 2 },
    ]);
  });

  it('leaves a centred hat alone', () => {
    expect(pressedControls([HAT], state([[0x39, 8]]), state([[0x39, 8]]))).toEqual([]);
  });

  it('takes a hat moved from one direction to another', () => {
    expect(pressedControls([HAT], state([[0x39, 6]]), state([[0x39, 2]]))).toEqual([
      { usagePage: 1, usage: 0x39, mode: 'hat', value: 6 },
    ]);
  });

  it('finds an axis shoved past the capture threshold', () => {
    const pushed = Math.round((1 + CAPTURE_AXIS_THRESHOLD + 0.1) * 0.5 * 1023);
    expect(pressedControls([RX], state([[0x33, pushed]]), state([[0x33, 512]]))).toEqual([
      { usagePage: 1, usage: 0x33, mode: 'axis', direction: 'high' },
    ]);
    expect(pressedControls([RX], state([[0x33, 1023 - pushed]]), state([[0x33, 512]]))).toEqual([
      { usagePage: 1, usage: 0x33, mode: 'axis', direction: 'low' },
    ]);
  });

  it('ignores an axis that is only being nudged, and one already held', () => {
    const nudged = Math.round((1 + 0.5) * 0.5 * 1023);
    expect(pressedControls([RX], state([[0x33, nudged]]), state([[0x33, 512]]))).toEqual([]);
    // A throttle sitting forward when the capture began: not a press, however far it is pushed.
    expect(pressedControls([RX], state([[0x33, 1023]]), state([[0x33, 1023]]))).toEqual([]);
  });

  it('offers a button before an axis, because a shove moves two axes at once', () => {
    const pushed = Math.round((1 + CAPTURE_AXIS_THRESHOLD + 0.1) * 0.5 * 1023);
    const found = pressedControls([RX], state([[0x33, pushed]], ['9:35']), state([[0x33, 512]]));
    expect(found.map((press) => press.mode)).toEqual(['button', 'axis']);
  });
});

describe('controlStrength', () => {
  it('is all or nothing for a button', () => {
    const binding: ControlBinding = {
      kind: 'control',
      vendorId: 0x231d,
      productId: 0x200,
      usagePage: BUTTON_USAGE_PAGE,
      usage: 35,
      mode: 'button',
    };
    expect(controlStrength(binding, state([], ['9:35']), [])).toBe(1);
    expect(controlStrength(binding, state([], []), [])).toBe(0);
  });

  it('grows with how far the axis is pushed, and is nothing before its threshold', () => {
    const half = Math.round((1 + 0.6) * 0.5 * 1023);
    const full = 1023;
    expect(controlStrength(axis('high'), state([[0x33, half]]), [RX])).toBeCloseTo(0.6, 1);
    expect(controlStrength(axis('high'), state([[0x33, full]]), [RX])).toBe(1);
    expect(controlStrength(axis('high'), state([[0x33, 512]]), [RX])).toBe(0);
    // Pushed the other way: this binding isn't the one being held.
    expect(controlStrength(axis('high'), state([[0x33, 0]]), [RX])).toBe(0);
  });
});
