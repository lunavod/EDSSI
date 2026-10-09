import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseAccelerator } from '../input/keyboard';
import {
  DEFAULT_KEYS,
  DEFAULT_LAYOUT,
  isVrCommand,
  layoutWithDefaults,
  loadLayout,
  saveLayout,
  VR_COMMANDS,
} from './layout';
import { DEFAULT_PLACEMENTS } from './panels';
import { DEFAULT_RIG } from './rig';
import { DEFAULT_SEAMS } from './seams';

function tempFile(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'edssi-vr-')), name);
}

describe('DEFAULT_KEYS', () => {
  it('is bound to chords the keyboard hook can actually parse', () => {
    for (const accelerator of Object.keys(DEFAULT_KEYS)) {
      expect(parseAccelerator(accelerator), accelerator).toBeDefined();
    }
  });

  it('binds every command there is, so none is unreachable', () => {
    const bound = new Set(Object.values(DEFAULT_KEYS));
    for (const command of Object.keys(VR_COMMANDS))
      expect(bound.has(command as never), command).toBe(true);
  });

  it('uses no numeric keypad key, which not every keyboard has', () => {
    for (const accelerator of Object.keys(DEFAULT_KEYS)) {
      expect(accelerator.toLowerCase(), accelerator).not.toMatch(/num/);
    }
  });

  it('never binds one chord twice', () => {
    const chords = Object.keys(DEFAULT_KEYS).map((a) => JSON.stringify(parseAccelerator(a)));
    expect(new Set(chords).size).toBe(chords.length);
  });

  it('leaves Control+Alt+Arrow alone, which rotates the desktop on Intel graphics', () => {
    for (const accelerator of Object.keys(DEFAULT_KEYS)) {
      const chord = parseAccelerator(accelerator);
      const arrow = /Up|Down|Left|Right/.test(accelerator);
      const bare =
        chord?.modifiers.includes('Control') === true &&
        chord.modifiers.includes('Alt') &&
        !chord.modifiers.includes('Shift');
      expect(arrow && bare, accelerator).toBe(false);
    }
  });
});

