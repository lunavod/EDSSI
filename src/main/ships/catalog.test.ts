import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REFRESH_MS, type ShipCatalogSource, startShipCatalog } from './catalog';

/** EDSY's database, just big enough to be taken for one. */
function eddbSource(version: number): string {
  const ship: Record<number, unknown> = {};
  for (let index = 0; index < 30; index++) {
    ship[index] = {
      fdname: `Ship${index}`,
      name: `Ship ${index}`,
      slots: { hardpoint: [1], utility: [], component: [1, 2, 2, 2, 1, 1, 1, 1], internal: [1] },
    };
  }
  return `var eddb = ${JSON.stringify({ version, ship, module: {} })};`;
}

/** Resolves once the tables are in, or the fetch has failed. */
const settled = (source: ShipCatalogSource) =>
  new Promise<void>((resolve) => {
    source.onChange(() => {
      if (source.status().state !== 'loading') resolve();
    });
  });

describe('startShipCatalog', () => {
  let dir: string;
  let catalog: ShipCatalogSource | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'edssi-ships-'));
  });
  afterEach(async () => {
    catalog?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('fetches EDSY once with no cache, and keeps what it got', async () => {
    const fetch = vi.fn(async () => new Response(eddbSource(7), { headers: { etag: '"abc"' } }));
    catalog = startShipCatalog({ dir, fetch, now: () => Date.parse('2026-09-29T10:00:00Z') });
    await settled(catalog);
    expect(catalog.status()).toMatchObject({
      state: 'ready',
      fetchedAt: '2026-09-29T10:00:00.000Z',
    });
    expect(catalog.current()?.version).toBe(7);
    const saved = JSON.parse(await readFile(join(dir, 'edsy-catalog.json'), 'utf8'));
    expect(saved.etag).toBe('"abc"');
  });

  it('uses a fresh cache without asking, and asks with its etag once it is stale', async () => {
    const first = vi.fn(async () => new Response(eddbSource(7), { headers: { etag: '"abc"' } }));
    catalog = startShipCatalog({ dir, fetch: first, now: () => 0 });
    await settled(catalog);
    catalog.stop();

    const fresh = vi.fn(async () => new Response('', { status: 500 }));
    catalog = startShipCatalog({ dir, fetch: fresh, now: () => REFRESH_MS - 1 });
    await settled(catalog);
    expect(fresh).not.toHaveBeenCalled();
    expect(catalog.current()?.version).toBe(7);
    catalog.stop();

    const stale = vi.fn(
      async (_url: unknown, _init?: RequestInit) => new Response(null, { status: 304 }),
    );
    catalog = startShipCatalog({ dir, fetch: stale, now: () => REFRESH_MS });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stale).toHaveBeenCalledOnce();
    expect(new Headers(stale.mock.calls[0]?.[1]?.headers).get('If-None-Match')).toBe('"abc"');
    expect(catalog.current()?.version).toBe(7);
  });

  it('says why when EDSY can’t be read, keeping any older tables', async () => {
    await writeFile(join(dir, 'edsy-catalog.json'), 'not json');
    const fetch = vi.fn(async () => new Response('var eddb = { ship: {} };'));
    catalog = startShipCatalog({ dir, fetch });
    await settled(catalog);
    expect(catalog.status()).toMatchObject({
      state: 'failed',
      error: 'EDSY database has no ships',
    });
    expect(catalog.current()).toBeUndefined();
  });
});
