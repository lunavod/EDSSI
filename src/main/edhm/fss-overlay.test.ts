import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  downloadOriginal,
  FSS_SHADERS,
  fssOverlayStatus,
  installFssOverlay,
  MOD_NAME,
} from './fss-overlay';
import { makeZip } from './zip-fixture';

const SHADER =
  'ps_5_0\ndcl_resource_texture2d (float,float,float,float) t1\n' +
  'dcl_resource_texture2d (float,float,float,float) t2\n';
const ORIGINAL_INI = `[ShaderOverride-Quality-Ultra-High]\nhash = ${FSS_SHADERS[0]}\n`;

let game: string;
let bundle: string;
const mods = () => join(game, 'EDHM-ini', '3rdPartyMods');
const parked = () => join(game, 'EDHM-ini', '3rdPartyMods-disabled');

function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function originalZip(): Buffer {
  return makeZip({
    'EDHM-ini/3rdPartyMods/FSS-Overlay/': '',
    'EDHM-ini/3rdPartyMods/FSS-Overlay/FSS-Overlay.ini': ORIGINAL_INI,
    'EDHM-ini/3rdPartyMods/FSS-Overlay/Textures/FSS-Overlay-Parduz1.png': 'png',
    ...Object.fromEntries(FSS_SHADERS.map((hash) => [`ShaderFixes/${hash}-ps.txt`, SHADER])),
    'ShaderFixes/../../evil.txt': 'nope',
    'd3dx.ini': 'not ours to overwrite',
  });
}

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'edssi-fss-'));
  game = join(root, 'game');
  bundle = join(root, 'bundle');
  write(join(game, 'd3dx.ini'), 'include_recursive = EDHM-ini/3rdPartyMods\n');
  mkdirSync(mods(), { recursive: true });
  write(join(bundle, MOD_NAME, `${MOD_NAME}.ini`), `hash = ${FSS_SHADERS[0]}\n`);
  write(join(bundle, MOD_NAME, 'Textures', `${MOD_NAME}.png`), 'png');
});

describe('installFssOverlay', () => {
  it('downloads the shaders when they’re missing, and keeps the original switched off', async () => {
    const download = vi.fn(async () => originalZip());
    const result = await installFssOverlay({ gameDir: game, bundleDir: bundle, download });

    expect(download).toHaveBeenCalledOnce();
    expect(result.downloaded).toBe(true);
    for (const hash of FSS_SHADERS) {
      expect(readFileSync(join(game, 'ShaderFixes', `${hash}-ps.txt`), 'utf8')).toBe(SHADER);
    }
    expect(existsSync(join(parked(), 'FSS-Overlay', 'Textures', 'FSS-Overlay-Parduz1.png'))).toBe(
      true,
    );
    expect(existsSync(join(mods(), 'FSS-Overlay'))).toBe(false);
    expect(existsSync(join(mods(), MOD_NAME, 'Textures', `${MOD_NAME}.png`))).toBe(true);
    expect(readFileSync(join(game, 'd3dx.ini'), 'utf8')).toContain('include_recursive');
    expect(existsSync(join(game, '..', 'evil.txt'))).toBe(false);
    expect(result.status).toEqual({
      state: 'ready',
      gameDir: game,
      installed: true,
      shaders: true,
      conflicts: [],
    });
  });

  it('parks the installed original and any other mod on the same shaders', async () => {
    for (const hash of FSS_SHADERS) write(join(game, 'ShaderFixes', `${hash}-ps.txt`), SHADER);
    write(join(mods(), 'FSS-Overlay', 'FSS-Overlay.ini'), ORIGINAL_INI);
    write(join(mods(), 'FSS-Overlay', 'FSS-Overlay.json'), '{}');
    write(join(mods(), 'MyFss.ini'), `hash=0x${FSS_SHADERS[2]}\n`);
    write(join(mods(), 'MyFss.png'), 'png');
    write(join(mods(), 'Hyperspace', 'Hyperspace.ini'), 'hash = 1234567890abcdef\n');
    // Parked before, by hand.
    write(join(parked(), 'FSS-Overlay', 'FSS-Overlay.ini'), ORIGINAL_INI);

    expect(fssOverlayStatus(game)).toMatchObject({
      installed: false,
      shaders: true,
      conflicts: expect.arrayContaining(['FSS-Overlay', 'MyFss']),
    });

    const download = vi.fn(async () => originalZip());
    const result = await installFssOverlay({ gameDir: game, bundleDir: bundle, download });

    expect(download).not.toHaveBeenCalled();
    expect(result.parked.toSorted()).toEqual(['FSS-Overlay', 'MyFss']);
    expect(readdirSync(mods()).toSorted()).toEqual([MOD_NAME, 'Hyperspace']);
    expect(readdirSync(parked()).toSorted()).toEqual(['FSS-Overlay', 'FSS-Overlay (2)', 'MyFss']);
    expect(readdirSync(join(parked(), 'MyFss')).toSorted()).toEqual(['MyFss.ini', 'MyFss.png']);
  });

  it('reinstalls over itself without parking it', async () => {
    for (const hash of FSS_SHADERS) write(join(game, 'ShaderFixes', `${hash}-ps.txt`), SHADER);
    const options = { gameDir: game, bundleDir: bundle, download: async () => originalZip() };
    await installFssOverlay(options);
    const again = await installFssOverlay(options);

    expect(again.parked).toEqual([]);
    expect(existsSync(parked())).toBe(false);
  });

  it('doesn’t take the game’s own shaders for FSS-Overlay’s', async () => {
    for (const hash of FSS_SHADERS) write(join(game, 'ShaderFixes', `${hash}-ps.txt`), 'ps_5_0\n');
    const download = vi.fn(async () => makeZip({ 'README.md': 'moved' }));

    await expect(installFssOverlay({ gameDir: game, bundleDir: bundle, download })).rejects.toThrow(
      'didn’t have the shaders',
    );
    expect(download).toHaveBeenCalledOnce();
    expect(existsSync(join(mods(), MOD_NAME))).toBe(false);
  });
});

const respond = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 404,
    json: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer,
  }) as Response;

describe('downloadOriginal', () => {
  it('follows EDHM’s mod list to the current release', async () => {
    const url =
      'https://github.com/psychicEgg/EDHM/raw/main/Odyssey/3rdPartyMods/FSS-Overlay/v2.zip';
    const fetchImpl = vi.fn(async (input: string) =>
      input.endsWith('mod_list.json')
        ? respond([{ mod_name: 'Hyperspace Mod' }, { mod_name: 'FSS-Overlay', download_url: url }])
        : respond('zip'),
    );

    const zip = await downloadOriginal(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenLastCalledWith(url);
    expect(zip.toString()).toBe('zip');
  });

  it('won’t download from anywhere but EDHM’s repository', async () => {
    const fetchImpl = vi.fn(async () =>
      respond([{ mod_name: 'FSS-Overlay', download_url: 'https://example.com/fss.zip' }]),
    );
    await expect(downloadOriginal(fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      'isn’t in',
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
