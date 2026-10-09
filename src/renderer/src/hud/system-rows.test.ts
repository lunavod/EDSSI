import { describe, expect, it } from 'vitest';

import type { SystemExternalInfo } from '../../../shared/edsm';
import type { SurveyBody, SystemSurvey } from '../../../shared/history';
import { securityRow, systemValueRow, threatRow } from './system-rows';

function body(overrides: Partial<SurveyBody> = {}): SurveyBody {
  return {
    bodyId: 1,
    name: 'Test A',
    kind: 'planet',
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
  deaths: { day: 2, week: 5, total: 6843 },
};

describe('system rows', () => {
  it('grade the threat, and say whether EDSM is still loading, offline or has nothing', () => {
    expect(threatRow(sol)).toMatchObject({ value: 'Medium', tone: 'warning' });
    expect(threatRow({ ...sol, deaths: { day: 0, week: 0, total: 1 } })).toMatchObject({
      value: 'Low',
      tone: undefined,
    });
    expect(threatRow(undefined).value).toBe('…');
    expect(threatRow({ name: 'X', status: 'unavailable' }).value).toBe('EDSM offline');
    expect(threatRow({ name: 'X', status: 'unknown' }).value).toBe('No EDSM data');
  });

  it('flag lawless systems', () => {
    expect(securityRow('Anarchy').tone).toBe('danger');
    expect(securityRow('Low Security').tone).toBe('warning');
    expect(securityRow('High Security').tone).toBeUndefined();
  });

  it('value the unsold scans only once there are some', () => {
    expect(systemValueRow(survey())).toBeUndefined();
    expect(systemValueRow(survey({ bodies: [body({ value: 50_000, status: 'sold' })] }))).toBe(
      undefined,
    );
    const unsold = [body({ value: 50_000, status: 'pending' })];
    expect(systemValueRow(survey({ bodies: unsold }))).toMatchObject({ label: 'System value' });
  });
});
