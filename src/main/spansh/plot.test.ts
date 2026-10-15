import { describe, expect, it, vi } from 'vitest';

import type { CsvRoute } from '../../shared/csv-route';
import type { LoadoutEvent } from '../../shared/journal';
import type { SpanshPlotState } from '../../shared/spansh-plot';
import type { OwnedShip } from '../ships-service';
import { SpanshClient } from './client';
import { shipChoices, SpanshPlotter } from './plot';

const LOADOUT: LoadoutEvent = {
  timestamp: '2026-10-16T10:00:00Z',
  event: 'Loadout',
  Ship: 'python',
  ShipID: 7,
  ShipName: 'Wanderer',
  ShipIdent: 'WA-01',
  HullHealth: 1,
  UnladenMass: 400,
  CargoCapacity: 64,
  MaxJumpRange: 30,
  FuelCapacity: { Main: 32, Reserve: 0.83 },
  Rebuy: 1,
  Modules: [
    {
      Slot: 'FrameShiftDrive',
      Item: 'int_hyperdrive_size5_class5',
      On: true,
      Priority: 0,
      Health: 1,
    },
  ],
};

const OWNED: OwnedShip[] = [
  { shipId: 7, type: 'Python', name: 'Wanderer', current: true, loadout: LOADOUT },
  { shipId: 9, type: 'Sidewinder', current: false, where: 'Jameson Memorial' },
];

const SYSTEMS: Record<string, string> = { sol: '10477373803', sirius: '121569805492', b: '5' };

/** Spansh as far as the plotter asks it: system names, queued jobs and their results. */
function fakeSpansh(results: Record<string, unknown>) {
  const forms: { path: string; form: URLSearchParams }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
    );
    const path = pathname.replace(/^\/api/, '');
    if (path === '/search/systems') {
      const name = searchParams.get('q') ?? '';
      const id = SYSTEMS[name.toLowerCase()];
      return Response.json({ results: id ? [{ id64: id, name, x: 0, y: 0, z: 0 }] : [] });
    }
    if (path.startsWith('/results/')) {
      const job = path.slice('/results/'.length);
      return Response.json({ job, status: 'ok', result: results[job] });
    }
    forms.push({
      path,
      form: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
    });
    return Response.json({ job: `job${forms.length}`, status: 'queued' });
  });
  return { client: new SpanshClient({ fetch, sleep: async () => {} }), forms };
}

function plotter(client: SpanshClient) {
  const states: SpanshPlotState[] = [];
  const followed: CsvRoute[] = [];
  const instance = new SpanshPlotter({
    client,
    here: () => ({ name: 'Sol', address: 10477373803 }),
    ship: () => ({ loadout: LOADOUT, cargo: 12 }),
    ships: () => OWNED,
    onChange: (state) => states.push(state),
    follow: (route) => followed.push(route),
    save: () => ({ id: 3 }),
    now: () => new Date('2026-10-16T12:00:00Z'),
  });
  return { instance, states, followed };
}

const jumps = (...names: string[]) => ({
  jumps: names.map((name, index) => ({ name, distance: index === 0 ? 0 : 8 })),
});