describe('VR_COMMANDS', () => {
  it('moves the whole rig, so summoning brings the cockpit along', () => {
    const moved = VR_COMMANDS.right(DEFAULT_LAYOUT, 'main');
    expect(moved.rig.x).toBeGreaterThan(DEFAULT_RIG.x);
    expect(moved.panels).toEqual(DEFAULT_PLACEMENTS);
  });

  it('moves one panel instead once the scope is switched', () => {
    const scoped = VR_COMMANDS.toggleScope(DEFAULT_LAYOUT, 'main');
    expect(scoped.scope).toBe('panel');
    const moved = VR_COMMANDS.right(scoped, 'sidebar');
    expect(moved.rig).toEqual(DEFAULT_RIG);
    expect(moved.panels.sidebar.x).toBeGreaterThan(DEFAULT_PLACEMENTS.sidebar.x);
    expect(moved.panels.main).toEqual(DEFAULT_PLACEMENTS.main);
  });

  it('sizes the panel being looked at, whatever the scope, since a rig has no size', () => {
    // The sidebar owns its width, so `wider` is its own business.
    const wider = VR_COMMANDS.wider(DEFAULT_LAYOUT, 'sidebar');
    expect(wider.panels.sidebar.widthMeters).toBeGreaterThan(
      DEFAULT_PLACEMENTS.sidebar.widthMeters,
    );
    expect(wider.rig).toEqual(DEFAULT_RIG);
  });

  it('sizes the main panel when the looked-at one does not own that side', () => {
    // The bug this exists for: a side panel is as tall as the main one, so `taller` on it changed
    // a number nothing reads and appeared to do nothing at all. What the commander means is that
    // the cockpit should be taller.
    const taller = VR_COMMANDS.taller(DEFAULT_LAYOUT, 'sidebar');
    expect(taller.panels.main.heightMeters).toBeGreaterThan(DEFAULT_PLACEMENTS.main.heightMeters);
    expect(taller.panels.sidebar).toEqual(DEFAULT_PLACEMENTS.sidebar);

    // And a strip is as wide as the main one, so `wider` on it widens the middle.
    const wider = VR_COMMANDS.wider(DEFAULT_LAYOUT, 'route');
    expect(wider.panels.main.widthMeters).toBeGreaterThan(DEFAULT_PLACEMENTS.main.widthMeters);
    expect(wider.panels.route).toEqual(DEFAULT_PLACEMENTS.route);
  });

  it('leaves the side each panel does own to that panel', () => {
    // A strip owns its height, a side panel its width; those stay where they are looked at.
    expect(VR_COMMANDS.taller(DEFAULT_LAYOUT, 'route').panels.route.heightMeters).toBeGreaterThan(
      DEFAULT_PLACEMENTS.route.heightMeters,
    );
    expect(VR_COMMANDS.taller(DEFAULT_LAYOUT, 'route').panels.main).toEqual(
      DEFAULT_PLACEMENTS.main,
    );
  });

  it('leaves the layout alone when scrolling, which is the service’s business', () => {
    expect(VR_COMMANDS.scrollUp(DEFAULT_LAYOUT, 'main')).toBe(DEFAULT_LAYOUT);
  });

  it('turns one panel off and on again', () => {
    const off = VR_COMMANDS.togglePanel(DEFAULT_LAYOUT, 'comms');
    expect(off.panels.comms.enabled).toBe(false);
    expect(VR_COMMANDS.togglePanel(off, 'comms').panels.comms.enabled).toBe(true);
  });

  it('re-pins whenever the cockpit is summoned', () => {
    const hidden = VR_COMMANDS.toggle(DEFAULT_LAYOUT, 'main');
    expect(hidden.rig.visible).toBe(false);
    expect(hidden.rig.anchor).toBe(DEFAULT_RIG.anchor);
    expect(VR_COMMANDS.toggle(hidden, 'main').rig.anchor).toBe(DEFAULT_RIG.anchor + 1);
  });

  it('puts the whole cockpit back with reset, and fetches it in front of the commander', () => {
    const moved = VR_COMMANDS.wider(VR_COMMANDS.right(DEFAULT_LAYOUT, 'main'), 'sidebar');
    const reset = VR_COMMANDS.reset(moved, 'main');
    expect(reset.panels).toEqual(DEFAULT_PLACEMENTS);
    expect(reset.rig.anchor).toBe(moved.rig.anchor + 1);
    expect({ ...reset.rig, anchor: DEFAULT_RIG.anchor }).toEqual(DEFAULT_RIG);
  });
});

describe('layoutWithDefaults', () => {
  it('fills in a default key for every command the file does not bind', () => {
    // The bug this exists for: a file written before a command existed left it unreachable.
    const written = Object.fromEntries(
      Object.entries(DEFAULT_KEYS).filter(([, command]) => command !== 'scrollUp'),
    );
    expect(layoutWithDefaults({ keys: written }).keys).toEqual(DEFAULT_KEYS);
  });

  it('leaves a rebound command alone rather than handing it back its default', () => {
    const keys = layoutWithDefaults({ keys: { 'Control+Shift+F1': 'scrollUp' } }).keys;
    expect(keys['Control+Shift+F1']).toBe('scrollUp');
    expect(keys['Control+Shift+PageUp']).toBeUndefined();
  });

  it('drops a binding that names nothing', () => {
    expect(
      layoutWithDefaults({ keys: { 'Control+Shift+J': 'nonsense' } }).keys['Control+Shift+J'],
    ).toBeUndefined();
  });

  it('reads a rig saved as a single panel pose, from before the cockpit had five', () => {
    const layout = layoutWithDefaults({ pose: { x: 0.25, lock: 'head', visible: false } });
    expect(layout.rig.x).toBe(0.25);
    expect(layout.rig.lock).toBe('head');
    expect(layout.rig.visible).toBe(false);
  });

  it('defaults anything it is given that is not a layout', () => {
    for (const value of [null, 'over there', 3]) {
      expect(layoutWithDefaults(value)).toEqual(DEFAULT_LAYOUT);
    }
  });
});

