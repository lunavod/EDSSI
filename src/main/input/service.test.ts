import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ButtonBinding, DeviceBinding, InputBinding } from '../../shared/input';
import type { JoystickHandlers, JoystickWatcher } from './joystick';
import type { KeyboardHandlers, KeyboardHook } from './keyboard';
import { startInputService } from './service';

// The service registers IPC and pushes snapshots; neither is what these tests are about.
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../broadcast', () => ({ broadcast: vi.fn() }));

const CTRL = 29;
const ALT = 56;
const SPACE = 57;
const F13 = 91;

const KEY: InputBinding = { kind: 'key', accelerator: 'Control+Alt+Space' };
const BUTTON: ButtonBinding = {
  kind: 'button',
  vendorId: 0x231d,
  productId: 0x0200,
  product: 'VKBsim Gladiator EVO R',
  reportId: 1,
  byte: 4,
  bit: 3,
};

/** A keyboard the test presses, standing in for the hook. */
function fakeKeyboard() {
  let handlers: KeyboardHandlers | undefined;
  const held = new Set<number>();
  return {
    start(given: KeyboardHandlers): KeyboardHook {
      handlers = given;
      return { stop: vi.fn() };
    },
    press(...codes: number[]) {
      for (const code of codes) {
        held.add(code);
        handlers?.onChange(held);
        handlers?.onPress(code, held);
      }
    },
    release(...codes: number[]) {
      for (const code of codes) {
        held.delete(code);
        handlers?.onChange(held);
      }
    },
  };
}

/** A stick the test presses, standing in for the HID watcher. */
function fakeJoystick() {
  let handlers: JoystickHandlers | undefined;
  let onPress: ((binding: DeviceBinding) => void) | undefined;
  let down = false;
  let push = 1;
  return {
    start(given: JoystickHandlers): JoystickWatcher {
      handlers = given;
      return {
        held: () => down,
        strength: () => (down ? push : 0),
        devices: () => [],
        capture(listener) {
          onPress = listener;
          return () => {
            onPress = undefined;
          };
        },
        stop: vi.fn(),
      };
    },
    hold(strength = 1) {
      down = true;
      push = strength;
      handlers?.onChange();
      onPress?.(BUTTON);
    },
    release() {
      down = false;
      handlers?.onChange();
    },
  };
}

