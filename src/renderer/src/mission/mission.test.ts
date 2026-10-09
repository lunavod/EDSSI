import { describe, expect, it } from 'vitest';

import type { Tally } from '../../../shared/activity';
import type {
  ExobiologyEntry,
  PossibleGenus,
  PossibleSpecies,
  SurveyBody,
  SurveyGenus,
  SystemSurvey,
} from '../../../shared/history';
import { formatCompact } from '../journal/format';
import {
  type BioBody,
  bioBodies,
  exobiologyStops,
  formatBodyValue,
  formatCreditRange,
  formatMappingTag,
  formatPlayed,
  formatProbeEarnings,
  jumpsSinceLastStop,
  probeTargets,
  sortBioBodies,
  sourceShares,
} from './mission';

function entry(systemAddress: number, jump: number, species: string): ExobiologyEntry {
  return {
    timestamp: '2026-09-10T10:00:00Z',
    systemAddress,
    systemName: `System ${systemAddress}`,
    bodyName: `System ${systemAddress} 1`,
    species,
    name: species,
    genus: 'Bacterium',
    status: 'pending',
    newSpecies: false,
    jump,
    thisSession: true,
  };
}

function body(overrides: Partial<SurveyBody>): SurveyBody {
  return {
    bodyId: 1,
    name: 'Alpha 1',
    kind: 'planet',
    landable: true,
    terraformable: false,
    firstDiscovery: false,
    mapped: false,
    mappedEfficiently: false,
    value: 0,
    status: 'pending',
    bioSignals: 0,
    signals: [],
    genuses: [],
    organics: [],
    ...overrides,
  };
}

function genus(
  code: string,
  name: string,
  minValue: number,
  maxValue: number,
  newGenus: boolean,
): SurveyGenus {
  return { code, name, minValue, maxValue, newGenus, candidates: [] };
}

function species(name: string, value: number, colours: string[] = []): PossibleSpecies {
  return { species: name, name, value, colours, newSpecies: true };
}

function possibleGenus(code: string, name: string, min: number, max: number): PossibleGenus {
  return {
    code,
    name,
    colonyDistance: 500,
    minValue: min,
    maxValue: max,
    newGenus: false,
    species: [species(`${name} a`, min), species(`${name} b`, max)],
  };
}

function survey(bodies: SurveyBody[]): SystemSurvey {
  return { systemAddress: 1, systemName: 'Alpha', allFound: false, bodies };
}

describe('exobiologyStops', () => {
  it('folds samples into stops, with the jumps between them', () => {
    const entries = [
      entry(1, 3, 'a'),
      entry(1, 3, 'b'),
      entry(2, 7, 'c'),
      // Back in the first system after jumping away: a stop of its own.
      entry(1, 9, 'd'),
    ];
    expect(
      exobiologyStops(entries).map((stop) => [
        stop.systemName,
        stop.entries.map((e) => e.species),
        stop.jumpsBefore,
      ]),
    ).toEqual([
      ['System 1', ['a', 'b'], undefined],
      ['System 2', ['c'], 4],
      ['System 1', ['d'], 2],
    ]);
    expect(jumpsSinceLastStop(entries, 12)).toBe(3);
    expect(jumpsSinceLastStop([], 12)).toBeUndefined();
  });

  it('orders a stop by body, then by when each was analysed', () => {
    const on = (bodyName: string, species: string) => ({ ...entry(1, 3, species), bodyName });
    const [stop] = exobiologyStops([
      on('System 1 A 10', 'a'),
      on('System 1 A 2 a', 'b'),
      on('System 1 A 2', 'c'),
      on('System 1 A 10', 'd'),
    ]);
    expect(stop?.entries.map((e) => e.species)).toEqual(['c', 'b', 'a', 'd']);
  });
});

