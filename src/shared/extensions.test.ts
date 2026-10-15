import { describe, expect, it } from 'vitest';

import { type ExtensionInfo, needsRestart, parseExtensionsFile, parseManifest } from './extensions';

describe('parseManifest', () => {
  it('reads what a build writes', () => {
    const manifest = {
      name: 'plotter-2',
      apiVersion: 1,
      main: 'main.js',
      renderer: 'renderer.js',
      style: 'renderer.css',
    };
    expect(parseManifest(manifest)).toEqual(manifest);
  });

  it('takes a name that can be the host of a URL, and nothing else', () => {
    expect(parseManifest({ name: 'Plotter', apiVersion: 1 })).toHaveProperty('problem');
    expect(parseManifest({ name: 'a b', apiVersion: 1 })).toHaveProperty('problem');
    expect(parseManifest({ name: '', apiVersion: 1 })).toHaveProperty('problem');
  });

  it('wants an API version', () => {
    expect(parseManifest({ name: 'x' })).toHaveProperty('problem');
    expect(parseManifest(null)).toHaveProperty('problem');
  });

  it('keeps its files inside its folder', () => {
    for (const main of ['../main.js', '/main.js', 'C:\\main.js', 'a\\..\\..\\main.js', '', 3]) {
      expect(parseManifest({ name: 'x', apiVersion: 1, main })).toHaveProperty('problem');
    }
    expect(parseManifest({ name: 'x', apiVersion: 1, main: 'dist/main.js' })).toEqual({
      name: 'x',
      apiVersion: 1,
      main: 'dist/main.js',
    });
  });
});

describe('parseExtensionsFile', () => {
  it('keeps the names turned off', () => {
    expect(parseExtensionsFile({ disabled: ['plotter', 3, 'mover'] })).toEqual({
      disabled: ['plotter', 'mover'],
    });
  });

  it('turns nothing off for a missing or broken file', () => {
    expect(parseExtensionsFile(null)).toEqual({ disabled: [] });
    expect(parseExtensionsFile({ disabled: 'plotter' })).toEqual({ disabled: [] });
  });
});

function extension(state: ExtensionInfo['state'], enabled: boolean): ExtensionInfo {
  return { name: 'plotter', source: 'installed', state, enabled };
}

describe('needsRestart', () => {
  it('is needed once the next start would differ from this one', () => {
    expect(needsRestart(extension('running', true))).toBe(false);
    expect(needsRestart(extension('running', false))).toBe(true);
    expect(needsRestart(extension('disabled', false))).toBe(false);
    expect(needsRestart(extension('disabled', true))).toBe(true);
  });

  it('is never needed for one left out for a built-in one', () => {
    expect(needsRestart(extension('shadowed', false))).toBe(false);
  });
});
