import { describe, expect, it } from 'vitest';

import type { RouteSystem } from '../shared/nav-routes';
import { checkRouteOnEdsm, routeEdsmCallout } from './route-edsm';

function system(name: string, address: number | bigint): RouteSystem {
  return { StarSystem: name, SystemAddress: address, StarPos: [0, 0, 0], StarClass: 'K' };
}

const route = [system('Start', 1), system('B', 2), system('C', 3), system('End', 4)];

describe('checkRouteOnEdsm', () => {
  it('lists the systems EDSM gave no id for', async () => {
    const edsm = { knownSystems: async () => new Set(['1', '3', '144115188075855873']) };
    const systems = [...route, system('Far', 144115188075855873n)];
    expect(await checkRouteOnEdsm(edsm, systems)).toEqual({
      status: 'checked',
      unknown: ['2', '4'],
    });
  });
});

describe('routeEdsmCallout', () => {
  const said = (...unknown: string[]) => routeEdsmCallout(route, { status: 'checked', unknown });

  it("counts the jumps' systems, not the one the ship is in", () => {
    expect(said('1')).toBe('Route plotted, 3 jumps. Every system on it is in EDSM.');
    expect(said('1', '2', '3', '4')).toBe('Route plotted, 3 jumps. EDSM knows none of them.');
    expect(said('2')).toBe("Route plotted, 3 jumps. One of them isn't in EDSM.");
    expect(said('2', '4')).toBe(
      "Route plotted, 3 jumps. 2 of them aren't in EDSM, the destination among them.",
    );
  });

  it('names the system of a single jump', () => {
    const hop = route.slice(0, 2);
    expect(routeEdsmCallout(hop, { status: 'checked', unknown: ['2'] })).toBe(
      "Route plotted, one jump. B isn't in EDSM.",
    );
    expect(routeEdsmCallout(hop, { status: 'checked', unknown: [] })).toBe(
      'Route plotted, one jump. B is in EDSM.',
    );
  });

  it('says nothing without an answer', () => {
    expect(routeEdsmCallout(route, { status: 'failed' })).toBeUndefined();
    expect(routeEdsmCallout(route.slice(0, 1), { status: 'checked', unknown: [] })).toBeUndefined();
  });
});