describe('bioBodies', () => {
  it('lists species in progress and genuses not yet started, dearest first, with what is left to earn', () => {
    const [bio, ...rest] = bioBodies(
      survey([
        body({ bodyId: 0, name: 'Alpha A', kind: 'star' }),
        body({
          bioSignals: 3,
          genuses: [
            genus('bact', 'Bacterium', 1, 8, false),
            genus('strat', 'Stratum', 2, 19, true),
          ],
          organics: [
            {
              status: 'pending',
              species: 'b04',
              name: 'Bacterium Acies',
              genus: 'Bacterium',
              genusCode: 'bact',
              samples: 3,
              value: 5,
              newSpecies: true,
            },
          ],
        }),
      ]),
    );
    expect(rest).toEqual([]);
    expect(bio?.lines.map((line) => [line.name, line.progress, line.isNew])).toEqual([
      ['Stratum', '—', true],
      ['Bacterium Acies', 'analysed', true],
    ]);
    expect(bio).toMatchObject({ unnamed: 1, collected: 5, potentialMin: 2, potentialMax: 19 });
  });

  it('lists bodies by name, as the system map does', () => {
    const names = bioBodies(
      survey([
        body({ bodyId: 3, name: 'Alpha B 1', bioSignals: 1, distanceLs: 10 }),
        body({ bodyId: 4, name: 'Alpha A 10', bioSignals: 1, distanceLs: 20 }),
        body({ bodyId: 5, name: 'Alpha A 2 a', bioSignals: 1, distanceLs: 30 }),
        body({ bodyId: 6, name: 'Alpha A 2', bioSignals: 1, distanceLs: 40 }),
      ]),
    ).map((bio) => bio.body.name);
    expect(names).toEqual(['Alpha A 2', 'Alpha A 2 a', 'Alpha A 10', 'Alpha B 1']);
  });

  it('sorts by distance, unknown last, or by the most to be had', () => {
    const bodies = bioBodies(
      survey([
        body({ bodyId: 3, name: 'Alpha 1', bioSignals: 1, distanceLs: 300 }),
        body({ bodyId: 4, name: 'Alpha 2', bioSignals: 1 }),
        body({
          bodyId: 5,
          name: 'Alpha 3',
          bioSignals: 1,
          distanceLs: 100,
          genuses: [genus('strat', 'Stratum', 2, 19, false)],
        }),
        body({
          bodyId: 6,
          name: 'Alpha 4',
          bioSignals: 1,
          distanceLs: 50,
          genuses: [genus('bact', 'Bacterium', 1, 8, false)],
        }),
      ]),
    );
    const names = (sort: 'name' | 'distance' | 'value') =>
      sortBioBodies(bodies, sort).map((bio) => bio.body.name);
    expect(names('name')).toEqual(['Alpha 1', 'Alpha 2', 'Alpha 3', 'Alpha 4']);
    expect(names('distance')).toEqual(['Alpha 4', 'Alpha 3', 'Alpha 1', 'Alpha 2']);
    expect(names('value')).toEqual(['Alpha 3', 'Alpha 4', 'Alpha 1', 'Alpha 2']);
  });

  it('asks for a map when the scanner has only counted the signals', () => {
    const [bio] = bioBodies(survey([body({ bioSignals: 2 })]));
    expect(bio).toMatchObject({ lines: [], unnamed: 2 });
  });

  it('names a genus by its species when the spawn rules leave only one', () => {
    const tectonicas = species('Stratum Tectonicas', 19, ['Lime']);
    const [bio] = bioBodies(
      survey([
        body({
          bioSignals: 2,
          genuses: [
            { ...genus('strat', 'Stratum', 19, 19, false), candidates: [tectonicas] },
            {
              ...genus('bact', 'Bacterium', 8, 9, false),
              candidates: [species('Bacterium Cerbrus', 8), species('Bacterium Tela', 9)],
            },
          ],
        }),
      ]),
    );
    expect(bio?.lines.map((line) => [line.name, line.variant, line.candidates?.length])).toEqual([
      ['Stratum Tectonicas', 'Lime', 1],
      ['Bacterium', undefined, 2],
    ]);
    expect(bio?.lines[0]?.isNew).toBe(true);
    expect(bio?.lines[1]?.candidates?.map((candidate) => candidate.name)).toEqual([
      'Bacterium Tela',
      'Bacterium Cerbrus',
    ]);
  });

  it('values unnamed signals from the genera that could be there', () => {
    const [bio] = bioBodies(
      survey([
        body({
          bioSignals: 3,
          genuses: [],
          organics: [
            {
              status: 'pending',
              species: 'b04',
              name: 'Bacterium Acies',
              genus: 'Bacterium',
              genusCode: 'bact',
              samples: 1,
              value: 5,
              newSpecies: false,
            },
          ],
          possibleGenuses: [
            possibleGenus('bact', 'Bacterium', 5, 5),
            possibleGenus('strat', 'Stratum', 19, 19),
            possibleGenus('fonti', 'Fonticulua', 2, 28),
            possibleGenus('osse', 'Osseus', 4, 6),
          ],
        }),
      ]),
    );
    const predicted = bio?.lines.find((line) => line.status === 'predicted');
    // Two signals left; the sampled Bacterium can't be one of them.
    expect(predicted).toMatchObject({ name: '2 unnamed', minValue: 2 + 4, maxValue: 28 + 19 });
    expect(predicted?.candidates?.map((candidate) => candidate.name)).toEqual([
      'Fonticulua',
      'Stratum',
      'Osseus',
    ]);
    // The unnamed signals are a total of two, so they stay under the named ones whatever they pay.
    expect(bio?.lines.at(-1)).toBe(predicted);
    expect(bio).toMatchObject({ potentialMin: 5 + 6, potentialMax: 5 + 47 });
  });
});