function start(bindings: InputBinding[], holdToTalk = true) {
  const keyboard = fakeKeyboard();
  const joystick = fakeJoystick();
  const onListen = vi.fn();
  const service = startInputService({
    bindings,
    holdToTalk,
    onListen,
    hooks: {
      keyboard: (handlers) => keyboard.start(handlers),
      joystick: (handlers) => joystick.start(handlers),
    },
  });
  return { keyboard, joystick, onListen, service };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('hold to talk', () => {
  it('opens the microphone while the chord is held and closes it when it is let go', () => {
    const { keyboard, onListen } = start([KEY]);

    keyboard.press(CTRL, ALT, SPACE);
    expect(onListen.mock.calls).toEqual([['start']]);

    keyboard.release(SPACE);
    vi.advanceTimersByTime(200);
    expect(onListen.mock.calls).toEqual([['start'], ['stop']]);
  });

  it('lets go when a modifier is released, not just the key', () => {
    const { keyboard, onListen } = start([KEY]);
    keyboard.press(CTRL, ALT, SPACE);
    keyboard.release(ALT);
    vi.advanceTimersByTime(200);
    expect(onListen.mock.calls).toEqual([['start'], ['stop']]);
  });

  it('ignores the key repeating while it is held down', () => {
    const { keyboard, onListen } = start([KEY]);
    keyboard.press(CTRL, ALT, SPACE);
    keyboard.press(SPACE);
    keyboard.press(SPACE);
    expect(onListen.mock.calls).toEqual([['start']]);
  });

  it('does not cut a question in half when a button chatters', () => {
    const { joystick, onListen } = start([BUTTON]);
    joystick.hold();
    joystick.release();
    // Back before the grace period is up: the commander never really let go.
    vi.advanceTimersByTime(50);
    joystick.hold();
    vi.advanceTimersByTime(500);
    expect(onListen.mock.calls).toEqual([['start']]);

    joystick.release();
    vi.advanceTimersByTime(200);
    expect(onListen.mock.calls).toEqual([['start'], ['stop']]);
  });

  it('holds while either of two bindings is down, and lets go only when both are', () => {
    const { keyboard, joystick, onListen } = start([KEY, BUTTON]);
    keyboard.press(CTRL, ALT, SPACE);
    joystick.hold();
    keyboard.release(SPACE);
    vi.advanceTimersByTime(500);
    // The stick is still held, so the question is still going.
    expect(onListen.mock.calls).toEqual([['start']]);

    joystick.release();
    vi.advanceTimersByTime(200);
    expect(onListen.mock.calls).toEqual([['start'], ['stop']]);
  });

  it('reports what is held, so the settings screen can light it up', () => {
    const { keyboard, service } = start([KEY]);
    expect(service.snapshot().talking).toBe(false);
    keyboard.press(CTRL, ALT, SPACE);
    expect(service.snapshot().talking).toBe(true);
    expect(service.snapshot().state['key:control+alt+space']).toBe(true);
  });
});

describe('press to toggle', () => {
  it('starts on one press and sends on the next, ignoring the release', () => {
    const { keyboard, onListen } = start([KEY], false);

    keyboard.press(CTRL, ALT, SPACE);
    keyboard.release(SPACE);
    vi.advanceTimersByTime(500);
    expect(onListen.mock.calls).toEqual([['start']]);

    keyboard.press(SPACE);
    expect(onListen.mock.calls).toEqual([['start'], ['stop']]);
  });
});

describe('capture', () => {
  it('answers with the chord that was pressed', async () => {
    const { keyboard, service } = start([]);
    const capture = service.capture();
    keyboard.press(CTRL, ALT, SPACE);
    await expect(capture).resolves.toEqual({
      binding: KEY,
      label: 'Control+Alt+Space',
    });
  });

  it('answers with the button that was pressed', async () => {
    const { joystick, service } = start([]);
    const capture = service.capture();
    joystick.hold();
    await expect(capture).resolves.toEqual({
      binding: BUTTON,
      label: 'VKBsim Gladiator EVO R · button 35',
    });
  });

  it('waits through a modifier: half a chord is not a binding', async () => {
    const { keyboard, service } = start([]);
    const capture = service.capture();
    keyboard.press(CTRL);
    keyboard.press(F13);
    await expect(capture).resolves.toMatchObject({ label: 'Control+F13' });
  });

  it('does not open the microphone while a binding is being rebound', async () => {
    const { keyboard, onListen, service } = start([KEY]);
    const capture = service.capture();
    // The commander presses the very chord that is already bound, to bind it somewhere else.
    keyboard.press(CTRL, ALT, SPACE);
    await expect(capture).resolves.toMatchObject({ label: 'Control+Alt+Space' });
    expect(onListen).not.toHaveBeenCalled();

    keyboard.release(CTRL, ALT, SPACE);
    vi.advanceTimersByTime(500);
    expect(onListen).not.toHaveBeenCalled();
  });

  it('closes the microphone if a capture starts while a binding is held', () => {
    const { keyboard, onListen, service } = start([KEY]);
    keyboard.press(CTRL, ALT, SPACE);
    expect(onListen.mock.calls).toEqual([['start']]);

    void service.capture();
    vi.advanceTimersByTime(500);
    expect(onListen.mock.calls).toEqual([['start'], ['stop']]);
  });

  it('answers with nothing when it is cancelled', async () => {
    const { service } = start([]);
    const capture = service.capture();
    service.cancelCapture();
    await expect(capture).resolves.toBeUndefined();
  });
});

describe('configure', () => {
  it('closes the microphone when the binding that was held is unbound', () => {
    const { keyboard, onListen, service } = start([KEY]);
    keyboard.press(CTRL, ALT, SPACE);
    expect(onListen.mock.calls).toEqual([['start']]);

    service.configure([BUTTON], true);
    expect(onListen.mock.calls).toEqual([['start'], ['stop']]);
    expect(service.snapshot().talking).toBe(false);
  });

  it('keeps holding when the binding that was held is still bound', () => {
    const { keyboard, onListen, service } = start([KEY]);
    keyboard.press(CTRL, ALT, SPACE);
    service.configure([KEY, BUTTON], true);
    expect(onListen.mock.calls).toEqual([['start']]);
    expect(service.snapshot().talking).toBe(true);
  });
});

describe('actions', () => {
  it('runs a key chord on the press, and not again while it is held', () => {
    const { keyboard, service } = start([]);
    const run = vi.fn();
    service.actions({ toggle: { bindings: [{ binding: KEY }], run } });

    keyboard.press(CTRL, ALT, SPACE);
    keyboard.press(SPACE);
    expect(run).toHaveBeenCalledTimes(1);

    keyboard.release(SPACE);
    // A real press takes longer than a bounce; pressing again in the same instant is one press.
    vi.advanceTimersByTime(120);
    keyboard.press(SPACE);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs a stick button, and says how hard it is being held', () => {
    const { joystick, service } = start([]);
    const run = vi.fn();
    service.actions({ scrollDown: { bindings: [{ binding: BUTTON }], run } });

    joystick.hold(0.6);
    expect(run).toHaveBeenCalledWith(0.6);
  });

  it('waits for a second press only where a double click is bound', () => {
    const { keyboard, service } = start([]);
    const show = vi.fn();
    const pin = vi.fn();
    service.actions({
      toggle: { bindings: [{ binding: KEY }], run: show },
      place: { bindings: [{ binding: KEY, clicks: 2 }], run: pin },
    });

    keyboard.press(CTRL, ALT, SPACE);
    expect(show).not.toHaveBeenCalled();
    keyboard.release(SPACE);
    vi.advanceTimersByTime(120);
    keyboard.press(SPACE);
    expect(pin).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
  });

  it('settles for the single click when no second press comes', () => {
    const { keyboard, service } = start([]);
    const show = vi.fn();
    service.actions({
      toggle: { bindings: [{ binding: KEY }], run: show },
      place: { bindings: [{ binding: KEY, clicks: 2 }], run: vi.fn() },
    });

    keyboard.press(CTRL, ALT, SPACE);
    keyboard.release(SPACE);
    vi.advanceTimersByTime(400);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('repeats while the control is held, and stops when it is let go', () => {
    const { joystick, service } = start([]);
    const run = vi.fn();
    service.actions({ scrollDown: { bindings: [{ binding: BUTTON }], repeat: true, run } });

    joystick.hold();
    expect(run).toHaveBeenCalledTimes(1);
    // Nothing for the first moment: one press has to mean one step.
    vi.advanceTimersByTime(300);
    expect(run).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(300);
    const repeated = run.mock.calls.length;
    expect(repeated).toBeGreaterThan(1);

    joystick.release();
    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(repeated);
  });

  it('repeats on the timing an action asks for, and says when it is let go', () => {
    const { joystick, service } = start([]);
    const run = vi.fn();
    const release = vi.fn();
    service.actions({
      scrollDown: {
        bindings: [{ binding: BUTTON }],
        repeat: true,
        repeatDelayMs: 20,
        repeatEveryMs: 20,
        run,
        release,
      },
    });

    joystick.hold();
    vi.advanceTimersByTime(200);
    expect(run.mock.calls.length).toBeGreaterThan(5);
    expect(release).not.toHaveBeenCalled();

    joystick.release();
    vi.advanceTimersByTime(100);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('counts a button that bounces as one press, not two', () => {
    const { joystick, service } = start([]);
    const run = vi.fn();
    service.actions({ toggle: { bindings: [{ binding: BUTTON }], run } });

    joystick.hold();
    joystick.release();
    // Back within a few milliseconds: the button bounced, or a report that doesn't carry it
    // arrived in between. Either way the commander pressed it once.
    vi.advanceTimersByTime(10);
    joystick.hold();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('still counts two real taps as two presses', () => {
    const { joystick, service } = start([]);
    const run = vi.fn();
    service.actions({ toggle: { bindings: [{ binding: BUTTON }], run } });

    joystick.hold();
    joystick.release();
    vi.advanceTimersByTime(120);
    joystick.hold();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not let a bounce make a triple click out of two taps', () => {
    const { joystick, service } = start([]);
    const run = vi.fn();
    service.actions({ reset: { bindings: [{ binding: BUTTON, clicks: 3 }], run } });

    for (const _tap of [1, 2]) {
      joystick.hold();
      joystick.release();
      // Every tap bounces once, which is what turned two taps into the three this wants.
      vi.advanceTimersByTime(8);
      joystick.hold();
      joystick.release();
      vi.advanceTimersByTime(120);
    }

    vi.advanceTimersByTime(400);
    expect(run).not.toHaveBeenCalled();
  });

  it('leaves a binding alone while it is being rebound', async () => {
    const { keyboard, service } = start([]);
    const run = vi.fn();
    service.actions({ toggle: { bindings: [{ binding: KEY }], run } });

    const capture = service.capture();
    keyboard.press(CTRL, ALT, SPACE);
    await expect(capture).resolves.toMatchObject({ label: 'Control+Alt+Space' });
    expect(run).not.toHaveBeenCalled();
  });

  it('stops running once it has been unbound', () => {
    const { keyboard, service } = start([]);
    const run = vi.fn();
    const unbind = service.actions({ toggle: { bindings: [{ binding: KEY }], run } });
    unbind();

    keyboard.press(CTRL, ALT, SPACE);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not fire for a chord that was already down when it was bound', () => {
    const { keyboard, service } = start([]);
    keyboard.press(CTRL, ALT, SPACE);
    const run = vi.fn();
    service.actions({ toggle: { bindings: [{ binding: KEY }], run } });
    // The same chord reported again while still held is not a new press.
    keyboard.press(SPACE);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('rebinding', () => {
  it('keeps counting a press that is already underway', () => {
    const { keyboard, service } = start([]);
    const show = vi.fn();
    const pin = vi.fn();
    const bind = () =>
      service.actions({
        toggle: { bindings: [{ binding: KEY }], run: show },
        place: { bindings: [{ binding: KEY, clicks: 2 }], run: pin },
      });

    let unbind = bind();
    keyboard.press(CTRL, ALT, SPACE);
    keyboard.release(SPACE);
    vi.advanceTimersByTime(120);

    // Something else saved — the settings file, or the cockpit's layout — so everything is bound
    // afresh between the two taps. The commander's first tap must survive it.
    unbind();
    unbind = bind();

    keyboard.press(SPACE);
    expect(pin).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
  });

  it('starts the count over when what the control does has changed', () => {
    const { keyboard, service } = start([]);
    const show = vi.fn();
    const unbind = service.actions({
      toggle: { bindings: [{ binding: KEY }], run: show },
      place: { bindings: [{ binding: KEY, clicks: 2 }], run: vi.fn() },
    });

    keyboard.press(CTRL, ALT, SPACE);
    keyboard.release(SPACE);
    vi.advanceTimersByTime(120);

    // The double click is gone, so there is nothing left to wait for and nothing half-counted.
    unbind();
    service.actions({ toggle: { bindings: [{ binding: KEY }], run: show } });

    keyboard.press(SPACE);
    expect(show).toHaveBeenCalledTimes(1);
  });
});
