import { describe, expect, it, vi } from 'vitest';

import { EdsmClient } from './edsm';

const SOL: Record<string, unknown> = {
  '/api-system-v1/traffic': { name: 'Sol', traffic: { total: 28333, week: 198, day: 41 } },
  '/api-system-v1/deaths': { name: 'Sol', deaths: { total: 6843, week: 5, day: 2 } },
  '/api-system-v1/stations': {
    name: 'Sol',
    stations: [
      { name: 'Galileo', type: 'Ocellus Starport', distanceToArrival: 507 },
      { name: 'X7J-00K', type: 'Fleet Carrier', distanceToArrival: 5 },
      { name: 'Furukawa Enterprise', type: 'Planetary Outpost', distanceToArrival: 193 },
    ],
  },
  '/api-v1/system': {
    name: 'Sol',
    primaryStar: { type: 'G (White-Yellow) Star', isScoopable: true },
  },
};

/** A fetch that answers from `routes` by path, counting calls. */
function fakeFetch(routes: Record<string, unknown>, status = 200) {
  return vi.fn(async (url: string | URL | Request) => {
    const path = new URL(url instanceof Request ? url.url : url).pathname;
    return new Response(JSON.stringify(routes[path] ?? {}), { status });
  });
}

describe('EdsmClient', () => {
  it('combines traffic, losses, stations and the primary star', async () => {
    const client = new EdsmClient({ fetch: fakeFetch(SOL) });
    expect(await client.system('Sol')).toEqual({
      name: 'Sol',
      status: 'ok',
      traffic: { total: 28333, week: 198, day: 41 },
      deaths: { total: 6843, week: 5, day: 2 },
      primaryStar: { type: 'G (White-Yellow) Star', scoopable: true },
      closestStarport: { name: 'Furukawa Enterprise', type: 'Planetary Outpost', distanceLs: 193 },
    });
  });

  it('says when EDSM has never heard of a system', async () => {
    const client = new EdsmClient({ fetch: fakeFetch({}) });
    expect(await client.system('Nowhere')).toEqual({ name: 'Nowhere', status: 'unknown' });
  });

  it('asks once per system for a while, and again after that', async () => {
    let now = 0;
    const fetch = fakeFetch(SOL);
    const client = new EdsmClient({ fetch, now: () => now });
    await Promise.all([client.system('Sol'), client.system('sol')]);
    expect(fetch).toHaveBeenCalledTimes(4);

    now += 10 * 60_000;
    await client.system('Sol');
    expect(fetch).toHaveBeenCalledTimes(4);

    now += 10 * 60_000;
    await client.system('Sol');
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  it('reports EDSM being unreachable, and retries sooner', async () => {
    let now = 0;
    const fetch = fakeFetch(SOL, 503);
    const client = new EdsmClient({ fetch, now: () => now });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await client.system('Sol')).toEqual({ name: 'Sol', status: 'unavailable' });

    now += 2 * 60_000;
    await client.system('Sol');
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  describe('knownSystems', () => {
    it('asks about many systems a few dozen at a time, keeping 64-bit ids exact', async () => {
      const names = Array.from({ length: 60 }, (_, index) => `System ${index}`);
      const urls: string[] = [];
      const fetch = vi.fn(async (url: string | URL | Request) => {
        urls.push(url instanceof Request ? url.url : url.toString());
        const query = new URL(urls.at(-1)!).searchParams;
        const asked = query.getAll('systemName[]');
        // Written out by hand: JSON.stringify would round the id64 before it got to the client.
        const body = asked.includes('System 0')
          ? '[{"name":"System 0","id":1,"id64":144115188075855873},{"name":"System 1","id":2,"id64":42}]'
          : asked.includes('System 59')
            ? '[{"name":"System 59","id":3,"id64":7}]'
            : '[]';
        return new Response(body);
      });
      const client = new EdsmClient({ fetch });
      expect(await client.knownSystems(names)).toEqual(new Set(['144115188075855873', '42', '7']));
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(urls[0]).toContain('/api-v1/systems?systemName[]=System%200&');
    });

    it('takes an empty answer for none known, and rejects when EDSM is down', async () => {
      expect(await new EdsmClient({ fetch: fakeFetch({}) }).knownSystems(['Nowhere'])).toEqual(
        new Set(),
      );
      await expect(
        new EdsmClient({ fetch: fakeFetch({}, 503) }).knownSystems(['Sol']),
      ).rejects.toThrow('503');
    });
  });
});
