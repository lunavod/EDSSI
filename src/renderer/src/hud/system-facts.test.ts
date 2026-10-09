import { describe, expect, it } from 'vitest';

import type { SystemExternalInfo } from '../../../shared/edsm';
import type { SurveyBody, SystemSurvey } from '../../../shared/history';
import { formatCompact, formatCompactParts } from '../journal/format';
import {
  bioFact,
  bodiesFact,
  cartoFact,
  exobioFact,
  starBadge,
  systemFacts,
  systemTags,
  trafficFact,
} from './system-facts';

function body(overrides: Partial<SurveyBody> = {}): SurveyBody {
  return {
    bodyId: 1,
    name: 'Test A',
    kind: 'star',
    type: 'K',
    landable: false,
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

function survey(overrides: Partial<SystemSurvey> = {}): SystemSurvey {
  return { systemAddress: 1, systemName: 'Test', allFound: false, bodies: [], ...overrides };
}

const sol: SystemExternalInfo = {
  name: 'Sol',
  status: 'ok',
  traffic: { day: 41, week: 198, total: 28333 },
  deaths: { day: 0, week: 5, total: 6843 },
  primaryStar: { type: 'G (White-Yellow) Star', scoopable: true },
  closestStarport: { name: 'Furukawa Enterprise', type: 'Planetary Outpost', distanceLs: 193 },
};

describe('star badge', () => {
  it('prefers the star class from the journal, falling back to the route and then EDSM', () => {
    expect(starBadge('M', undefined)).toMatchObject({ label: 'M', scoopable: true });
    expect(starBadge('DA', sol)).toMatchObject({ label: 'DA', scoopable: false });
    expect(starBadge(undefined, undefined, true)).toMatchObject({ scoopable: true });
    expect(starBadge(undefined, sol)).toMatchObject({ label: 'G', scoopable: true });
    expect(starBadge(undefined, { name: 'X', status: 'unknown' })).toMatchObject({
      label: '?',
    });
    expect(starBadge(undefined, undefined).scoopable).toBeUndefined();
  });
});

describe('system facts', () => {
  it('show exploration in the black, and what matters where people live', () => {
    const black = systemFacts(survey(), sol, { population: 0 });
    expect(black.map((fact) => fact.label)).toEqual([
      'Bodies',
      'Bio signals',
      'Carto value',
      'Exobio value',
    ]);
    const bubble = systemFacts(survey(), sol, { population: 73_300_000 });
    expect(bubble.map((fact) => fact.label)).toEqual([
      'Bodies',
      'Population',
      'Traffic 24 h',
      'Starport',
    ]);
    // Split wherever the locale puts its word for a million: 73.3M, or 73,3 млн.
    const [, value, unit] = /^(.*?\d)\s*(\p{L}.*)$/u.exec(formatCompact(73_300_000)) ?? [];
    expect(bubble[1]).toMatchObject({ value, unit });
    expect(bubble[3]).toMatchObject({ value: '193', unit: ' ls' });
  });

  it('grade traffic, and mark what EDSM has not answered', () => {
    expect(trafficFact(sol)).toMatchObject({ value: '41', tone: 'warning' });
    expect(trafficFact(undefined).value).toBe('…');
    expect(trafficFact({ name: 'X', status: 'unavailable' })).toMatchObject({
      value: '?',
      title: 'EDSM could not be reached',
    });
  });

  it('count scanned bodies against the honk', () => {
    expect(bodiesFact(undefined).value).toBe('…');
    expect(bodiesFact(survey({ bodies: [body()] }))).toMatchObject({ value: '1', unit: '/?' });
    const honked = survey({ bodyCount: 12, nonBodyCount: 3, progress: 0.25, bodies: [body()] });
    expect(bodiesFact(honked)).toMatchObject({
      value: '1',
      unit: '/12',
      title: '11 left to resolve in the FSS · 3 other signals · 25% resolved at the honk',
    });
  });

  it('count life, and value the system’s data once there is some', () => {
    expect(bioFact(survey()).value).toBe('0');
    expect(cartoFact(survey()).value).toBe('—');
    const bodies = [
      body({ bodyId: 2, kind: 'planet', bioSignals: 3 }),
      body({ bodyId: 3, kind: 'planet', bioSignals: 1, value: 50_000 }),
      body({ bodyId: 4, kind: 'planet', value: 70_000, status: 'sold' }),
    ];
    expect(bioFact(survey({ bodies }))).toMatchObject({ value: '4', unit: ' on 2', tone: 'good' });
    expect(cartoFact(survey({ bodies }))).toMatchObject(formatCompactParts(50_000));
  });

  it('values the life in a system, only when there is some', () => {
    expect(exobioFact(survey({ bodies: [body({ value: 50_000 })] })).value).toBe('—');
    expect(exobioFact(survey({ bodies: [body({ bioSignals: 2 })] })).value).toBe('?');
    const stratum = {
      code: 'strat',
      name: 'Stratum',
      minValue: 2_000,
      maxValue: 19_000,
      newGenus: false,
      candidates: [],
    };
    const alive = body({
      kind: 'planet',
      bioSignals: 2,
      genuses: [stratum],
      organics: [
        {
          status: 'pending',
          species: 'b04',
          name: 'Bacterium Acies',
          genus: 'Bacterium',
          genusCode: 'bact',
          samples: 3,
          value: 5_000,
          newSpecies: false,
        },
      ],
    });
    // Both ends in thousands: the unit once, after the range.
    const low = formatCompactParts(7_000);
    const high = formatCompactParts(24_000);
    expect(exobioFact(survey({ bodies: [alive] }))).toMatchObject({
      value: `${low.value}–${high.value}`,
      unit: high.unit,
    });
    // Thousands up to millions: each end keeps its own.
    const rich = { ...alive, genuses: [{ ...stratum, maxValue: 19_000_000 }] };
    const wide = exobioFact(survey({ bodies: [rich] }));
    expect(wide.value).toBe(`${formatCompact(7_000)}–${formatCompact(19_005_000)}`);
    expect(wide.unit).toBeUndefined();
  });
});

describe('system tags', () => {
  it('warn of a star that cannot be scooped, and of ships lost here', () => {
    const tags = systemTags('DA', undefined, { ...sol, deaths: { day: 6, week: 9, total: 99 } });
    expect(tags).toMatchObject([
      { label: 'Not scoopable · DA', tone: 'warn' },
      { label: 'Threat high', tone: 'danger' },
    ]);
    expect(systemTags('K', undefined, sol)).toEqual([]);
  });

  it('call a system undiscovered from the arrival star, not from the other bodies', () => {
    const bodies = [body({ firstDiscovery: true }), body({ bodyId: 2, kind: 'planet' })];
    expect(systemTags('K', survey({ bodies, bodyCount: 2 }), sol)).toMatchObject([
      { label: 'Undiscovered', tone: 'good' },
    ]);
    const charted = [body(), body({ bodyId: 2, kind: 'planet', firstDiscovery: true })];
    expect(systemTags('K', survey({ bodies: charted, bodyCount: 2 }), sol)).toMatchObject([
      { label: '1 new', tone: 'accent' },
    ]);
  });

  it('say when the honk has not gone off, or EDSM has never heard of the system', () => {
    expect(systemTags('K', survey(), { name: 'X', status: 'unknown' })).toMatchObject([
      { label: 'Not honked', tone: 'warn' },
      { label: 'Not in EDSM', tone: 'good' },
    ]);
  });

  it('name other surface signals, keeping mining locations out, and count landable bodies', () => {
    const bodies = [
      body({
        bodyId: 2,
        kind: 'planet',
        landable: true,
        signals: [
          { type: 'Planetary Mining Location', count: 15 },
          { type: 'Geological', count: 3 },
        ],
      }),
      body({
        bodyId: 3,
        kind: 'planet',
        signals: [
          { type: 'Geological', count: 2 },
          { type: 'Thargoid', count: 1 },
          { type: 'Biological', count: 4 },
        ],
      }),
    ];
    expect(systemTags('K', survey({ bodies, bodyCount: 3 }), sol)).toMatchObject([
      { label: 'Geo 5', tone: 'ghost' },
      { label: 'Thargoid 1', tone: 'warn' },
      { label: '1 landable', tone: 'ghost' },
    ]);
  });
});
