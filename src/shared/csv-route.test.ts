import { describe, expect, it } from 'vitest';

import {
  columnValue,
  nextSystem,
  parseCsv,
  parseCsvRoute,
  positionAfterArriving,
  scoopableAt,
  starClassAt,
} from './csv-route';

// The head of a Spansh exact plotter export.
const EXACT = [
  '"System Name","Distance","Distance Remaining","Fuel Left","Fuel Used","Refuel","Neutron Star","Inject"',
  '"Sagittarius A*","0","25899.9894653959","128","0","No","No","No"',
  '"Juenae XV-C d2406","75.4844131469727","25893.1309897084","128","6.77007627487183","Yes","No","No"',
  '"Juenae AR-C d905","75.393669128418","25889.0190130489","128","6.74972772598267","Yes","No","No"',
  '',
].join('\r\n');

const at = '2026-09-23T20:00:00.000Z';

describe('parseCsv', () => {
  it('reads quoted cells, doubled quotes and bare ones', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\n1,,3')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '', '3'],
    ]);
  });

  it('skips blank lines and a byte order mark', () => {
    expect(parseCsv(`${String.fromCharCode(0xfeff)}a\n\n b \n`)).toEqual([['a'], [' b ']]);
  });
});

describe('parseCsvRoute', () => {
  it('reads a Spansh export', () => {
    const route = parseCsvRoute(EXACT, 'exact.csv', at);
    expect(route.columns).toEqual([
      'Distance',
      'Distance Remaining',
      'Fuel Left',
      'Fuel Used',
      'Refuel',
      'Neutron Star',
      'Inject',
    ]);
    expect(route.systems.map((system) => system.name)).toEqual([
      'Sagittarius A*',
      'Juenae XV-C d2406',
      'Juenae AR-C d905',
    ]);
    expect(columnValue(route, 1, /distance.*remain/i)).toBe('25893.1309897084');
  });

  it('finds the system column wherever it is, and folds a system listed once per body', () => {
    const route = parseCsvRoute(
      'Body Name;System Name;Jumps\nA 1;A;1\nA 2;A;1\nB 1;B;2\n',
      'r2r.csv',
      at,
    );
    expect(route.systems).toEqual([
      { name: 'A', values: ['A 1', '1'] },
      { name: 'B', values: ['B 1', '2'] },
    ]);
  });

  it('takes the first column without a heading it knows', () => {
    expect(parseCsvRoute('Where\nSol\n', 'x.csv', at).systems[0]?.name).toBe('Sol');
  });

  it('reads coordinates from X, Y and Z columns', () => {
    const route = parseCsvRoute('System Name,X,Y,Z\nSol,0,0,0\nWhere,1.5,,3\n', 'x.csv', at);
    expect(route.systems.map((system) => system.coords)).toEqual([[0, 0, 0], undefined]);
  });

  it('refuses a file with no systems', () => {
    expect(() => parseCsvRoute('System Name\n', 'x.csv', at)).toThrow(/no rows/);
  });
});

describe('positionAfterArriving', () => {
  const systems = ['A', 'B', 'C', 'B', 'D'].map((name) => ({ name, values: [] }));

  it('finds the system, whatever its case', () => {
    expect(positionAfterArriving(systems, undefined, 'c')).toBe(2);
    expect(positionAfterArriving(systems, undefined, 'E')).toBeUndefined();
  });

  it('takes a repeated system at its next appearance', () => {
    expect(positionAfterArriving(systems, undefined, 'B')).toBe(1);
    expect(positionAfterArriving(systems, 2, 'B')).toBe(3);
    expect(positionAfterArriving(systems, 4, 'B')).toBe(3);
  });

  it('says where to go next', () => {
    expect(nextSystem(systems, undefined)?.name).toBe('A');
    expect(nextSystem(systems, 2)?.name).toBe('B');
    expect(nextSystem(systems, 4)).toBeUndefined();
  });
});

describe('scoopableAt', () => {
  it("reads Spansh's Refuel column: yes is scoopable, no says nothing", () => {
    // A G star Spansh didn't refuel at, as in a real export.
    const passedBy = '"Juenae WC-W c4-8557","74","25800","121","6.5","No","No","No"\n';
    const route = parseCsvRoute(EXACT + passedBy, 'exact.csv', at);
    expect([0, 1, 2, 3].map((index) => scoopableAt(route, index))).toEqual([
      undefined,
      true,
      true,
      undefined,
    ]);
  });

  it('says nothing without the column', () => {
    expect(scoopableAt(parseCsvRoute('System Name\nA\nB\n', 'x.csv', at), 1)).toBeUndefined();
  });
});

describe('starClassAt', () => {
  it('reads a Star column', () => {
    const route = parseCsvRoute('System Name,Star\nA,K\nB,\n', 'x.csv', at);
    expect([starClassAt(route, 0), starClassAt(route, 1)]).toEqual(['K', undefined]);
  });
});
