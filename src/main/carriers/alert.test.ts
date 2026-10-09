import { describe, expect, it } from 'vitest';

import {
  ago,
  alertLine,
  CarrierAlerts,
  carrierSearch,
  jumpsFor,
  type NearbyCarrier,
  readCarriers,
  repairStationSearch,
} from './alert';

const NOW = Date.parse('2026-09-17T16:00:00Z');
const PRU = { x: 6706.21875, y: 164.125, z: 10672.15625 };

/** Rows as Spansh's station search returns them, cut down. */
const result = {
  count: 3,
  results: [
    {
      type: 'Drake-Class Carrier',
      name: 'T4B-BHB',
      market_id: 3710010368,
      system_name: 'Pru Aihm VY-R c4-35',
      distance: 0,
      updated_at: '2026-07-28T10:29:47Z',
      services: [{ name: 'Dock' }, { name: 'Repair' }, { name: 'Restock' }, { name: 'Refuel' }],
    },
    {
      type: 'Drake-Class Carrier',
      name: 'X2J-19Z',
      carrier_name: 'DSSA DISTANT WORLDS',
      carrier_docking_access: 'All',
      market_id: 3709000000,
      system_name: 'Pru Aihm AE-R c5-6',
      distance: 489.2,
      updated_at: '2026-09-16T18:11:21Z',
      services: [{ name: 'Repair' }, { name: 'Vista Genomics' }],
    },
    { type: 'Drake-Class Carrier', name: 'BROKEN' },
  ],
};

describe('carrier searches', () => {
  it('asks for fresh carriers around the commander, nearest first', () => {
    expect(carrierSearch(PRU, 1500, 60, NOW)).toEqual({
      filters: {
        type: { value: ['Drake-Class Carrier'] },
        distance: { min: '0', max: '1500' },
        updated_at: {
          value: ['2026-07-19T16:00:00.000Z', '2026-09-17T16:00:00.000Z'],
          comparison: '<=>',
        },
      },
      sort: [{ distance: { direction: 'asc' } }],
      size: 50,
      page: 0,
      reference_coords: PRU,
    });
  });

  it('looks for repairs at any station type but a carrier', () => {
    const body = repairStationSearch(PRU, 1500, [
      'Coriolis Starport',
      'Drake-Class Carrier',
      'Outpost',
    ]);
    expect(body['filters']).toMatchObject({
      type: { value: ['Coriolis Starport', 'Outpost'] },
      services: [{ name: 'Repair' }],
    });
    expect(body['size']).toBe(1);
  });

  it('reads carriers from the result, skipping rows it cannot use', () => {
    expect(readCarriers(result)).toEqual([
      {
        marketId: '3710010368',
        callsign: 'T4B-BHB',
        name: undefined,
        system: 'Pru Aihm VY-R c4-35',
        distanceLy: 0,
        updatedAt: '2026-07-28T10:29:47Z',
        dockingAccess: undefined,
        services: ['Dock', 'Repair', 'Restock', 'Refuel'],
      },
      expect.objectContaining({ callsign: 'X2J-19Z', name: 'DSSA DISTANT WORLDS' }),
    ]);
    expect(readCarriers({ error: 'x' })).toEqual([]);
  });
});

describe('CarrierAlerts', () => {
  const carriers = readCarriers(result);

  it('names each carrier once, and again once it has moved', () => {
    const alerts = new CarrierAlerts();
    expect(alerts.select(carriers).map((carrier) => carrier.callsign)).toEqual([
      'T4B-BHB',
      'X2J-19Z',
    ]);
    expect(alerts.select(carriers)).toEqual([]);
    const moved: NearbyCarrier = { ...carriers[1]!, system: 'Beagle Point', distanceLy: 900 };
    expect(alerts.select([carriers[0]!, moved])).toEqual([moved]);
  });

  it('leaves out carriers not open to everyone', () => {
    const access = (dockingAccess: string): NearbyCarrier => ({ ...carriers[0]!, dockingAccess });
    const closed = ['None', 'Friends', 'Squadron', 'Squadron Friends'].map(access);
    expect(new CarrierAlerts().select(closed)).toEqual([]);
    expect(new CarrierAlerts().select([access('all')])).toHaveLength(1);
  });
});

describe('alertLine', () => {
  const carriers = readCarriers(result);

  it('says where the nearest is, what it offers and when it was seen', () => {
    expect(alertLine([carriers[1]!], 75, 'Pru Aihm CL-O c6-30', { now: NOW })).toBe(
      'Carrier DSSA DISTANT WORLDS in Pru Aihm AE-R c5-6, 489 light years, 7 jumps: ' +
        'repair, Vista Genomics. Last reported 21 hours ago.',
    );
  });

  it('counts the rest, and says "this system" when it is here', () => {
    const [here, further] = carriers;
    expect(alertLine([here!, further!], 75, 'pru aihm vy-r c4-35', { now: NOW })).toBe(
      'A carrier in this system: repair, refuel, rearm. ' +
        'Last reported 51 days ago. 1 more carrier in range.',
    );
    expect(alertLine([], 75, undefined, { now: NOW })).toBeUndefined();
  });

  it('reads out the callsign only when asked to', () => {
    const [unnamed, named] = carriers;
    const options = { now: NOW, sayCallsign: true };
    expect(alertLine([unnamed!], 75, 'Pru Aihm VY-R c4-35', options)).toMatch(
      /^Carrier T4B-BHB in this system:/,
    );
    expect(alertLine([named!], 75, undefined, options)).toMatch(
      /^Carrier DSSA DISTANT WORLDS, X2J-19Z in Pru Aihm AE-R c5-6,/,
    );
  });

  it('counts jumps and days plainly', () => {
    expect(jumpsFor(0, 70)).toBe(1);
    expect(jumpsFor(141, 70)).toBe(3);
    expect(ago('2026-09-17T15:30:00Z', NOW)).toBe('within the hour');
    expect(ago('2026-09-16T10:00:00Z', NOW)).toBe('yesterday');
  });
});
