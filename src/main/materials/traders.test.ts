import { describe, expect, it } from 'vitest';

import { DEFAULT_TRADER_FILTERS } from '../../shared/crafting';
import { readTraders, traderSearchBody } from './traders';

describe('traderSearchBody', () => {
  it('asks for every trader when none is picked', () => {
    const body = traderSearchBody(
      { ...DEFAULT_TRADER_FILTERS, page: 0 },
      { reference_system: 'Sol' },
    );
    expect(body).toMatchObject({
      filters: {
        material_trader: { value: ['Raw', 'Manufactured', 'Encoded'] },
        distance: { min: 0, max: 200 },
      },
      reference_system: 'Sol',
      page: 0,
    });
  });

  it('narrows by pad, arrival and planets', () => {
    const body = traderSearchBody(
      {
        ...DEFAULT_TRADER_FILTERS,
        types: ['Encoded'],
        pad: 'large',
        maxArrivalLs: 5000,
        planetary: false,
        page: 2,
      },
      { reference_coords: { x: 1, y: 2, z: 3 } },
    );
    expect(body['filters']).toEqual({
      material_trader: { value: ['Encoded'] },
      distance: { min: 0, max: 200 },
      has_large_pad: { value: true },
      distance_to_arrival: { comparison: '<=', value: 5000 },
      is_planetary: { value: false },
    });
  });
});

describe('readTraders', () => {
  const row = {
    name: 'Magnus Gateway',
    system_name: 'EZ Aquarii',
    distance: 11.1,
    distance_to_arrival: 453.7,
    material_trader: 'Encoded',
    type: 'Coriolis Starport',
    market_id: 3228841728,
    has_large_pad: true,
    is_planetary: false,
    updated_at: '2026-09-28T21:59:11Z',
  };

  it('reads a station', () => {
    expect(readTraders({ count: 1, results: [row] }, 'any')).toEqual({
      total: 1,
      stations: [
        {
          marketId: '3228841728',
          name: 'Magnus Gateway',
          type: 'Coriolis Starport',
          system: 'EZ Aquarii',
          distanceLy: 11.1,
          arrivalLs: 453.7,
          pad: 'L',
          planetary: false,
          trader: 'Encoded',
          updatedAt: '2026-09-28T21:59:11Z',
        },
      ],
    });
  });

  it('leaves out small-pad stations when a medium pad is needed, and rows it cannot read', () => {
    const outpost = { ...row, has_large_pad: false, small_pads: 2, name: 'Tiny' };
    const odd = { ...row, material_trader: 'Guardian' };
    expect(readTraders({ count: 3, results: [outpost, odd, row] }, 'medium').stations).toHaveLength(
      1,
    );
  });
});
