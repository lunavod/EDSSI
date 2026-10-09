import { describe, expect, it } from 'vitest';

import { chordHeld, chordOf, formatChord, modifierOf, parseAccelerator } from './keyboard';

/** The codes the hook reports, for the keys these tests press. */
const CTRL = 29;
const CTRL_RIGHT = 3613;
const ALT = 56;
const SHIFT = 42;
const SPACE = 57;
const A = 30;

describe('parseAccelerator', () => {
  it('reads a chord the way the settings file writes it', () => {
    expect(parseAccelerator('Control+Alt+Space')).toEqual({
      keycode: SPACE,
      modifiers: ['Control', 'Alt'],
    });
  });

  it('accepts the names Electron accepts, in any case and any order', () => {
    const expected = { keycode: A, modifiers: ['Control', 'Shift'] };
    expect(parseAccelerator('CommandOrControl+Shift+A')).toEqual(expected);
    expect(parseAccelerator('shift+ctrl+a')).toEqual(expected);
  });

  it('always writes the modifiers in the same order', () => {
    const chord = parseAccelerator('Shift+Alt+Control+Space')!;
    expect(formatChord(chord)).toBe('Control+Alt+Shift+Space');
  });

  it('reads a trailing plus as the key itself', () => {
    expect(parseAccelerator('Control++')).toEqual(parseAccelerator('Control+Plus'));
  });

  it('refuses what it cannot watch for, rather than binding nothing', () => {
    expect(parseAccelerator('')).toBeUndefined();
    expect(parseAccelerator('Control')).toBeUndefined();
    expect(parseAccelerator('Control+Alt')).toBeUndefined();
    expect(parseAccelerator('A+B')).toBeUndefined();
    expect(parseAccelerator('Control+NoSuchKey')).toBeUndefined();
  });
});

describe('chordHeld', () => {
  const chord = parseAccelerator('Control+Alt+Space')!;

  it('is held when the key and its modifiers are down', () => {
    expect(chordHeld(chord, new Set([CTRL, ALT, SPACE]))).toBe(true);
  });

  it('takes either side of a modifier', () => {
    expect(chordHeld(chord, new Set([CTRL_RIGHT, ALT, SPACE]))).toBe(true);
  });

  it('is not held while a modifier is missing', () => {
    expect(chordHeld(chord, new Set([CTRL, SPACE]))).toBe(false);
    expect(chordHeld(chord, new Set([CTRL, ALT]))).toBe(false);
  });

  it('is not held when a modifier that is not part of it is down', () => {
    // The same rule globalShortcut used, so an existing binding behaves as it always did.
    expect(chordHeld(chord, new Set([CTRL, ALT, SHIFT, SPACE]))).toBe(false);
  });

  it('lets go as soon as the key does', () => {
    const held = new Set([CTRL, ALT, SPACE]);
    expect(chordHeld(chord, held)).toBe(true);
    held.delete(SPACE);
    expect(chordHeld(chord, held)).toBe(false);
  });

  it('holds a chord with no modifiers only when nothing else is down', () => {
    const plain = parseAccelerator('Space')!;
    expect(chordHeld(plain, new Set([SPACE]))).toBe(true);
    expect(chordHeld(plain, new Set([CTRL, SPACE]))).toBe(false);
  });
});

describe('chordOf', () => {
  it('takes the chord a press makes, for the settings screen', () => {
    const chord = chordOf(SPACE, new Set([CTRL, ALT, SPACE]))!;
    expect(formatChord(chord)).toBe('Control+Alt+Space');
  });

  it('ignores a modifier pressed on its own: it is half a chord, not a binding', () => {
    expect(chordOf(CTRL, new Set([CTRL]))).toBeUndefined();
    expect(modifierOf(CTRL)).toBe('Control');
    expect(modifierOf(SPACE)).toBeUndefined();
  });

  it('ignores a key it has no name for, rather than binding a number', () => {
    expect(chordOf(9999, new Set([9999]))).toBeUndefined();
  });

  it('round-trips whatever it captures', () => {
    const chord = chordOf(A, new Set([SHIFT, A]))!;
    expect(parseAccelerator(formatChord(chord))).toEqual(chord);
  });
});
