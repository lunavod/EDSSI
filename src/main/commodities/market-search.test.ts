import { describe, expect, it } from 'vitest';

import { DEFAULT_MARKET_FILTERS } from '../../shared/commodities';
import {
  localMarket,
  readSellStations,
  readStations,
  searchBody,
  sellBody,
  systemMarketsBody,
  withLocalMarket,
} from './market-search';

const TYPES = [
  'Coriolis Starport',
  'Drake-Class Carrier',
  'Outpost',
  'Planetary Port',
  'Settlement',
  'Space Construction Depot',
];
const NOW = Date.parse('2026-09-27T12:00:00Z');

describe('searchBody', () => {
  it('asks for every commodity in stock, within range, at markets that sell', () => {
    expect(
      searchBody({
        commodities: ['Steel', 'Water'],
        filters: { ...DEFAULT_MARKET_FILTERS, maxAgeDays: 0 },
        types: TYPES,
        reference: { reference_system: 'Sol' },
        minSupply: 100,
        sortBy: 'distance',
        size: 25,
        page: 2,
        now: NOW,
      }),
    ).toEqual({
      filters: {
        marketplace: [
          { commodity: { value: ['Steel'] }, supply: { comparison: '>=', value: 100 } },
          { commodity: { value: ['Water'] }, supply: { comparison: '>=', value: 100 } },
        ],
        distance: { min: 0, max: 1000 },
        type: { value: ['Coriolis Starport', 'Outpost', 'Planetary Port', 'Settlement'] },
      },
      sort: [{ distance: { direction: 'asc' } }],
      size: 25,
      page: 2,
      reference_system: 'Sol',
    });
  });

  it('sorts by price, and narrows by pad, age, carriers and planetary', () => {
    const body = searchBody({
      commodities: ['Steel'],
      filters: {
        ...DEFAULT_MARKET_FILTERS,
        pad: 'large',
        carriers: true,
        planetary: 'no',
        maxArrivalLs: 5000,
        maxAgeDays: 2,
      },
      types: TYPES,
      reference: { reference_coords: { x: 1, y: 2, z: 3 } },
      minSupply: 0,
      sortBy: 'price',
      size: 25,
      page: 0,
      now: NOW,
    });
    expect(body).toMatchObject({
      filters: {
        type: { value: ['Coriolis Starport', 'Drake-Class Carrier', 'Outpost'] },
        has_large_pad: { value: true },
        distance_to_arrival: { comparison: '<=', value: 5000 },
        market_updated_at: {
          comparison: '<=>',
          value: ['2026-09-25T12:00:00.000Z', '2026-09-27T12:00:00.000Z'],
        },
        marketplace: [{ supply: { comparison: '>=', value: 1 } }],
      },
      sort: [
        { market_buy_price: [{ name: 'Steel', direction: 'asc' }] },
        { distance: { direction: 'asc' } },
      ],
      reference_coords: { x: 1, y: 2, z: 3 },
    });
  });
});

describe('readStations', () => {
  const row = (name: string, extra: Record<string, unknown>) => ({
    name,
    system_name: 'Sol',
    distance: 4.5,
    market_id: 128_000_000 + name.length,
    type: 'Coriolis Starport',
    distance_to_arrival: 500.2,
    has_large_pad: true,
    system_x: 0,
    system_y: 0,
    system_z: 0,
    market_updated_at: '2026-09-26T10:00:00Z',
    market: [
      { commodity: 'Steel', buy_price: 5000, supply: 900, sell_price: 4800, demand: 0 },
      { commodity: 'Gold', buy_price: 45000, supply: 10, sell_price: 44000, demand: 0 },
      { commodity: 'Water', buy_price: 0, supply: 0, sell_price: 300, demand: 1000 },
    ],
    ...extra,
  });

  it('keeps the offers asked about that have stock, and drops what the filters rule out', () => {
    const { stations, total } = readStations(
      {
        count: 3,
        results: [
          row('Galileo', {}),
          row('Tiny', { has_large_pad: false, medium_pads: 0, small_pads: 2 }),
          row('Private', { type: 'Drake-Class Carrier', carrier_docking_access: 'Friends' }),
        ],
      },
      ['steel', 'Water'],
      { pad: 'medium' },
    );
    expect(total).toBe(3);
    expect(stations).toEqual([
      {
        marketId: '128000007',
        name: 'Galileo',
        type: 'Coriolis Starport',
        system: 'Sol',
        distanceLy: 4.5,
        arrivalLs: 500.2,
        pad: 'L',
        planetary: false,
        carrier: false,
        coords: [0, 0, 0],
        marketUpdatedAt: '2026-09-26T10:00:00Z',
        offers: [{ commodity: 'Steel', buyPrice: 5000, supply: 900 }],
      },
    ]);
  });
});

