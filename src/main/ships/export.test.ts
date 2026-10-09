import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import type { ShipView } from '../../shared/ships';
import { loadoutUrl, shipCsv, shipCsvName } from './export';
import { loadout } from './loadout-fixture';

describe('loadoutUrl', () => {
  it('gzips the loadout into the import link, as EDMC does', () => {
    const ship = loadout([{ Slot: 'FrameShiftDrive', Item: 'int_hyperdrive_size5_class5' }]);
    const url = loadoutUrl('edsy', ship);
    expect(url.startsWith('https://edsy.org/#/I=')).toBe(true);
    const data = decodeURIComponent(url.slice('https://edsy.org/#/I='.length));
    expect(JSON.parse(gunzipSync(Buffer.from(data, 'base64url')).toString('utf8'))).toEqual(ship);
    expect(loadoutUrl('coriolis', ship)).toMatch(
      /^https:\/\/coriolis\.io\/import\?data=[\w-]+(%3D)*$/,
    );
  });

  it('writes a bigint as a plain number', () => {
    const url = loadoutUrl('coriolis', loadout([], { Rebuy: (2n ** 60n) as unknown as number }));
    const data = decodeURIComponent(url.split('data=')[1] ?? '');
    expect(gunzipSync(Buffer.from(data, 'base64url')).toString('utf8')).toContain(
      '"Rebuy":1152921504606847000',
    );
  });
});

const ship: ShipView = {
  shipId: 7,
  ship: 'cobra',
  type: 'Cobra Mk III',
  name: 'Road, "Runner"',
  ident: 'RR-01',
  current: true,
  layout: 'edsy',
  slots: [
    {
      slot: 'FrameShiftDrive',
      group: 'core',
      size: 5,
      module: {
        item: 'int_hyperdrive_size5_class5',
        name: 'Frame Shift Drive',
        grade: '5A',
        on: true,
        priority: 0,
        health: 0.9876,
        value: 5000,
        engineering: {
          blueprint: 'Increased Range',
          level: 5,
          quality: 1,
          experimental: 'Mass Manager',
        },
      },
    },
    { slot: 'Slot01_Size4', group: 'internal', size: 4, only: 'Cargo racks' },
  ],
};

describe('shipCsv', () => {
  it('writes every slot, the empty ones too', () => {
    const lines = shipCsv(ship).trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'Group,Slot,Size,Module,Class,Mount,Blueprint,Grade,Quality,Experimental,Engineer,Powered,Priority,Health,Value,Item',
    );
    expect(lines[1]).toBe(
      'core,FrameShiftDrive,5,Frame Shift Drive,5A,,Increased Range,5,1,Mass Manager,,yes,1,0.988,5000,int_hyperdrive_size5_class5',
    );
    expect(lines[2]).toBe('internal,Slot01_Size4,4,,,,,,,,,,,,,');
  });

  it('names the file after the ship, safely', () => {
    expect(shipCsvName(ship)).toBe('Road, Runner RR-01.csv');
    expect(shipCsvName({ ...ship, name: '' })).toBe('Cobra Mk III RR-01.csv');
  });
});
