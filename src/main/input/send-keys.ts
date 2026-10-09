/**
 * Types a key chord into whatever has focus, by scan code.
 *
 * `uiohook-napi` can press keys too, but it sends virtual-key codes with the scan code left at
 * zero. Windows' own controls are happy with that; the game is not — it reads the keyboard by
 * scan code, so a Ctrl+V sent that way reaches it as nothing at all. `SendInput` with
 * `KEYEVENTF_SCANCODE` is a key as the keyboard driver would report it, and Windows works out the
 * virtual key from it for everything else.
 *
 * Its own module, loaded only when a chord is first sent, so a machine where koffi won't load
 * still starts; the caller reports it.
 */

import type { Chord } from './keyboard';
import { modifierKeys } from './keyboard';

const INPUT_KEYBOARD = 1;
const KEYEVENTF_EXTENDEDKEY = 0x0001;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_SCANCODE = 0x0008;

/**
 * How long the keys stay down. Sent down and up in one breath, a game that looks at the keyboard
 * once a frame can miss the press entirely; this is under two frames at 60 fps, and nobody's
 * paste is waiting on it.
 */
const HOLD_MS = 40;

export interface KeySender {
  /** Presses the chord, holds it a moment, and lets it go. Throws if Windows refused it. */
  tap(chord: Chord): Promise<void>;
}

/** One key as `SendInput` wants it. libuiohook's key codes are set-1 scan codes. */
export interface ScanKey {
  scan: number;
  extended: boolean;
}

/**
 * libuiohook writes an extended key's `E0` prefix into its code (`CtrlRight` is `0x0E1D`, the
 * arrows `0xE0xx`); the scan code itself is the low byte either way.
 */
export function scanKey(keycode: number): ScanKey {
  return { scan: keycode & 0xff, extended: keycode > 0xff };
}

/** The keys of a chord in the order they go down: modifiers first, as a hand would. */
export function chordKeys(chord: Chord): ScanKey[] {
  return [...modifierKeys(chord), chord.keycode].map(scanKey);
}

export function loadKeySender(): KeySender {
  /* oxlint-disable-next-line typescript/no-require-imports, typescript/no-unsafe-type-assertion --
     loaded late on purpose; `require` has no types of its own to narrow from */
  const koffi = require('koffi') as typeof import('koffi');
  const user32 = koffi.load('user32.dll');

  const KEYBDINPUT = koffi.struct('EDSSI_KEYBDINPUT', {
    wVk: 'uint16',
    wScan: 'uint16',
    dwFlags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uintptr',
  });
  // `INPUT` is a union of mouse, keyboard and hardware input, as large as the mouse one: padded
  // out here so `cbSize` is what Windows expects, or it refuses the lot.
  const INPUT = koffi.struct('EDSSI_INPUT', {
    type: 'uint32',
    ki: KEYBDINPUT,
    padding: koffi.array('uint8', 8),
  });
  const SendInput = user32.func(
    'uint32 __stdcall SendInput(uint32 cInputs, EDSSI_INPUT *pInputs, int cbSize)',
  );
  const size = koffi.sizeof(INPUT);

  function send(keys: readonly ScanKey[], up: boolean): void {
    const inputs = keys.map((key) => ({
      type: INPUT_KEYBOARD,
      ki: {
        wVk: 0,
        wScan: key.scan,
        dwFlags:
          KEYEVENTF_SCANCODE |
          (key.extended ? KEYEVENTF_EXTENDEDKEY : 0) |
          (up ? KEYEVENTF_KEYUP : 0),
        time: 0,
        dwExtraInfo: 0,
      },
      padding: Array.from({ length: 8 }, () => 0),
    }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- koffi answers the C type
    const sent = SendInput(inputs.length, inputs, size) as number;
    if (sent !== inputs.length) {
      throw new Error(`Windows took ${sent} of ${inputs.length} keys`);
    }
  }

  return {
    async tap(chord) {
      const keys = chordKeys(chord);
      send(keys, false);
      try {
        await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
      } finally {
        // Let go in reverse, and always: a Ctrl left down would haunt every key after it.
        send([...keys].reverse(), true);
      }
    },
  };
}
