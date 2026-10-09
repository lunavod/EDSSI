import { describe, expect, it } from 'vitest';

import type { ShipLoss } from '../../../shared/history';
import type { JournalEvent } from '../../../shared/journal';
import { lossFor, lossTotal, summariseLoss } from './losses';

const loss: ShipLoss = {
  timestamp: '2026-09-10T10:00:00Z',
  systemName: 'Beta',
  cartographics: { value: 1_500_000, bodies: 3, systems: 2 },
  exobiology: { value: 20_000_000, species: 1 },
  bounties: 0,
  combatBonds: 400_000,
  notable: [],
};

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test payload, like parsed JSON.
const event = (fields: Record<string, unknown>) => fields as unknown as JournalEvent;

describe('lossFor', () => {
  it('matches the Died line it was recorded for, and nothing else', () => {
    expect(lossFor(event({ event: 'Died', timestamp: loss.timestamp }), [loss])).toBe(loss);
    expect(lossFor(event({ event: 'Died', timestamp: '2026-09-10T11:00:00Z' }), [loss])).toBe(
      undefined,
    );
    expect(lossFor(event({ event: 'Resurrect', timestamp: loss.timestamp }), [loss])).toBe(
      undefined,
    );
  });
});

describe('summariseLoss', () => {
  it('names only what cost something', () => {
    // Digit grouping follows the machine's locale, so compare without the separators.
    expect(summariseLoss(loss)?.replaceAll(/(?<=\d)[\s,.](?=\d)/gu, '')).toBe(
      '1500000 CR of scan data (3 bodies) · 20000000 CR of samples (1 species) · 400000 CR in combat bonds',
    );
    expect(lossTotal(loss)).toBe(21_900_000);
  });

  it('is nothing at all when the death was free', () => {
    expect(
      summariseLoss({
        ...loss,
        cartographics: { value: 0, bodies: 0, systems: 0 },
        exobiology: { value: 0, species: 0 },
        combatBonds: 0,
      }),
    ).toBe(undefined);
  });
});
