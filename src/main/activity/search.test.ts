import { describe, expect, it } from 'vitest';

import type { ActivityRecord } from '../../shared/activity';
import { describeRecord, matchRecords, searchActivity } from './search';

const ALL = { from: 0, to: Number.MAX_SAFE_INTEGER, label: 'all' };

let clock = Date.parse('2026-09-10T10:00:00Z');
function made(record: Record<string, unknown>): ActivityRecord {
  clock += 60_000;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test records, shaped by kind
  return { at: clock, ...record } as ActivityRecord;
}

const records: ActivityRecord[] = [
  made({ kind: 'jump', system: 'Sol', distanceLy: 5, fromSolLy: 0, firstVisit: false }),
  made({ kind: 'dock', system: 'Sol', station: 'Abraham Lincoln', stationType: 'Orbis' }),
  made({
    kind: 'earn',
    system: 'Sol',
    source: 'trade',
    amount: 500_000,
    profit: 100_000,
    detail: 'Tritium',
  }),
  made({ kind: 'jump', system: 'Colonia', distanceLy: 40, fromSolLy: 22_000, firstVisit: true }),
  made({
    kind: 'scan',
    system: 'Colonia',
    body: 'Colonia 3',
    bodyType: 'Earthlike body',
    star: false,
    value: 3_000_000,
    firstDiscovery: true,
    terraformable: false,
    landable: false,
  }),
  made({
    kind: 'organic',
    system: 'Colonia',
    body: 'Colonia 4',
    species: 'Stratum Tectonicas',
    genus: 'Stratum',
    value: 19_000_000,
    newSpecies: true,
  }),
  made({ kind: 'earn', system: 'Colonia', source: 'exobiology', amount: 19_000_000 }),
  made({ kind: 'death', system: 'Colonia', killer: 'Thargoid Interceptor' }),
  made({ kind: 'jump', system: 'Sol', distanceLy: 40, fromSolLy: 0, firstVisit: false }),
];

describe('matchRecords', () => {
  it('filters by kind, system, place, species, commodity and source', () => {
    expect(matchRecords(records, ALL, { kinds: ['jump'], system: 'col' })).toHaveLength(1);
    expect(matchRecords(records, ALL, { place: 'lincoln' })).toMatchObject([{ kind: 'dock' }]);
    expect(matchRecords(records, ALL, { species: 'stratum' })).toMatchObject([{ kind: 'organic' }]);
    expect(matchRecords(records, ALL, { commodity: 'trit' })).toMatchObject([{ kind: 'earn' }]);
    expect(matchRecords(records, ALL, { source: 'exobiology' })).toMatchObject([
      { amount: 19_000_000 },
    ]);
  });

  it('matches every word of the free text against the record’s line', () => {
    expect(matchRecords(records, ALL, { text: 'earthlike FIRST discovery' })).toHaveLength(1);
    expect(matchRecords(records, ALL, { text: 'thargoid' })).toMatchObject([{ kind: 'death' }]);
    expect(matchRecords(records, ALL, { text: 'earthlike water' })).toEqual([]);
  });

  it('keeps to the range', () => {
    const from = records[3]!.at;
    expect(matchRecords(records, { from, to: from + 1, label: '' }, {})).toHaveLength(1);
  });
});

describe('searchActivity', () => {
  it('counts, totals and lists the latest matches first', () => {
    const result = searchActivity(records, ALL, { kinds: ['jump'] }, 2);
    expect(result).toMatchObject({
      matches: 3,
      first: { what: 'Jumped to Sol (5.0 ly)', system: 'Sol' },
      last: { system: 'Sol' },
      by_kind: { jump: { count: 3, distance_ly: 85 } },
      systems: 2,
      top_systems: [
        { system: 'Sol', matches: 2 },
        { system: 'Colonia', matches: 1 },
      ],
      older_not_shown: 1,
    });
    expect(result['latest']).toMatchObject([{ system: 'Sol' }, { system: 'Colonia' }]);
  });

  it('adds up credits per kind', () => {
    const result = searchActivity(records, ALL, { system: 'colonia' });
    expect(result['by_kind']).toMatchObject({
      scan: { count: 1, credits_cr: 3_000_000 },
      organic: { count: 1, credits_cr: 19_000_000 },
      earn: { count: 1, credits_cr: 19_000_000 },
      death: { count: 1 },
    });
  });

  it('says so when nothing matches', () => {
    expect(searchActivity(records, ALL, { kinds: ['bounty'] })).toEqual({
      period: 'all',
      matches: 0,
    });
  });
});

describe('describeRecord', () => {
  it('writes one line per record', () => {
    expect(describeRecord(records[1]!)).toBe('Docked at Abraham Lincoln (Orbis)');
    expect(describeRecord(records[2]!)).toBe('Earned 500,000 cr from trade: Tritium');
    expect(describeRecord(records[7]!)).toBe('Died, killed by Thargoid Interceptor');
  });
});