describe('SpanshPlotter', () => {
  it("plots a galaxy route from here with the ship's drive and cargo", async () => {
    const { client, forms } = fakeSpansh({ job1: jumps('Sol', 'Sirius') });
    const { instance, states } = plotter(client);
    const error = await instance.plot({
      kind: 'galaxy',
      from: '',
      to: 'Sirius',
      algorithm: 'optimistic',
      supercharge: true,
      injections: false,
      excludeSecondary: false,
      refuelEveryScoopable: true,
      reserve: 0,
    });
    expect(error).toBeUndefined();
    const [{ path, form }] = forms as [(typeof forms)[number]];
    expect(path).toBe('/generic/route');
    expect(form.get('source')).toBe('10477373803');
    expect(form.get('destination')).toBe('121569805492');
    expect(form.get('cargo')).toBe('12');
    expect(form.get('optimal_mass')).toBe('1050');
    expect(form.get('use_supercharge')).toBe('1');
    expect(states[0]?.running?.request.to).toBe('Sirius');
    const { result, running } = instance.state();
    expect(running).toBeUndefined();
    expect(result?.route.fileName).toBe('Sol → Sirius · galaxy');
    expect(result?.route.systems.map((system) => system.name)).toEqual(['Sol', 'Sirius']);
    expect(result?.jobs).toEqual(['job1']);
  });

  it('plots a galaxy route with stops on the way one leg at a time', async () => {
    const { client, forms } = fakeSpansh({ job1: jumps('Sol', 'B'), job2: jumps('B', 'Sirius') });
    const { instance } = plotter(client);
    await instance.plot({
      kind: 'galaxy',
      from: 'Sol',
      to: 'Sirius',
      via: ['B'],
      algorithm: 'fuel',
      supercharge: false,
      injections: false,
      excludeSecondary: true,
      refuelEveryScoopable: false,
      cargo: 0,
      reserve: 1,
    });
    expect(forms.map(({ form }) => [form.get('source'), form.get('destination')])).toEqual([
      ['10477373803', '5'],
      ['5', '121569805492'],
    ]);
    expect(instance.state().result?.route.systems.map((system) => system.name)).toEqual([
      'Sol',
      'B',
      'Sirius',
    ]);
  });

  it("asks the neutron plotter by name with the ship's range", async () => {
    const { client, forms } = fakeSpansh({
      job1: { system_jumps: [{ system: 'Sol' }, { system: 'Sirius', jumps: 1 }] },
    });
    const { instance } = plotter(client);
    await instance.plot({ kind: 'neutron', from: '', to: 'Sirius', efficiency: 60 });
    const form = forms[0]?.form;
    expect(form?.get('from')).toBe('Sol');
    expect(Number(form?.get('range'))).toBeGreaterThan(10);
    expect(form?.get('supercharge_multiplier')).toBe('4');
  });

  it('says why a system is unknown, and why a ship without a loadout cannot fly', async () => {
    const { client } = fakeSpansh({});
    const { instance } = plotter(client);
    expect(
      await instance.plot({ kind: 'carrier', from: '', to: 'Nowhere', carrier: 'fleet', used: 0 }),
    ).toBe("Spansh doesn't know a system called Nowhere.");
    expect(
      await instance.plot({ kind: 'neutron', from: '', to: 'Sirius', efficiency: 60, shipId: 9 }),
    ).toMatch(/loadout/);
    expect(instance.state().last?.error).toMatch(/loadout/);
  });

  it('follows the route plotted, and remembers when', async () => {
    const { client } = fakeSpansh({ job1: jumps('Sol', 'Sirius') });
    const { instance, followed } = plotter(client);
    expect(instance.follow()).toBe(false);
    await instance.plot({ kind: 'carrier', from: '', to: 'Sirius', carrier: 'fleet', used: 0 });
    expect(instance.follow()).toBe(true);
    expect(followed[0]?.systems).toHaveLength(2);
    expect(instance.state().result?.followedAt).toBe(followed[0]?.loadedAt);
    expect(instance.save('Trip')).toBeUndefined();
    expect(instance.state().result?.route.savedId).toBe(3);
  });

  it('keeps the last route on show while another is plotted, and when that one fails', async () => {
    const { client } = fakeSpansh({ job1: jumps('Sol', 'Sirius') });
    const { instance, states } = plotter(client);
    await instance.plot({ kind: 'carrier', from: '', to: 'Sirius', carrier: 'fleet', used: 0 });
    const plotted = instance.state().result;
    await instance.plot({ kind: 'carrier', from: '', to: 'Nowhere', carrier: 'fleet', used: 0 });
    expect(states.at(-2)?.result).toBe(plotted);
    expect(instance.state().result).toBe(plotted);
    expect(instance.state().last?.error).toMatch(/Nowhere/);
  });

  it('is cancelled while it waits', async () => {
    const { client } = fakeSpansh({});
    const { instance } = plotter(client);
    const plotting = instance.plot({ kind: 'neutron', from: '', to: 'Sirius', efficiency: 60 });
    instance.cancel();
    expect(await plotting).toBe('cancelled');
  });
});

describe('shipChoices', () => {
  it("gives each ship's range, or why it has none", () => {
    const [flying, stored] = shipChoices({ loadout: LOADOUT, cargo: 0 }, OWNED);
    expect(flying).toMatchObject({ id: 7, label: 'Wanderer (Python)', current: true, cargo: 0 });
    expect(flying?.range).toBeGreaterThan(10);
    expect(stored).toMatchObject({ id: 9, label: 'Sidewinder', where: 'Jameson Memorial' });
    expect(stored?.problem).toMatch(/loadout/);
  });
});
