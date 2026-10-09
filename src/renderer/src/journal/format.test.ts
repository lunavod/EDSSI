import { describe, expect, it } from 'vitest';

import {
  displayFields,
  formatList,
  formatNumber,
  formatValue,
  humanizeEvent,
  humanizeField,
  isGameSymbol,
} from './format';

describe('humanizeEvent', () => {
  it.each([
    ['FSDJump', 'FSD Jump'],
    ['SAAScanComplete', 'SAA Scan Complete'],
    ['NpcCrewPaidWage', 'NPC Crew Paid Wage'],
    ['DockingGranted', 'Docking Granted'],
    ['USSDrop', 'USS Drop'],
  ])('%s → %s', (name, expected) => {
    expect(humanizeEvent(name)).toBe(expected);
  });
});

describe('humanizeField', () => {
  it.each([
    ['StarSystem', 'Star system'],
    ['MarketID', 'Market ID'],
    ['DistFromStarLS', 'Distance from star'],
    ['Age_MY', 'Age my'],
    ['FLEETCARRIER_TOTAL_JUMPS', 'Fleetcarrier total jumps'],
  ])('%s → %s', (key, expected) => {
    expect(humanizeField(key)).toBe(expected);
  });
});

describe('formatValue', () => {
  it('adds units and currency', () => {
    expect(formatValue('FSDJump', 'JumpDist', 23.456)).toBe(`${formatNumber(23.46)} ly`);
    expect(formatValue('MarketBuy', 'TotalCost', 125000)).toBe(`${formatNumber(125000, 0)} CR`);
    expect(formatValue('RefuelAll', 'Amount', 12.5)).toBe(`${formatNumber(12.5)} t`);
    expect(formatValue('HullDamage', 'Health', 0.8)).toBe(`${formatNumber(80, 1)} %`);
  });

  it('leaves IDs alone and spells out booleans', () => {
    expect(formatValue('Docked', 'MarketID', 3228049920)).toBe('3228049920');
    expect(formatValue('Scan', 'SystemAddress', 18446744073709551615n)).toBe(
      '18446744073709551615',
    );
    expect(formatValue('Scan', 'Landable', true)).toBe('Yes');
  });

  it('formats coordinates as one value', () => {
    expect(formatList('FSDJump', 'StarPos', [1, -2.5, 3])).toBe(
      `${formatNumber(1)}, ${formatNumber(-2.5)}, ${formatNumber(3)} ly`,
    );
  });
});

describe('displayFields', () => {
  it('prefers localised text, hides the envelope and empty values', () => {
    const fields = displayFields(
      {
        timestamp: '2026-09-10T10:00:00Z',
        event: 'FSSSignalDiscovered',
        SignalName: '$MULTIPLAYER_SCENARIO14_TITLE;',
        SignalName_Localised: 'Resource Extraction Site',
        Volcanism: '',
        IsStation: false,
      },
      true,
    );
    expect(fields).toEqual([
      {
        key: 'SignalName',
        label: 'Signal name',
        value: 'Resource Extraction Site',
        raw: '$MULTIPLAYER_SCENARIO14_TITLE;',
      },
      { key: 'IsStation', label: 'Is station', value: false },
    ]);
  });
});

describe('isGameSymbol', () => {
  it('recognises internal identifiers', () => {
    expect(isGameSymbol('$int_cargorack_size7_class1_name;')).toBe(true);
    expect(isGameSymbol('Cargo Rack')).toBe(false);
  });
});
