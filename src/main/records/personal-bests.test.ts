import { describe, expect, it } from 'vitest';

import type { JournalEvent } from '../../shared/journal';
import {
  bodyClassName,
  MIN_SCANS_BEFORE_ANNOUNCING,
  PersonalBests,
  personalBestCallout,
  recordLabel,
} from './personal-bests';

let clock = Date.parse('2026-09-10T10:00:00Z');

function logged(fields: Record<string, unknown>): JournalEvent {
  clock += 1000;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test payloads, like parsed JSON.
  return { timestamp: new Date(clock).toISOString(), ...fields } as JournalEvent;
}

const login = (fid: string) => logged({ event: 'Commander', FID: fid, Name: fid });

function waterWorld(bodyId: number, fields: Record<string, unknown> = {}, system = 'Sol') {
  return logged({
    event: 'Scan',
    ScanType: 'Detailed',
    BodyName: `${system} ${bodyId}`,
    BodyID: bodyId,
    StarSystem: system,
    SystemAddress: system.length,
    PlanetClass: 'Water world',
    Radius: 6_000_000,
    MassEM: 1,
    SurfaceTemperature: 300,
    ...fields,
  });
}

/** Scans enough ordinary water worlds that a best of the class is worth announcing. */
function seeded(): PersonalBests {
  const bests = new PersonalBests();
  bests.apply(login('F1'));
  for (let id = 1; id <= MIN_SCANS_BEFORE_ANNOUNCING; id++) bests.apply(waterWorld(id));
  return bests;
}

describe('PersonalBests', () => {
  it('announces a scan that beats an established best', () => {
    const bests = seeded();
    const broken = bests.apply(waterWorld(10, { Radius: 9_000_000, SurfaceTemperature: 400 }));
    expect(broken.map((record) => record.category)).toEqual(['largest', 'hottest']);
    expect(broken[0]).toMatchObject({ bodyClass: 'Water world', previous: 6_000_000 });
    expect(personalBestCallout(broken, 'Sol')).toBe(
      'Personal best. 10 is your largest and hottest water world yet.',
    );
  });

  it('keeps quiet about the first few scans of a class, and about ties', () => {
    const bests = new PersonalBests();
    bests.apply(login('F1'));
    expect(bests.apply(waterWorld(1))).toEqual([]);
    expect(bests.apply(waterWorld(2, { Radius: 9_000_000 }))).toEqual([]);

    const established = seeded();
    expect(established.apply(waterWorld(10))).toEqual([]);
  });

  it('keeps quiet when a body beats its own best', () => {
    const bests = seeded();
    bests.apply(waterWorld(10, { Radius: 9_000_000 }));
    expect(bests.apply(waterWorld(10, { Radius: 9_100_000 }))).toEqual([]);
  });

  it('keeps each commander’s bests apart', () => {
    const bests = seeded();
    bests.apply(login('F2'));
    expect(bests.apply(waterWorld(10, { Radius: 9_000_000 }))).toEqual([]);
  });

  it('starts from saved bests and reports what changed', () => {
    const bests = new PersonalBests([
      {
        commander: 'F1',
        category: 'largest',
        bodyClass: 'Water world',
        value: 10_000_000,
        bodyName: 'Old 1',
        systemName: 'Old',
        timestamp: '2020-01-01T00:00:00Z',
      },
    ]);
    bests.apply(login('F1'));
    for (let id = 1; id <= MIN_SCANS_BEFORE_ANNOUNCING; id++) bests.apply(waterWorld(id));
    expect(bests.apply(waterWorld(10, { Radius: 9_000_000 }))).toEqual([]);
    const changed = bests.takeChanged();
    expect(changed.find((record) => record.category === 'largest')).toBeUndefined();
    expect(changed.find((record) => record.category === 'smallest')?.value).toBe(6_000_000);
    expect(bests.takeChanged()).toEqual([]);
  });

  it('measures a binary pair once both planets are scanned', () => {
    const bests = seeded();
    const partner = (bodyId: number, axis: number) =>
      waterWorld(bodyId, { Parents: [{ Null: 9 }, { Star: 0 }], SemiMajorAxis: axis });
    bests.apply(partner(11, 1e8));
    bests.apply(partner(12, 2e8));
    bests.apply(partner(21, 1e7));
    // Only the pair around barycentre 9 is complete; 21 waits for its partner.
    expect(bests.held(new Set(['Sol 11', 'Sol 12']))).toEqual(
      new Map([['Sol 11', ['Closest binary water world']]]),
    );
  });

  it('lists the bests the bodies here hold', () => {
    const bests = seeded();
    expect(bests.held(new Set(['Sol 1']))).toEqual(
      new Map([
        [
          'Sol 1',
          [
            'Largest water world',
            'Smallest water world',
            'Most massive water world',
            'Least massive water world',
            'Hottest water world',
            'Coldest water world',
          ],
        ],
      ]),
    );
  });
});

describe('bodyClassName', () => {
  it('names classes the way they are said', () => {
    expect(bodyClassName('Sudarsky class II gas giant')).toBe('class II gas giant');
    expect(bodyClassName('Earthlike body')).toBe('Earth-like world');
    expect(bodyClassName('K')).toBe('class K star');
    expect(bodyClassName('DA')).toBe('class DA white dwarf');
    expect(bodyClassName('N')).toBe('neutron star');
    expect(bodyClassName('B_BlueWhiteSuperGiant')).toBe('class B supergiant');
    expect(recordLabel('highest_gravity', 'Icy body')).toBe('Highest gravity icy body');
  });
});