describe('selling', () => {
  it('asks for demand of every commodity, best price first', () => {
    expect(
      sellBody({
        commodities: ['Gold', 'Silver'],
        filters: { ...DEFAULT_MARKET_FILTERS, maxAgeDays: 0 },
        types: TYPES,
        reference: { reference_system: 'Sol' },
        minDemand: [500, 0],
        sortBy: 'price',
        size: 25,
        page: 0,
        now: NOW,
      }),
    ).toEqual({
      filters: {
        marketplace: [
          { commodity: { value: ['Gold'] }, demand: { comparison: '>=', value: 500 } },
          { commodity: { value: ['Silver'] }, demand: { comparison: '>=', value: 1 } },
        ],
        distance: { min: 0, max: 1000 },
        type: { value: ['Coriolis Starport', 'Outpost', 'Planetary Port', 'Settlement'] },
      },
      sort: [
        { market_sell_price: [{ name: 'Gold', direction: 'desc' }] },
        { distance: { direction: 'asc' } },
      ],
      size: 25,
      page: 0,
      reference_system: 'Sol',
    });
  });

  it('keeps what each station pays for the commodities it wants', () => {
    const { stations } = readSellStations(
      {
        count: 1,
        results: [
          {
            name: 'Galileo',
            system_name: 'Sol',
            distance: 4.5,
            market_id: 1,
            type: 'Coriolis Starport',
            has_large_pad: true,
            market: [
              { commodity: 'Gold', buy_price: 0, supply: 0, sell_price: 52000, demand: 3000 },
              { commodity: 'Silver', buy_price: 4000, supply: 90, sell_price: 3900, demand: 0 },
              { commodity: 'Water', buy_price: 0, supply: 0, sell_price: 300, demand: 1000 },
            ],
          },
        ],
      },
      ['gold', 'Silver'],
      { pad: 'large' },
    );
    expect(stations).toEqual([
      {
        marketId: '1',
        name: 'Galileo',
        type: 'Coriolis Starport',
        system: 'Sol',
        distanceLy: 4.5,
        pad: 'L',
        planetary: false,
        carrier: false,
        bids: [{ commodity: 'Gold', sellPrice: 52000, demand: 3000 }],
      },
    ]);
  });
});

describe('the markets in this system', () => {
  it('asks for any commodity on the list, within the system', () => {
    expect(
      systemMarketsBody({
        commodities: ['Steel', 'Water'],
        types: TYPES,
        reference: { reference_coords: { x: 1, y: 2, z: 3 } },
      }),
    ).toMatchObject({
      filters: {
        marketplace: [
          { commodity: { value: ['Steel', 'Water'] }, supply: { comparison: '>=', value: 1 } },
        ],
        distance: { min: 0, max: 0.01 },
        type: { value: TYPES.filter((type) => type !== 'Space Construction Depot') },
      },
      reference_coords: { x: 1, y: 2, z: 3 },
    });
  });

  const market = {
    timestamp: '2026-09-27T11:00:00Z',
    MarketID: 3_228_000_000,
    StationName: 'Galileo',
    StationType: 'Ocellus',
    StarSystem: 'Sol',
    Items: [
      { Name: '$steel_name;', Name_Localised: 'Stahl', BuyPrice: 340, Stock: 5000 },
      { Name: '$liquidoxygen_name;', BuyPrice: 700, Stock: 0 },
      { Name: '$gold_name;', BuyPrice: 45000, Stock: 20 },
    ],
  };

  it("reads the last market's stock of the list from Market.json", () => {
    expect(localMarket(market, ['Steel', 'Liquid Oxygen'])).toEqual({
      marketId: '3228000000',
      name: 'Galileo',
      type: 'Ocellus',
      system: 'Sol',
      distanceLy: 0,
      planetary: false,
      carrier: false,
      marketUpdatedAt: '2026-09-27T11:00:00Z',
      offers: [{ commodity: 'Steel', buyPrice: 340, supply: 5000 }],
    });
  });

  it("puts the game's stock in place of Spansh's, keeping what Spansh knows", () => {
    const local = localMarket(market, ['Steel'])!;
    const spansh = {
      ...local,
      type: 'Ocellus Starport',
      pad: 'L' as const,
      marketUpdatedAt: '2026-09-01T00:00:00Z',
      offers: [{ commodity: 'Steel', buyPrice: 400, supply: 10 }],
    };
    const other = { ...spansh, marketId: '1', name: 'Burnell Station' };
    expect(withLocalMarket([other, spansh], local)).toEqual([
      { ...spansh, offers: local.offers, marketUpdatedAt: local.marketUpdatedAt },
      other,
    ]);
    // Sold out now, whatever Spansh last heard.
    expect(withLocalMarket([other, spansh], { ...local, offers: [] })).toEqual([other]);
  });
});
