import { describe, expect, it, vi } from 'vitest';

import type { SurveyBody, SystemSurvey } from '../../shared/history';
import type { JournalEvent, StatusEvent } from '../../shared/journal';
import type { PlottedRoute, RouteSystem } from '../../shared/nav-routes';
import { DEFAULT_SETTINGS, type FlightAlertSettings } from '../../shared/settings';
import {
  ARRIVAL_DELAY_MS,
  describeStar,
  FlightAlerts,
  type FlightAlertOptions,
  gravityLine,
  JUMP_TIMEOUT_MS,
  lowFuelLine,
  nextJumpLine,
  readNearestStar,
  scoopableStarSearch,
} from './alerts';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test payloads, like parsed JSON.
const logged = (fields: Record<string, unknown>) => fields as unknown as JournalEvent;

const IN_SHIP = 1 << 24;
const DOCKED = 1 << 0;
const SCOOPING = 1 << 11;
const NEAR_SURFACE = 1 << 21;
const JUMPING = 1 << 30;

function status(flags: number, fields: Record<string, unknown> = {}): StatusEvent {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a cut-down Status.json
  return { event: 'Status', timestamp: '', Flags: flags, ...fields } as unknown as StatusEvent;
}

const fuel = (main: number, flags = IN_SHIP) => status(flags, { Fuel: { FuelMain: main } });

const loadout = logged({ event: 'Loadout', FuelCapacity: { Main: 32, Reserve: 0.5 } });

function jump(address: number, name: string, fields: Record<string, unknown> = {}) {
  return logged({
    event: 'FSDJump',
    StarSystem: name,
    SystemAddress: address,
    StarPos: [address, 0, 0],
    FuelLevel: 30,
    ...fields,
  });
}

function routeSystem(address: number, starClass: string): RouteSystem {
  return {
    StarSystem: `Sys ${address}`,
    SystemAddress: address,
    StarPos: [address, 0, 0],
    StarClass: starClass,
  };
}

function body(fields: Partial<SurveyBody>): SurveyBody {
  return {
    bodyId: 1,
    name: 'Sys 1 1',
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
    ...fields,
  };
}

function setup(
  overrides: Partial<FlightAlertOptions> & { flight?: Partial<FlightAlertSettings> } = {},
) {
  const said: string[] = [];
  const settings = { ...DEFAULT_SETTINGS.flight_alerts, ...overrides.flight };
  const nearestScoopable = vi.fn<FlightAlertOptions['nearestScoopable']>(async () => ({
    system: 'Nearby',
    distanceLy: 6.25,
  }));
  const primaryStar = vi.fn<FlightAlertOptions['primaryStar']>(async () => undefined);
  const alerts = new FlightAlerts({
    settings: () => settings,
    routes: () => [],
    survey: () => undefined,
    primaryStar,
    nearestScoopable,
    notify: (text) => said.push(text),
    ...overrides,
  });
  alerts.event(loadout);
  alerts.markLive();
  return { alerts, said, nearestScoopable, primaryStar };
}

