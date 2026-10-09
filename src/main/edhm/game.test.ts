import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findEdhmGame, gameDirsFromEdhmUi } from './game';

const settings = (active: string, games: { instance: string; path: unknown }[]) => ({
  ActiveInstance: active,
  GameInstances: [
    { instance: 'Steam', games: games.slice(0, 2) },
    { instance: 'Epic Games', games: games.slice(2) },
  ],
});

describe('gameDirsFromEdhmUi', () => {
  it('lists the active instance first and skips games with no folder', () => {
    const dirs = gameDirsFromEdhmUi(
      settings('Epic Games (Odyssey (Live))', [
        { instance: 'Steam (Odyssey (Live))', path: 'D:\\Steam\\odyssey' },
        { instance: 'Steam (Horizons (Live))', path: '' },
        { instance: 'Epic Games (Odyssey (Live))', path: 'C:\\Epic\\odyssey' },
        { instance: 'Epic Games (ALT Account)', path: 'D:\\Steam\\odyssey' },
      ]),
    );
    expect(dirs).toEqual(['C:\\Epic\\odyssey', 'D:\\Steam\\odyssey']);
  });

  it('takes the first of a list of paths, as older versions kept', () => {
    const dirs = gameDirsFromEdhmUi(
      settings('Steam (Odyssey (Live))', [
        { instance: 'Steam (Odyssey (Live))', path: ['D:\\Steam\\odyssey'] },
      ]),
    );
    expect(dirs).toEqual(['D:\\Steam\\odyssey']);
  });

  it('shrugs off a file of the wrong shape', () => {
    expect(gameDirsFromEdhmUi(null)).toEqual([]);
    expect(gameDirsFromEdhmUi({ GameInstances: 'nope' })).toEqual([]);
    expect(gameDirsFromEdhmUi({ GameInstances: [null, { games: [null] }] })).toEqual([]);
  });
});

const root = () => mkdtempSync(join(tmpdir(), 'edssi-edhm-'));

describe('findEdhmGame', () => {
  it('says when EDHM-UI isn’t installed', () => {
    const result = findEdhmGame(join(root(), 'Settings.json'));
    expect(result).toEqual({ problem: expect.stringContaining('EDHM-UI isn') });
  });

  it('picks the first game folder with EDHM in it', () => {
    const dir = root();
    const bare = join(dir, 'bare');
    const modded = join(dir, 'modded');
    mkdirSync(bare);
    mkdirSync(join(modded, 'EDHM-ini', '3rdPartyMods'), { recursive: true });
    writeFileSync(join(modded, 'd3dx.ini'), '');
    const path = join(dir, 'Settings.json');
    writeFileSync(
      path,
      JSON.stringify(
        settings('a', [
          { instance: 'a', path: bare },
          { instance: 'b', path: modded },
        ]),
      ),
    );

    expect(findEdhmGame(path)).toEqual({ gameDir: modded });
  });

  it('says when no game folder has EDHM', () => {
    const dir = root();
    const path = join(dir, 'Settings.json');
    writeFileSync(path, JSON.stringify(settings('a', [{ instance: 'a', path: dir }])));
    expect(findEdhmGame(path)).toEqual({ problem: expect.stringContaining('EDHM isn') });
  });
});
