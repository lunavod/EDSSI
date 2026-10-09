/**
 * EDSY's slot tables, fetched from EDSY's repository and kept on disk, so a new ship shows its
 * empty slots as soon as EDSY lists it, with no EDSSI release. Offline, the last copy fetched is
 * used; with none, the Ships tab shows only what the journal has.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CatalogStatus, ShipCatalog } from '../../shared/ships';
import { USER_AGENT } from '../edsm';
import { catalogFromEdsySource, EDSY_DATABASE_URL } from './edsy';

/** How often EDSY is asked for a newer database. */
export const REFRESH_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_MS = 60_000;
/** Bump when `ShipCatalog` changes shape, so an older cache is fetched afresh. */
const FORMAT = 3;
const CACHE_FILE = 'edsy-catalog.json';

interface CacheFile {
  format: number;
  fetchedAt: string;
  etag?: string;
  catalog: ShipCatalog;
}

export interface ShipCatalogSource {
  current(): ShipCatalog | undefined;
  status(): CatalogStatus;
  onChange(listener: () => void): void;
  /** Asks EDSY for a newer database now. */
  refresh(): Promise<void>;
  stop(): void;
}

export interface ShipCatalogOptions {
  /** Where the cache lives. */
  dir: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export function startShipCatalog(options: ShipCatalogOptions): ShipCatalogSource {
  const fetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const path = join(options.dir, CACHE_FILE);
  const listeners: (() => void)[] = [];
  let cache: CacheFile | undefined;
  let error: string | undefined;
  let loading = true;
  let refreshing: Promise<void> | undefined;
  let stopped = false;

  const changed = () => {
    for (const listener of listeners) listener();
  };

  const refresh = (): Promise<void> =>
    (refreshing ??= fetchNewer().finally(() => {
      refreshing = undefined;
    }));

  async function fetchNewer(): Promise<void> {
    try {
      const response = await fetch(EDSY_DATABASE_URL, {
        headers: {
          'User-Agent': USER_AGENT,
          ...(cache?.etag !== undefined && { 'If-None-Match': cache.etag }),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 304 && cache) {
        cache = { ...cache, fetchedAt: new Date(now()).toISOString() };
      } else if (response.ok) {
        const catalog = catalogFromEdsySource(await response.text());
        const etag = response.headers.get('etag') ?? undefined;
        cache = {
          format: FORMAT,
          fetchedAt: new Date(now()).toISOString(),
          ...(etag !== undefined && { etag }),
          catalog,
        };
      } else {
        throw new Error(`EDSY answered ${response.status}`);
      }
      error = undefined;
      await save(path, cache);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      console.error('[ships] failed to fetch EDSY database', caught);
    } finally {
      loading = false;
      if (!stopped) changed();
    }
  }

  void (async () => {
    cache = await load(path);
    if (stopped) return;
    if (cache) {
      loading = false;
      changed();
    }
    if (!cache || now() - Date.parse(cache.fetchedAt) >= REFRESH_MS) await refresh();
  })();
  const timer = setInterval(() => void refresh(), REFRESH_MS);
  timer.unref();

  return {
    current: () => cache?.catalog,
    status: () => ({
      state: cache ? 'ready' : loading ? 'loading' : 'failed',
      ...(cache && { fetchedAt: cache.fetchedAt }),
      ...(cache?.catalog.modified !== undefined && { modified: cache.catalog.modified }),
      ...(error !== undefined && { error }),
    }),
    onChange: (listener) => void listeners.push(listener),
    refresh,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function load(path: string): Promise<CacheFile | undefined> {
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our own file, checked below
    const file = JSON.parse(await readFile(path, 'utf8')) as Partial<CacheFile>;
    if (file.format !== FORMAT || typeof file.fetchedAt !== 'string' || !file.catalog) {
      return undefined;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fields that matter are checked
    return file as CacheFile;
  } catch {
    return undefined;
  }
}

async function save(path: string, cache: CacheFile): Promise<void> {
  try {
    await mkdir(join(path, '..'), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(cache));
    await rename(temporary, path);
  } catch (error) {
    console.error('[ships] failed to save EDSY database', error);
  }
}
