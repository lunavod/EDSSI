import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EXTENSION_API_VERSION, OLDEST_EXTENSION_API_VERSION } from '../shared/extensions';
import { contentType, extensionFile, findInstalledExtensions } from './installed-extensions';

describe('findInstalledExtensions', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'edssi-extensions-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function install(folder: string, manifest: unknown): void {
    mkdirSync(join(dir, folder));
    writeFileSync(
      join(dir, folder, 'extension.json'),
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    );
  }

  it('loads one built against any version from the oldest still supported', () => {
    install('first', { name: 'first', apiVersion: OLDEST_EXTENSION_API_VERSION });
    const { found, problems } = findInstalledExtensions(dir);
    expect(problems).toEqual([]);
    expect(found.map(({ manifest }) => manifest.name)).toEqual(['first']);
  });

  it('finds nothing in a folder that is not there', () => {
    expect(findInstalledExtensions(join(dir, 'missing'))).toEqual({ found: [], problems: [] });
  });

  it('finds each built extension, and says why the others are left out', () => {
    install('good', { name: 'good', apiVersion: EXTENSION_API_VERSION, main: 'main.js' });
    install('old', { name: 'old', apiVersion: OLDEST_EXTENSION_API_VERSION - 1, main: 'main.js' });
    install('new', { name: 'new', apiVersion: EXTENSION_API_VERSION + 1, main: 'main.js' });
    install('broken', '{');
    install('climbing', { name: 'climbing', apiVersion: EXTENSION_API_VERSION, main: '../x.js' });
    install('later', { name: 'good', apiVersion: EXTENSION_API_VERSION });
    mkdirSync(join(dir, 'source'));
    writeFileSync(join(dir, 'stray.txt'), '');

    const { found, problems } = findInstalledExtensions(dir);
    expect(found).toEqual([
      {
        manifest: { name: 'good', apiVersion: EXTENSION_API_VERSION, main: 'main.js' },
        root: join(dir, 'good'),
      },
    ]);
    expect(problems).toHaveLength(6);
    expect(problems.join('\n')).toMatch(/old was built for extension API .*build it again/);
    expect(problems.join('\n')).toMatch(/new was built for extension API .*update EDSSI/);
    expect(problems.join('\n')).toMatch(/source has no extension.json/);
    expect(problems.join('\n')).toMatch(/good is installed twice; later is left out/);
  });
});

describe('extensionFile', () => {
  const root = join(tmpdir(), 'ext');

  it('names files in the folder', () => {
    expect(extensionFile(root, '/renderer.js')).toBe(join(root, 'renderer.js'));
    expect(extensionFile(root, '/assets/a%20b.png')).toBe(join(root, 'assets', 'a b.png'));
  });

  it('never names anything outside it, nor the folder itself', () => {
    expect(extensionFile(root, '/')).toBeUndefined();
    expect(extensionFile(root, '/../secret.txt')).toBeUndefined();
    expect(extensionFile(root, '/%2e%2e/secret.txt')).toBeUndefined();
    expect(extensionFile(root, '/..%5Csecret.txt')).toBeUndefined();
    expect(extensionFile(root, '/%E0%A4%A')).toBeUndefined();
  });
});

describe('contentType', () => {
  it('serves scripts as JavaScript, or the window refuses them', () => {
    expect(contentType('renderer.js')).toBe('text/javascript');
    expect(contentType('renderer.CSS')).toBe('text/css');
    expect(contentType('data.bin')).toBe('application/octet-stream');
  });
});