describe('loadLayout', () => {
  it('reads back the rig, the panels and the commander’s own bindings', () => {
    const path = tempFile('vr-overlay.json');
    const layout = VR_COMMANDS.wider(VR_COMMANDS.right(DEFAULT_LAYOUT, 'main'), 'stats');
    saveLayout(layout, path);

    const read = loadLayout(path);
    expect(read.rig).toEqual(layout.rig);
    expect(read.panels).toEqual(layout.panels);
  });

  it('falls back to the defaults when there is no file', () => {
    expect(loadLayout(tempFile('missing.json'))).toEqual(DEFAULT_LAYOUT);
  });

  it('falls back rather than leaving the cockpit nowhere', () => {
    const path = tempFile('broken.json');
    writeFileSync(path, '{ not json', 'utf8');
    expect(loadLayout(path)).toEqual(DEFAULT_LAYOUT);
  });
});

describe('saveLayout', () => {
  it('writes nothing at all when nothing has been changed', () => {
    const path = tempFile('untouched.json');
    saveLayout(DEFAULT_LAYOUT, path);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({});
  });

  it('writes only the fields that differ, so later defaults still reach the commander', () => {
    // The bug this exists for: writing every field froze the defaults the day the file was first
    // written, and a value nobody chose then outranked a better one forever.
    const path = tempFile('changed.json');
    saveLayout(VR_COMMANDS.wider(DEFAULT_LAYOUT, 'sidebar'), path);

    const written = JSON.parse(readFileSync(path, 'utf8'));
    expect(Object.keys(written)).toEqual(['panels']);
    expect(Object.keys(written.panels)).toEqual(['sidebar']);
    expect(Object.keys(written.panels.sidebar)).toEqual(['widthMeters']);
  });

  it('reads back as the same cockpit', () => {
    const path = tempFile('roundtrip.json');
    const layout = VR_COMMANDS.taller(VR_COMMANDS.right(DEFAULT_LAYOUT, 'main'), 'route');
    saveLayout(layout, path);
    expect(loadLayout(path)).toEqual(layout);
  });

  it('keeps a hand-edited seam, and writes nothing for one left at its default', () => {
    const path = tempFile('seams.json');
    saveLayout({ ...DEFAULT_LAYOUT, seams: { ...DEFAULT_SEAMS, thickness: 0.02 } }, path);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ seams: { thickness: 0.02 } });
    expect(loadLayout(path).seams).toEqual({ ...DEFAULT_SEAMS, thickness: 0.02 });
  });

  it('keeps a binding the commander moved, and forgets one they left alone', () => {
    const path = tempFile('keys.json');
    saveLayout({ ...DEFAULT_LAYOUT, keys: { ...DEFAULT_KEYS, 'Control+Shift+F9': 'place' } }, path);
    expect(JSON.parse(readFileSync(path, 'utf8')).keys).toEqual({ 'Control+Shift+F9': 'place' });
  });
});

describe('seams in the file', () => {
  it('defaults the lot when the file says nothing about them', () => {
    expect(layoutWithDefaults({ panels: {} }).seams).toEqual(DEFAULT_SEAMS);
  });

  it('is put back by reset, along with everything else', () => {
    const changed = { ...DEFAULT_LAYOUT, seams: { ...DEFAULT_SEAMS, enabled: false } };
    expect(VR_COMMANDS.reset(changed, 'main').seams).toEqual(DEFAULT_SEAMS);
  });
});

describe('isVrCommand', () => {
  it('recognises its own names and nothing else', () => {
    for (const name of Object.keys(VR_COMMANDS)) expect(isVrCommand(name)).toBe(true);
    for (const name of ['', 'Up', 'x', 'toggleVisible', 42, null]) {
      expect(isVrCommand(name)).toBe(false);
    }
  });
});
