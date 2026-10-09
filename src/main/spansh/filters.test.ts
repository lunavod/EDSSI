import { describe, expect, it } from 'vitest';

import type { SearchableField } from './client';
import { buildFilters, buildSort, FilterError } from './filters';

/** A cut of Spansh's real field lists, one of each type. */
const FIELDS: SearchableField[] = [
  { field: 'type', type: 'group' },
  { field: 'name', type: 'string' },
  { field: 'system_id64', type: 'keyword' },
  { field: 'distance', type: 'numeric', subtype: 'real' },
  { field: 'population', type: 'numeric', subtype: 'integer' },
  { field: 'market_updated_at', type: 'timestamp' },
  { field: 'has_large_pad', type: 'boolean' },
  { field: 'market', type: 'special' },
  {
    field: 'signals',
    type: 'value_struct',
    subfield: { name: 'name', type: 'group' },
    valuefield: { name: 'count', type: 'numeric', subtype: 'integer' },
  },
  {
    field: 'marketplace',
    type: 'combined',
    subfields: {
      commodity: { type: 'group' },
      supply: { type: 'numeric', subtype: 'integer' },
      is_rare: { type: 'boolean' },
    },
  },
  { field: 'rings', type: 'special', subtype: 'ring' },
];

describe('buildFilters', () => {
  it('writes each plain type the way the site sends it', () => {
    expect(
      buildFilters(
        [
          { field: 'type', values: ['Drake-Class Carrier'] },
          { field: 'name', text: 'Jameson Memorial' },
          { field: 'system_id64', values: ['10477373803'] },
          { field: 'population', min: 1, max: 1000 },
          { field: 'market_updated_at', min: '2026-09-01' },
          { field: 'has_large_pad', is: true },
        ],
        FIELDS,
      ),
    ).toEqual({
      type: { value: ['Drake-Class Carrier'] },
      name: { value: 'Jameson Memorial' },
      system_id64: { value: '10477373803' },
      population: { comparison: '<=>', value: [1, 1000] },
      market_updated_at: { comparison: '>=', value: '2026-09-01' },
      has_large_pad: { value: true },
    });
  });

  it('bounds distance with min and max of its own', () => {
    expect(buildFilters([{ field: 'distance', max: 50 }], FIELDS)).toEqual({
      distance: { max: 50 },
    });
  });

  it('keeps an open bound one-sided, which is all Spansh accepts for named amounts', () => {
    expect(
      buildFilters(
        [
          { field: 'signals', name: 'Biological', min: 3 },
          { field: 'signals', name: 'Geological', max: 2 },
        ],
        FIELDS,
      ),
    ).toEqual({
      signals: [
        { name: 'Biological', comparison: '>=', count: 3 },
        { name: 'Geological', comparison: '<=>', count: [1, 2] },
      ],
    });
  });

  it('gathers repeated item filters, each item with its own parts', () => {
    expect(
      buildFilters(
        [
          {
            field: 'marketplace',
            parts: [
              { field: 'commodity', values: ['Tritium'] },
              { field: 'supply', min: 1000 },
            ],
          },
          { field: 'marketplace', parts: [{ field: 'is_rare', is: true }] },
        ],
        FIELDS,
      ),
    ).toEqual({
      marketplace: [
        { commodity: { value: ['Tritium'] }, supply: { comparison: '>=', value: 1000 } },
        { is_rare: { value: true } },
      ],
    });
  });

  it("writes a ring's type as a bare list", () => {
    expect(
      buildFilters(
        [
          {
            field: 'rings',
            parts: [
              { field: 'type', values: ['Icy'] },
              { field: 'outer_radius', min: 1e6 },
            ],
          },
        ],
        FIELDS,
      ),
    ).toEqual({ rings: [{ type: ['Icy'], outer_radius: { comparison: '>=', value: 1e6 } }] });
  });

  it("refuses names Spansh would silently ignore, suggesting what's close", () => {
    expect(() => buildFilters([{ field: 'large_pad', is: true }], FIELDS)).toThrow(
      /no field called large_pad\. Close: has_large_pad/,
    );
    expect(() =>
      buildFilters([{ field: 'marketplace', parts: [{ field: 'price', min: 1 }] }], FIELDS),
    ).toThrow(/no part called price/);
  });

  it('says what a filter is missing', () => {
    expect(() => buildFilters([{ field: 'type' }], FIELDS)).toThrow(FilterError);
    expect(() => buildFilters([{ field: 'population' }], FIELDS)).toThrow(/min, max/);
    expect(() => buildFilters([{ field: 'signals', min: 1 }], FIELDS)).toThrow(/needs a name/);
    expect(() => buildFilters([{ field: 'marketplace' }], FIELDS)).toThrow(/needs parts/);
    expect(() => buildFilters([{ field: 'market' }], FIELDS)).toThrow(/marketplace/);
  });
});

describe('buildSort', () => {
  it('names the item for sorts that need one', () => {
    expect(
      buildSort([
        { field: 'distance', direction: 'asc' },
        { field: 'market_sell_price', direction: 'desc', name: 'Gold' },
      ]),
    ).toEqual([
      { distance: { direction: 'asc' } },
      { market_sell_price: [{ name: 'Gold', direction: 'desc' }] },
    ]);
  });
});
