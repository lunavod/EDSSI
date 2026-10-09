/**
 * The global keyboard hook, and the translation between Electron's accelerator strings and the
 * key codes the hook reports.
 *
 * Electron's own `globalShortcut` only fires on the way down — there is no key-up and no repeat —
 * so it can't hold the microphone open for as long as a key is held. `uiohook-napi` installs a
 * low-level Windows hook instead, which reports both edges even while the game has focus.
 *
 * Everything except `startKeyboardHook` is pure, so the chord logic is tested without a hook.
 */

/**
 * libuiohook's key codes, as `uiohook-napi` exports them. They are copied rather than imported so
 * that reading a settings file doesn't load the native module — and so this is testable anywhere.
 */
const KEY_CODES = `Escape:1 Backspace:14 Tab:15 Enter:28 CapsLock:58 Space:57
  PageUp:3657 PageDown:3665 End:3663 Home:3655 Insert:3666 Delete:3667
  ArrowLeft:57419 ArrowUp:57416 ArrowRight:57421 ArrowDown:57424
  A:30 B:48 C:46 D:32 E:18 F:33 G:34 H:35 I:23 J:36 K:37 L:38 M:50 N:49 O:24 P:25 Q:16 R:19
  S:31 T:20 U:22 V:47 W:17 X:45 Y:21 Z:44
  0:11 1:2 2:3 3:4 4:5 5:6 6:7 7:8 8:9 9:10
  Numpad0:82 Numpad1:79 Numpad2:80 Numpad3:81 Numpad4:75 Numpad5:76 Numpad6:77 Numpad7:71
  Numpad8:72 Numpad9:73 NumpadMultiply:55 NumpadAdd:78 NumpadSubtract:74 NumpadDecimal:83
  NumpadDivide:3637 NumpadEnter:3612
  F1:59 F2:60 F3:61 F4:62 F5:63 F6:64 F7:65 F8:66 F9:67 F10:68 F11:87 F12:88 F13:91 F14:92
  F15:93 F16:99 F17:100 F18:101 F19:102 F20:103 F21:104 F22:105 F23:106 F24:107
  Semicolon:39 Equal:13 Comma:51 Minus:12 Period:52 Slash:53 Backquote:41 BracketLeft:26
  Backslash:43 BracketRight:27 Quote:40
  Ctrl:29 CtrlRight:3613 Alt:56 AltRight:3640 Shift:42 ShiftRight:54 Meta:3675 MetaRight:3676
  NumLock:69 ScrollLock:70 PrintScreen:3639`;

const UiohookKey: Record<string, number> = Object.fromEntries(
  KEY_CODES.split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const [name, code] = pair.split(':');
      return [name!, Number(code)];
    }),
);

/** A key chord: one key, and the modifiers that must be down with it. */
export interface Chord {
  keycode: number;
  /** Modifier families, in the order they are written back out. */
  modifiers: ModifierName[];
}

export type ModifierName = 'Control' | 'Alt' | 'Shift' | 'Super';

/** Every name in `KEY_CODES` is known to be there, so a miss is a typo in the table above. */
function keyFor(name: string): number {
  const value = UiohookKey[name];
  if (value === undefined) throw new Error(`No key code for ${name}`);
  return value;
}

/** Both sides of each modifier count: the commander may use either hand. */
const MODIFIERS: Record<ModifierName, readonly number[]> = {
  Control: [keyFor('Ctrl'), keyFor('CtrlRight')],
  Alt: [keyFor('Alt'), keyFor('AltRight')],
  Shift: [keyFor('Shift'), keyFor('ShiftRight')],
  Super: [keyFor('Meta'), keyFor('MetaRight')],
};

const MODIFIER_ORDER: ModifierName[] = ['Control', 'Alt', 'Shift', 'Super'];

/** How a modifier may be written in a settings file, lower case. */
const MODIFIER_ALIASES: Record<string, ModifierName> = {
  control: 'Control',
  ctrl: 'Control',
  // EDSSI is Windows-only, so the "or" in CommandOrControl always lands on Control.
  commandorcontrol: 'Control',
  cmdorctrl: 'Control',
  command: 'Super',
  cmd: 'Super',
  super: 'Super',
  meta: 'Super',
  alt: 'Alt',
  altgr: 'Alt',
  option: 'Alt',
  shift: 'Shift',
};

/** Accelerator key names that aren't simply the `UiohookKey` name, lower case. */
const KEY_ALIASES: Record<string, string> = {
  return: 'Enter',
  esc: 'Escape',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  pgup: 'PageUp',
  pgdn: 'PageDown',
  plus: 'Equal',
  '+': 'Equal',
  '-': 'Minus',
  '=': 'Equal',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backquote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  num0: 'Numpad0',
  num1: 'Numpad1',
  num2: 'Numpad2',
  num3: 'Numpad3',
  num4: 'Numpad4',
  num5: 'Numpad5',
  num6: 'Numpad6',
  num7: 'Numpad7',
  num8: 'Numpad8',
  num9: 'Numpad9',
  numadd: 'NumpadAdd',
  numsub: 'NumpadSubtract',
  nummult: 'NumpadMultiply',
  numdiv: 'NumpadDivide',
  numdec: 'NumpadDecimal',
  printscreen: 'PrintScreen',
  capslock: 'CapsLock',
  numlock: 'NumLock',
  scrolllock: 'ScrollLock',
};