describe('formatCreditRange', () => {
  it('shows one price, a range, or a question mark', () => {
    expect(formatCreditRange(undefined, undefined)).toBe('?');
    expect(formatCreditRange(1_000_000, 1_000_000)).toBe(`${formatCompact(1_000_000)} CR`);
    expect(formatCreditRange(1_000_000, 8_400_000)).toBe(
      `${formatCompact(1_000_000)}–${formatCompact(8_400_000)} CR`,
    );
  });
});

describe('formatBodyValue', () => {
  const bio = (collected: number, potentialMin: number, potentialMax: number): BioBody => ({
    body: body({}),
    lines: [],
    unnamed: 0,
    collected,
    potentialMin,
    potentialMax,
  });
  const m = (value: number) => formatCompact(value);

  it('shows what is analysed out of the whole body', () => {
    expect(formatBodyValue(bio(4_000_000, 8_000_000, 26_000_000))).toBe(
      `${m(4_000_000)} / ${m(12_000_000)}–${m(30_000_000)} CR`,
    );
    expect(formatBodyValue(bio(4_000_000, 0, 0))).toBe(`${m(4_000_000)} / ${m(4_000_000)} CR`);
  });

  it('shows only the whole before anything is analysed, and nothing when nothing is known', () => {
    expect(formatBodyValue(bio(0, 1_000_000, 8_000_000))).toBe(
      `${m(1_000_000)}–${m(8_000_000)} CR`,
    );
    expect(formatBodyValue(bio(0, 0, 0))).toBeUndefined();
  });
});

describe('formatPlayed', () => {
  it('shows hours and minutes, or minutes alone under an hour', () => {
    expect(formatPlayed(0)).toBe('0m');
    expect(formatPlayed(45)).toBe('45m');
    expect(formatPlayed(125)).toBe('2h 05m');
  });
});

function tallyOf(bySource: Partial<Tally['bySource']>): Tally {
  return {
    from: 0,
    to: 1,
    minutesPlayed: 60,
    jumps: 0,
    distanceLy: 0,
    earned: 0,
    lost: 0,
    bySource: {
      exobiology: 0,
      cartographics: 0,
      bounties: 0,
      trade: 0,
      missions: 0,
      other: 0,
      ...bySource,
    },
  };
}

describe('sourceShares', () => {
  it('lists what made money, largest first, as shares of the whole', () => {
    const shares = sourceShares(tallyOf({ cartographics: 1_000_000, exobiology: 3_000_000 }));
    expect(shares.map((share) => [share.source, share.share])).toEqual([
      ['exobiology', 0.75],
      ['cartographics', 0.25],
    ]);
  });

  it('shows a trade at a loss without letting it skew the shares', () => {
    const shares = sourceShares(tallyOf({ missions: 200_000, trade: -50_000 }));
    expect(shares).toMatchObject([
      { source: 'missions', share: 1 },
      { source: 'trade', value: -50_000, share: 0 },
    ]);
  });
});

