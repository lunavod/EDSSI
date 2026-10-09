import { describe, expect, it } from 'vitest';

import type { LoadoutEvent } from '../../shared/journal';
import { loadoutUrl } from '../ships/export';
import { buildJson } from './build-text';

const LOADOUT = {
  timestamp: '2026-09-10T10:00:00Z',
  event: 'Loadout',
  Ship: 'krait_mkii',
  ShipID: 3,
  Modules: [
    {
      Slot: 'FrameShiftDrive',
      Item: 'int_hyperdrive_size5_class5',
      Engineering: { BlueprintName: 'FSD_LongRange', Level: 5 },
    },
  ],
} as unknown as LoadoutEvent;

describe('buildJson', () => {
  it('reads pasted JSON', () => {
    expect(buildJson(`  ${JSON.stringify([{ header: {}, data: LOADOUT }])}\n`)).toEqual([
      { header: {}, data: LOADOUT },
    ]);
  });

  it('reads the import links EDSSI and EDMC make, for both sites', () => {
    expect(buildJson(loadoutUrl('edsy', LOADOUT))).toEqual(LOADOUT);
    expect(buildJson(loadoutUrl('coriolis', LOADOUT))).toEqual(LOADOUT);
  });

  it("says so for the sites' own build codes and for anything else", () => {
    expect(() => buildJson('https://edsy.org/#/L=H4sIAAAA')).toThrow(/Export/);
    expect(() => buildJson('https://coriolis.io/outfit/anaconda?code=abc')).toThrow(/Export/);
    expect(() => buildJson('not a build')).toThrow(/SLEF/);
    expect(() => buildJson('   ')).toThrow(/Paste/);
  });
});