/** Key code to the name it is written with. Built once; the first name for a code wins. */
const NAMES = new Map<number, string>();
for (const [name, code] of Object.entries(UiohookKey)) {
  if (!NAMES.has(code)) NAMES.set(code, name);
}

const MODIFIER_CODES = new Map<number, ModifierName>();
for (const [name, codes] of Object.entries(MODIFIERS)) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the keys of MODIFIERS
  for (const code of codes) MODIFIER_CODES.set(code, name as ModifierName);
}

/** The modifier family a key belongs to, or undefined for an ordinary key. */
export function modifierOf(keycode: number): ModifierName | undefined {
  return MODIFIER_CODES.get(keycode);
}

/**
 * Parsed accelerators, because this is asked on every report the sticks send — a couple of hundred
 * a second between two of them — and the answer only changes when the settings do.
 */
const PARSED = new Map<string, Chord | undefined>();

/**
 * Reads an accelerator such as `Control+Alt+Space`. Returns undefined for one EDSSI can't watch
 * for, so the settings screen can say so rather than binding something that never fires.
 */
export function parseAccelerator(accelerator: string): Chord | undefined {
  if (PARSED.has(accelerator)) return PARSED.get(accelerator);
  const chord = readAccelerator(accelerator);
  PARSED.set(accelerator, chord);
  return chord;
}

function readAccelerator(accelerator: string): Chord | undefined {
  const parts = accelerator
    .split('+')
    // A trailing `+` means the plus key itself: "Control++" is Control and Plus.
    .flatMap((part, index, all) =>
      part === '' && index > 0 && index === all.length - 1 ? ['+'] : [part],
    )
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;

  const modifiers: ModifierName[] = [];
  let key: string | undefined;
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      continue;
    }
    // Two ordinary keys in one chord is not something a keyboard can report.
    if (key !== undefined) return undefined;
    key = part;
  }
  if (key === undefined) return undefined;

  const keycode = keycodeOf(key);
  if (keycode === undefined) return undefined;
  return { keycode, modifiers: MODIFIER_ORDER.filter((name) => modifiers.includes(name)) };
}

/** Writes a chord back out the way a settings file spells it. */
export function formatChord(chord: Chord): string {
  const key = NAMES.get(chord.keycode) ?? `Key${chord.keycode}`;
  return [...chord.modifiers, key].join('+');
}

/**
 * Whether a chord is held, given every key that is down. The modifiers must match exactly, so
 * `Control+Alt+Space` doesn't fire while Shift is also held — the same rule `globalShortcut` uses.
 */
export function chordHeld(chord: Chord, held: ReadonlySet<number>): boolean {
  if (!held.has(chord.keycode)) return false;
  for (const name of MODIFIER_ORDER) {
    const down = MODIFIERS[name].some((code) => held.has(code));
    if (down !== chord.modifiers.includes(name)) return false;
  }
  return true;
}

/** The chord a key press makes, given the modifiers held with it, for the settings screen. */
export function chordOf(keycode: number, held: ReadonlySet<number>): Chord | undefined {
  if (modifierOf(keycode) !== undefined) return undefined;
  if (!NAMES.has(keycode)) return undefined;
  const modifiers = MODIFIER_ORDER.filter((name) => MODIFIERS[name].some((code) => held.has(code)));
  return { keycode, modifiers };
}

/** Key names are matched without regard to case, so `space`, `Space` and `SPACE` all work. */
function keycodeOf(key: string): number | undefined {
  const alias = KEY_ALIASES[key.toLowerCase()];
  if (alias !== undefined) return UiohookKey[alias];
  const name = Object.keys(UiohookKey).find((known) => known.toLowerCase() === key.toLowerCase());
  return name === undefined ? undefined : UiohookKey[name];
}

export interface KeyboardHook {
  stop(): void;
}

/** The keys to hold for a chord's modifiers: the left-hand one of each, as a keyboard would. */
export function modifierKeys(chord: Chord): number[] {
  return chord.modifiers.map((name) => MODIFIERS[name][0]!);
}

export interface KeyboardHandlers {
  /** Every key that is currently down, after this event. */
  onChange(held: ReadonlySet<number>): void;
  /** A key going down, so a capture can take the chord it makes. */
  onPress(keycode: number, held: ReadonlySet<number>): void;
}

/**
 * Installs the hook. It is a real Windows hook on a native thread, so it is started once and left
 * running; stopping and restarting it is what makes these libraries flaky.
 */
export function startKeyboardHook(handlers: KeyboardHandlers): KeyboardHook {
  // Required here rather than at the top so a machine that can't load the native module still
  // starts — the input service catches this and reports it.
  /* oxlint-disable-next-line typescript/no-require-imports, typescript/no-unsafe-type-assertion --
     loaded late on purpose; `require` has no types of its own to narrow from */
  const { uIOhook } = require('uiohook-napi') as typeof import('uiohook-napi');
  const held = new Set<number>();

  uIOhook.on('keydown', (event) => {
    // Windows repeats a held key; only the first edge is news.
    if (held.has(event.keycode)) return;
    held.add(event.keycode);
    handlers.onChange(held);
    handlers.onPress(event.keycode, held);
  });
  uIOhook.on('keyup', (event) => {
    if (!held.delete(event.keycode)) return;
    handlers.onChange(held);
  });
  uIOhook.start();

  return {
    stop() {
      held.clear();
      uIOhook.stop();
    },
  };
}