/** Lets the star lookups settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('low fuel', () => {
  it('names the nearest scoopable star once per system', async () => {
    const { alerts, said, nearestScoopable } = setup();
    alerts.event(jump(1, 'Sys 1'));
    alerts.status(fuel(20));
    expect(said).toEqual([]);
    alerts.status(fuel(7));
    alerts.status(fuel(6));
    await settle();
    expect(said).toEqual(['Fuel at 22%. Nearest scoopable star: Nearby, 6.3 light years.']);
    expect(nearestScoopable).toHaveBeenCalledOnce();
    expect(nearestScoopable.mock.calls[0]![0]).toEqual({ x: 1, y: 0, z: 0 });

    alerts.event(jump(2, 'Sys 2', { FuelLevel: 4 }));
    await settle();
    expect(said).toHaveLength(2);
  });

  it('prefers a star a few jumps along the route', async () => {
    const route: PlottedRoute = {
      id: 1,
      plottedAt: '2026-09-18T00:00:00Z',
      systems: [
        routeSystem(1, 'N'),
        routeSystem(2, 'DA'),
        routeSystem(3, 'K'),
        routeSystem(4, 'M'),
      ],
    };
    const { alerts, said, nearestScoopable } = setup({ routes: () => [route] });
    alerts.event(jump(1, 'Sys 1', { FuelLevel: 3 }));
    await settle();
    expect(said).toContain(
      'Fuel at 9%. Nearest scoopable star: Sys 3, 2 jumps on along the route.',
    );
    expect(nearestScoopable).not.toHaveBeenCalled();
  });

  it('asks Spansh when the route’s star is far off, and falls back to it', async () => {
    const systems = [routeSystem(1, 'N'), ...[2, 3, 4, 5].map((a) => routeSystem(a, 'L'))];
    const route: PlottedRoute = {
      id: 1,
      plottedAt: '2026-09-18T00:00:00Z',
      systems: [...systems, routeSystem(6, 'G')],
    };
    const { alerts, said } = setup({
      routes: () => [route],
      nearestScoopable: async () => {
        throw new Error('down');
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    alerts.event(jump(1, 'Sys 1', { FuelLevel: 3 }));
    await settle();
    expect(said).toContain(
      'Fuel at 9%. Nearest scoopable star: Sys 6, 5 jumps on along the route.',
    );
  });

  it('says so when the star here will do', async () => {
    const survey: SystemSurvey = {
      systemAddress: 1,
      systemName: 'Sys 1',
      allFound: false,
      bodies: [body({ kind: 'star', type: 'K', name: 'Sys 1', distanceLs: 0 })],
    };
    const { alerts, said } = setup({ survey: () => survey });
    alerts.event(jump(1, 'Sys 1', { FuelLevel: 3 }));
    await settle();
    expect(said).toEqual(['Fuel at 9%. The star here is scoopable.']);
  });

  it('uses the class of the star jumped to', async () => {
    const { alerts, said } = setup();
    alerts.event(
      logged({ event: 'StartJump', JumpType: 'Hyperspace', SystemAddress: 1, StarClass: 'F' }),
    );
    alerts.event(jump(1, 'Sys 1', { FuelLevel: 3 }));
    await settle();
    expect(said).toEqual(['Fuel at 9%. The star here is scoopable.']);
  });

  it('stays quiet while docked, jumping, scooping, in a taxi or before the replay ends', async () => {
    const { alerts, said } = setup();
    alerts.event(jump(1, 'Sys 1'));
    alerts.status(fuel(3, IN_SHIP | DOCKED));
    alerts.status(fuel(3, IN_SHIP | JUMPING));
    alerts.status(fuel(3, IN_SHIP | SCOOPING));
    alerts.status(fuel(3, 0));
    alerts.event(jump(2, 'Sys 2', { FuelLevel: 1, Taxi: true }));
    await settle();
    expect(said).toEqual([]);

    const early = new FlightAlerts({
      ...optionsOf(said),
      settings: () => DEFAULT_SETTINGS.flight_alerts,
    });
    early.event(loadout);
    early.event(jump(1, 'Sys 1', { FuelLevel: 1 }));
    await settle();
    expect(said).toEqual([]);
  });

  it('can be turned off', async () => {
    const { alerts, said } = setup({ flight: { low_fuel: false } });
    alerts.event(jump(1, 'Sys 1', { FuelLevel: 1 }));
    await settle();
    expect(said).toEqual([]);
  });
});

describe('unscoopable next jump', () => {
  const target = (address: number, starClass: string) =>
    logged({
      event: 'FSDTarget',
      Name: `Sys ${address}`,
      SystemAddress: address,
      StarClass: starClass,
    });

  it('warns once when the target’s star can’t be scooped', () => {
    const { alerts, said } = setup();
    alerts.event(target(2, 'K'));
    alerts.event(target(3, 'N'));
    alerts.event(target(3, 'N'));
    expect(said).toEqual(['Next jump, Sys 3, has no scoopable star: a neutron star.']);
  });

  it('waits until a little after arriving, as the game targets the next hop mid-jump', () => {
    vi.useFakeTimers();
    try {
      const { alerts, said } = setup();
      alerts.event(
        logged({ event: 'StartJump', JumpType: 'Hyperspace', SystemAddress: 1, StarClass: 'K' }),
      );
      alerts.event(target(2, 'N'));
      vi.advanceTimersByTime(20_000);
      alerts.event(jump(1, 'Sys 1'));
      vi.advanceTimersByTime(ARRIVAL_DELAY_MS - 1);
      expect(said).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(said).toEqual([
        'Next jump, Sys 2, has no scoopable star: a neutron star. Fuel at 94%.',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up waiting on a jump that never arrives', () => {
    vi.useFakeTimers();
    try {
      const { alerts, said } = setup();
      alerts.event(logged({ event: 'StartJump', JumpType: 'Hyperspace', SystemAddress: 1 }));
      alerts.event(target(2, 'N'));
      vi.advanceTimersByTime(JUMP_TIMEOUT_MS - 1);
      expect(said).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(said).toEqual(['Next jump, Sys 2, has no scoopable star: a neutron star.']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the next system off the route after a jump', () => {
    vi.useFakeTimers();
    try {
      const route: PlottedRoute = {
        id: 1,
        plottedAt: '2026-09-18T00:00:00Z',
        systems: [routeSystem(1, 'K'), routeSystem(2, 'DA')],
      };
      const { alerts, said } = setup({ routes: () => [route] });
      alerts.event(jump(1, 'Sys 1'));
      expect(said).toEqual([]);
      vi.advanceTimersByTime(ARRIVAL_DELAY_MS);
      expect(said).toEqual([
        'Next jump, Sys 2, has no scoopable star: a white dwarf. Fuel at 94%.',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds the warning while docked and gives it on undocking', () => {
    const { alerts, said } = setup();
    alerts.status(fuel(32, IN_SHIP | DOCKED));
    alerts.event(target(3, 'H'));
    expect(said).toEqual([]);
    alerts.status(fuel(32));
    expect(said).toEqual(['Next jump, Sys 3, has no scoopable star: a black hole. Fuel at 100%.']);
  });

  it('asks EDSM when the game doesn’t say', async () => {
    const { alerts, said, primaryStar } = setup();
    primaryStar.mockResolvedValue({ type: 'Neutron Star', scoopable: false });
    alerts.event(target(3, ''));
    await settle();
    expect(primaryStar).toHaveBeenCalledWith('Sys 3');
    expect(said).toEqual(['Next jump, Sys 3, has no scoopable star: a neutron star.']);
  });
});

describe('high gravity', () => {
  const survey: SystemSurvey = {
    systemAddress: 1,
    systemName: 'Sys 1',
    allFound: false,
    bodies: [
      body({ bodyId: 5, name: 'Sys 1 5', kind: 'planet', gravity: 30 }),
      body({ bodyId: 6, name: 'Sys 1 6', kind: 'planet', gravity: 9 }),
      body({ bodyId: 7, name: 'Sys 1 7' }),
    ],
  };
  const approach = (bodyId: number) =>
    logged({ event: 'ApproachBody', SystemAddress: 1, Body: `Sys 1 ${bodyId}`, BodyID: bodyId });

  it('warns once on approaching a heavy body', () => {
    const { alerts, said } = setup({ survey: () => survey });
    alerts.event(jump(1, 'Sys 1'));
    alerts.event(approach(5));
    alerts.event(approach(6));
    alerts.event(approach(7));
    alerts.status(status(IN_SHIP | NEAR_SURFACE, { BodyName: 'Sys 1 5' }));
    alerts.event(approach(5));
    expect(said).toEqual(['High gravity: Sys 1 5 is 3.1 g.']);
  });

  it('warns near a surface too, and after lifting off from a port', () => {
    const { alerts, said } = setup({ survey: () => survey });
    alerts.event(jump(1, 'Sys 1'));
    alerts.status(status(IN_SHIP | DOCKED | NEAR_SURFACE, { BodyName: 'Sys 1 5' }));
    expect(said).toEqual([]);
    alerts.status(status(IN_SHIP | NEAR_SURFACE, { BodyName: 'Sys 1 5' }));
    expect(said).toEqual(['High gravity: Sys 1 5 is 3.1 g.']);
  });

  it('follows the threshold', () => {
    const { alerts, said } = setup({
      survey: () => survey,
      flight: { high_gravity_threshold: 0.9 },
    });
    alerts.event(jump(1, 'Sys 1'));
    alerts.event(approach(6));
    expect(said).toEqual(['High gravity: Sys 1 6 is 0.9 g.']);
  });
});

describe('wording', () => {
  it('names stars as they are said', () => {
    expect(describeStar('N')).toBe('a neutron star');
    expect(describeStar('DAV')).toBe('a white dwarf');
    expect(describeStar('White Dwarf (DA) Star')).toBe('a white dwarf');
    expect(describeStar('T')).toBe('a brown dwarf');
    expect(describeStar('TTS')).toBe('a T Tauri star');
    expect(describeStar('WNC')).toBe('a Wolf-Rayet star');
    expect(describeStar('CN')).toBe('a carbon star');
    expect(describeStar('Black Hole')).toBe('a black hole');
    expect(describeStar('Supermassive Black Hole')).toBe('a black hole');
    expect(describeStar('X')).toBe('a class X star');
  });

  it('writes each line', () => {
    expect(lowFuelLine(0.184, undefined)).toBe(
      'Fuel at 18%. No scoopable star known within 200 light years.',
    );
    expect(nextJumpLine('Sys', 'N', undefined)).toBe(
      'Next jump, Sys, has no scoopable star: a neutron star.',
    );
    expect(gravityLine('Body', 2.54)).toBe('High gravity: Body is 2.5 g.');
  });
});

describe('the Spansh search', () => {
  it('asks for the nearest scoopable main star', () => {
    const search = scoopableStarSearch({ x: 1, y: 2, z: 3 });
    expect(search).toMatchObject({
      filters: { is_main_star: { value: true }, distance: { min: '0', max: '200' } },
      sort: [{ distance: { direction: 'asc' } }],
      size: 1,
      reference_coords: { x: 1, y: 2, z: 3 },
    });
  });

  it('reads the first row', () => {
    expect(
      readNearestStar({ results: [{ system_name: 'Pru Aihm SI-I b10-6', distance: 5.47 }] }),
    ).toEqual({ system: 'Pru Aihm SI-I b10-6', distanceLy: 5.47 });
    expect(readNearestStar({ results: [] })).toBeUndefined();
    expect(readNearestStar('nonsense')).toBeUndefined();
  });
});

function optionsOf(said: string[]): FlightAlertOptions {
  return {
    settings: () => DEFAULT_SETTINGS.flight_alerts,
    routes: () => [],
    survey: () => undefined,
    primaryStar: async () => undefined,
    nearestScoopable: async () => ({ system: 'Nearby', distanceLy: 1 }),
    notify: (text) => said.push(text),
  };
}

describe('fuel for the stretch ahead', () => {
  const drive = logged({
    event: 'Loadout',
    UnladenMass: 300,
    FuelCapacity: { Main: 32, Reserve: 0.5 },
    Modules: [{ Slot: 'FrameShiftDrive', Item: 'int_hyperdrive_size5_class5' }],
  });
  // 20 ly apart: about 0.85 t a jump on a near-empty tank.
  const system = (address: number, starClass: string): RouteSystem => ({
    ...routeSystem(address, starClass),
    StarPos: [address * 20, 0, 0],
  });
  const route: PlottedRoute = {
    id: 1,
    plottedAt: '2026-09-26T00:00:00Z',
    systems: [system(1, 'K'), system(2, 'L'), system(3, 'T'), system(4, 'G')],
  };
  const arrive = logged({
    event: 'Location',
    StarSystem: 'Sys 1',
    SystemAddress: 1,
    StarPos: [20, 0, 0],
  });
  const target = logged({ event: 'FSDTarget', Name: 'Sys 2', SystemAddress: 2, StarClass: 'L' });

  function flying(tank: number, flags = IN_SHIP) {
    const context = setup({ routes: () => [route], flight: { low_fuel: false } });
    context.alerts.event(drive);
    context.alerts.event(arrive);
    context.alerts.status(fuel(tank, flags));
    return context;
  }

  it('warns once, in place of the unscoopable next jump', () => {
    const { alerts, said } = flying(1);
    alerts.event(target);
    alerts.event(target);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(
      /^Not enough fuel to reach a scoopable star: none for 3 jumps, until Sys 4\. That takes about 2\.\d tonnes, and the tank has 1\.0\. Fill up here first\.$/,
    );
  });

  it('stays quiet when the tank will last', () => {
    const { alerts, said } = flying(10);
    alerts.event(target);
    expect(said).toEqual(['Next jump, Sys 2, has no scoopable star: a brown dwarf. Fuel at 31%.']);
  });

  it('waits for scooping to end, and looks at the tank then', () => {
    const { alerts, said } = flying(1, IN_SHIP | SCOOPING);
    alerts.event(target);
    expect(said).toEqual(['Next jump, Sys 2, has no scoopable star: a brown dwarf. Fuel at 3%.']);
    alerts.status(fuel(1.5));
    expect(said).toHaveLength(2);
    expect(said[1]).toMatch(/^Not enough fuel .* the tank has 1\.5\./);
  });
});
