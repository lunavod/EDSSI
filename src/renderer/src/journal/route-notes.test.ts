import { describe, expect, it } from 'vitest';

import type { JournalEvent } from '../../../shared/journal';
import type { PlottedRoute, RouteSystem } from '../../../shared/nav-routes';
import { formatNumber } from './format';
import { routeNote, starNote } from './route-notes';

function system(name: string, address: number, x: number): RouteSystem {
  return { StarSystem: name, SystemAddress: address, StarPos: [x, 0, 0], StarClass: 'K' };
}

const route: PlottedRoute = {
  id: 1,
  plottedAt: '2026-09-10T20:55:41Z',
  systems: [system('Arque', 1, 0), system('Wyrd', 2, 12.5), system('Komovoy', 3, 30)],
};

function jumpTo(address: number, timestamp = '2026-09-10T20:57:17Z'): JournalEvent {
  return { timestamp, event: 'FSDJump', SystemAddress: address } as JournalEvent;
}

describe('routeNote', () => {
  it('describes the route a NavRoute line announced', () => {
    const plotted: JournalEvent = { timestamp: route.plottedAt, event: 'NavRoute' };
    expect(routeNote(plotted, [route])).toBe(`2 jumps to Komovoy · ${formatNumber(30, 1)} ly`);
    expect(routeNote({ ...plotted, timestamp: '2026-09-10T21:00:00Z' }, [route])).toBeUndefined();
  });

  it("places a jump on the route, or says it's off it", () => {
    expect(routeNote(jumpTo(2), [route])).toBe('jump 1 of 2');
    expect(routeNote(jumpTo(3), [route])).toBe('jump 2 of 2');
    expect(routeNote(jumpTo(99), [route])).toBe('off route');
  });

  it('says nothing without a route, or when its systems are unknown', () => {
    expect(routeNote(jumpTo(2, '2026-09-10T20:00:00Z'), [route])).toBeUndefined();
    const unknown: PlottedRoute = { id: 2, plottedAt: route.plottedAt };
    expect(routeNote(jumpTo(2), [unknown])).toBeUndefined();
  });
});

describe('starNote', () => {
  it.each([
    ['K', 'scoopable'],
    ['M_RedGiant', 'scoopable'],
    ['N', 'neutron star'],
    ['DA', 'white dwarf'],
    ['TTS', undefined],
    ['L', undefined],
  ])('%s → %s', (starClass, note) => {
    expect(starNote(starClass)).toBe(note);
  });
});