describe('bioBodies mapping', () => {
  const bodies = () =>
    bioBodies(
      survey([
        // Worth mapping, and over the cutoff once mapped.
        body({
          bodyId: 1,
          name: 'Alpha 1',
          type: 'Water world',
          value: 290_000,
          mappingValue: 1_440_000,
          bioSignals: 2,
        }),
        // Worth mapping, but under it.
        body({
          bodyId: 2,
          name: 'Alpha 2',
          type: 'Water world',
          value: 100_000,
          mappingValue: 450_000,
          bioSignals: 1,
        }),
        // Life on a class mapping doesn't pay for.
        body({ bodyId: 3, name: 'Alpha 3', type: 'Rocky body', mappingValue: 6500, bioSignals: 3 }),
        // Worth mapping, but the commander already has.
        body({
          bodyId: 4,
          name: 'Alpha 4',
          type: 'Ammonia world',
          mapped: true,
          value: 500_000,
          mappingValue: 2_000_000,
          bioSignals: 1,
        }),
      ]),
      1_000_000,
    );

  it('says what mapping adds, for the bodies over the same cutoff as a probe target', () => {
    expect(bodies().map((bio) => [bio.body.name, bio.mapping?.worth])).toEqual([
      ['Alpha 1', 1_730_000],
      ['Alpha 2', undefined],
      ['Alpha 3', undefined],
      ['Alpha 4', undefined],
    ]);
  });

  it('formats the earnings as a tag', () => {
    const [first] = bodies();
    expect(formatMappingTag(first!.mapping!)).toBe(`+${formatCompact(1_440_000)} CR to map`);
    expect(formatMappingTag({ body: first!.body, worth: 0 })).toBe('worth mapping');
  });
});

describe('probeTargets', () => {
  it('lists the classes worth mapping, best return on the detour first', () => {
    const targets = probeTargets(
      survey([
        body({ bodyId: 0, name: 'Alpha', kind: 'star', type: 'K', distanceLs: 0 }),
        // Worth millions, but far out.
        body({
          bodyId: 1,
          name: 'Alpha 1',
          type: 'Earthlike body',
          distanceLs: 20000,
          mappingValue: 3_700_000,
        }),
        // Less, but close by.
        body({
          bodyId: 2,
          name: 'Alpha 2',
          type: 'Rocky body',
          terraformable: true,
          distanceLs: 300,
          mappingValue: 1_760_000,
        }),
        // Also near, where only the pay counts: cheaper, so after Alpha 2.
        body({
          bodyId: 3,
          name: 'Alpha 3',
          type: 'Water world',
          distanceLs: 450,
          mappingValue: 1_440_000,
          bioSignals: 2,
        }),
        // Already mapped by the commander.
        body({ bodyId: 4, name: 'Alpha 4', type: 'Ammonia world', mapped: true }),
        // Life, but not worth mapping for credits: the biology section has it.
        body({ bodyId: 5, name: 'Alpha 5', type: 'Rocky body', mappingValue: 6500, bioSignals: 3 }),
        body({ bodyId: 6, name: 'Alpha 6', type: 'Sudarsky class II gas giant', distanceLs: 10 }),
      ]),
    );
    expect(targets.map((target) => target.body.name)).toEqual(['Alpha 2', 'Alpha 3', 'Alpha 1']);
    expect(targets.map(formatProbeEarnings)).toEqual([
      `+${formatCompact(1_760_000)} CR`,
      `+${formatCompact(1_440_000)} CR`,
      `+${formatCompact(3_700_000)} CR`,
    ]);
  });

  it('leaves out bodies worth less than the threshold once mapped', () => {
    const targets = probeTargets(
      survey([
        body({ name: 'Alpha 1', type: 'Water world', value: 100_000, mappingValue: 450_000 }),
        body({
          bodyId: 2,
          name: 'Alpha 2',
          type: 'Water world',
          value: 290_000,
          mappingValue: 1_440_000,
        }),
      ]),
      1_000_000,
    );
    expect(targets.map((target) => [target.body.name, target.worth])).toEqual([
      ['Alpha 2', 1_730_000],
    ]);
  });

  it('is empty without a survey', () => {
    expect(probeTargets(undefined)).toEqual([]);
  });
});
