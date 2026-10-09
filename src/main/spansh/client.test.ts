import { describe, expect, it, vi } from 'vitest';

import { formBody, SpanshClient, SpanshError } from './client';

/** A fetch that answers each request with the next of `bodies`, as raw JSON text. */
function scripted(...bodies: string[]) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const body = bodies.shift() ?? '{}';
    return new Response(body, { status: body.includes('"error"') ? 400 : 200 });
  });
}

describe('formBody', () => {
  it('repeats keys for arrays and writes booleans as 1 and 0, like jQuery', () => {
    expect(
      formBody({ source: 'Sol', destination: ['A', 'B'], loop: false, via: undefined }).toString(),
    ).toBe('source=Sol&destination=A&destination=B&loop=0');
  });
});

describe('SpanshClient', () => {
  it('keeps 64-bit ids exact', async () => {
    const fetch = scripted(
      '{"results":[{"id64":36028807496337770123,"name":"Big","x":1,"y":2,"z":3}]}',
    );
    const client = new SpanshClient({ fetch });
    expect(await client.system('big')).toEqual({
      id64: '36028807496337770123',
      name: 'Big',
      x: 1,
      y: 2,
      z: 3,
    });
  });

  it("turns Spansh's own errors into words", async () => {
    const client = new SpanshClient({
      fetch: scripted('{"error":"Could not find starting system"}', '{"error":"Invalid request"}'),
    });
    await expect(client.plot('/route', { from: 'Nowhere' })).rejects.toThrow(
      new SpanshError('Spansh: Could not find starting system'),
    );
    await expect(client.search('stations', {})).rejects.toThrow(/reference system/);
  });

  it('sends plotters a form and the engineer plotter JSON', async () => {
    const fetch = scripted('{"job":"A","status":"queued"}', '{"job":"B","status":"queued"}');
    const client = new SpanshClient({ fetch });
    await client.plot('/tourist/route', { destination: ['A', 'B'] });
    await client.plot('/engineer/route', { blueprints: [] }, { json: true });

    const [form, json] = fetch.mock.calls.map(([, init]) => init!) as [RequestInit, RequestInit];
    expect(form.body).toBe('destination=A&destination=B');
    expect(form.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(json.body).toBe('{"blueprints":[]}');
  });

  it('polls a route, backing off, until it is done', async () => {
    let now = 0;
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });
    const client = new SpanshClient({
      fetch: scripted(
        '{"status":"queued","state":"queued"}',
        '{"status":"queued","state":"started"}',
        '{"status":"ok","job":"J","result":[]}',
      ),
      now: () => now,
      sleep,
    });
    const state = await client.waitForRoute('J', 60_000);
    expect(state).toMatchObject({ done: true, route: { job: 'J' } });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
  });

  it('gives up waiting after the time allowed, leaving the job to check later', async () => {
    let now = 0;
    const client = new SpanshClient({
      fetch: scripted(...Array.from({ length: 10 }, () => '{"status":"queued","state":"started"}')),
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    expect(await client.waitForRoute('J', 5000)).toEqual({
      done: false,
      job: 'J',
      state: 'started',
    });
  });

  it('fetches field lists once', async () => {
    const fetch = scripted('{"fields":[{"field":"type","type":"group"}]}');
    const client = new SpanshClient({ fetch });
    await client.searchableFields('stations');
    expect(await client.searchableFields('stations')).toEqual([{ field: 'type', type: 'group' }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
