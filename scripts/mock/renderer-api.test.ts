import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/** The window's sources. */
const ROOT = join(import.meta.dirname, '../../src/renderer/src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** The files that use `pattern` in code, comments aside. */
function using(pattern: RegExp): string[] {
  return sources(ROOT)
    .filter((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .some((line) => pattern.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)),
    )
    .map((file) => relative(ROOT, file).replaceAll('\\', '/'))
    .toSorted();
}

/**
 * The window is one of many EDSSIs when it is embedded in someone else's page (src/mock/), so what
 * belongs to the whole document is reached only in the places that ask the instance first.
 */
describe('the window keeps to its own instance', () => {
  it('reads window.edssi only in main.tsx', () => {
    // Anything else would draw the one main process into every mock EDSSI on a page.
    expect(using(/window\.edssi\b/)).toEqual(['main.tsx']);
  });

  it('keeps its small choices in the instance’s storage', () => {
    // Elsewhere it would write into the host page's storage, shared by every instance.
    expect(using(/\blocalStorage\b|\bsessionStorage\b/)).toEqual(['api/EdssiProvider.tsx']);
  });

  it('opens the microphone only where localDevices is asked', () => {
    expect(using(/getUserMedia|enumerateDevices/)).toEqual([
      'comms/recorder.ts',
      'settings/FieldRow.tsx',
    ]);
    expect(using(/= useLocalDevices\(\)/)).toEqual(['comms/useVoice.ts', 'settings/FieldRow.tsx']);
  });

  it('never reaches past its own box', () => {
    // The page would scroll, the clipboard isn't there, an id isn't unique among instances.
    expect(using(/scrollIntoView\(/)).toEqual([]);
    expect(using(/navigator\.clipboard/)).toEqual([]);
    expect(using(/document\.getElementById/)).toEqual(['main.tsx']);
  });

  it('listens on the window or document only for its own events', () => {
    // Keys and pastes on a host page are the page's: such a listener checks useOwnsEvent.
    const listeners = using(/(window|document)\.addEventListener\('(keydown|keyup|paste|copy)'/);
    expect(listeners).toEqual(['commodities/ScreenshotImport.tsx', 'settings/SettingsView.tsx']);
    for (const file of listeners) {
      expect(readFileSync(join(ROOT, file), 'utf8')).toContain('ownsEvent(event)');
    }
  });
});
