import { describe, expect, it, vi } from 'vitest';

import type { Coords, Located } from '../../shared/csv-route';
import { locateSystems, type SystemLocator } from './locate';

const systems = [
  { name: 'Sol', values: [], coords: [0, 0, 0] as Coords },
  { name: 'Wepe FG-Y g204', values: [] },
];

const everywhere: SystemLocator = (names) =>
  Promise.resolve(
    new Map(
      names.map((name): [string, Located] => [
        name.toLowerCase(),
        { coords: [1, 2, 3], starClass: 'K' },
      ]),
    ),
  );

const failing: SystemLocator = () => Promise.reject(new Error('no answer'));
const absent: SystemLocator = () => Promise.resolve(undefined);

describe('locateSystems', () => {
  it('asks a locator about every system, and not EDSM', async () => {
    const edsm = vi.fn(() => Promise.resolve(new Map<string, Coords>()));
    const found = await locateSystems(systems, { locators: [everywhere], edsm });
    expect(found.get('wepe fg-y g204')).toEqual({ coords: [1, 2, 3], starClass: 'K' });
    expect(found.get('sol')).toEqual({ coords: [1, 2, 3], starClass: 'K' });
    expect(edsm).not.toHaveBeenCalled();
  });

  it("goes on to the next locator when one fails or isn't set up", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const edsm = vi.fn(() => Promise.resolve(new Map<string, Coords>()));
    const found = await locateSystems(systems, { locators: [absent, failing, everywhere], edsm });
    expect(found.size).toBe(2);
    expect(edsm).not.toHaveBeenCalled();
  });

  it('asks EDSM for the unplaced ones with no locator, or when every one fails', async () => {
    const edsm = vi.fn((names: readonly string[]) =>
      Promise.resolve(
        new Map(names.map((name): [string, Coords] => [name.toLowerCase(), [4, 5, 6]])),
      ),
    );
    expect(await locateSystems(systems, { locators: [], edsm })).toEqual(
      new Map([['wepe fg-y g204', { coords: [4, 5, 6] }]]),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await locateSystems(systems, { locators: [failing], edsm })).size).toBe(1);
    expect(edsm).toHaveBeenLastCalledWith(['Wepe FG-Y g204']);
  });
});
