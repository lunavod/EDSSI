/**
 * Spansh (spansh.co.uk): searches over every known station, system and body, and its route
 * plotters. There is no documented API; this is what the site itself calls, found in its bundle
 * and checked against the live server (see docs/unverified.md). Searches answer at once; a route
 * is a job that is queued, then polled until it is done.
 */

import { USER_AGENT } from '../edsm';
import { parseJournalJson } from '../journal/parse';

export const SPANSH_BASE_URL = 'https://spansh.co.uk/api';

export type SearchKind = 'stations' | 'systems' | 'bodies';

export type Coords = { x: number; y: number; z: number };

/** One field a search can filter on, as `/api/<kind>/searchable_fields` describes it. */
export interface SearchableField {
  field: string;
  /** `group`, `string`, `numeric`, `boolean`, `timestamp`, `keyword`, `combined`, `value_struct`, `special`. */
  type: string;
  subtype?: string;
  /** For `combined` fields: the parts of one item, e.g. a module's name, class and rating. */
  subfields?: Record<string, { type: string; subtype?: string }>;
  /** For `value_struct` fields: what names the item, and the number it carries. */
  subfield?: { name: string; type: string };
  valuefield?: { name: string; type: string; subtype?: string };
}

/** A route job that has finished. `result` is the plotter's own shape. */
export interface RouteResult {
  job: string;
  status: 'ok';
  parameters?: Record<string, unknown>;
  result: unknown;
}

export type RouteState =
  | { done: true; route: RouteResult }
  | { done: false; job: string; state?: string };

/** Spansh said no, in words the commander can be told. */
export class SpanshError extends Error {}

/** Field lists and value lists change when Spansh adds a field, not from one question to the next. */
const REFERENCE_FRESH_MS = 6 * 60 * 60_000;
const POLL_FIRST_MS = 1000;
const POLL_MAX_MS = 5000;

export interface SpanshClientOptions {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export class SpanshClient {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #reference = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(options: SpanshClientOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? sleep;
  }

  /** Every field a search of this kind can filter on. */
  async searchableFields(kind: SearchKind, signal?: AbortSignal): Promise<SearchableField[]> {
    const body = await this.#cached(`/${kind}/searchable_fields`, signal);
    const fields = field(body, 'fields');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Spansh's own field list
    return Array.isArray(fields) ? (fields as SearchableField[]) : [];
  }

  /**
   * The values a field takes, with how many records have each (or each number's range). A combined
   * field answers per part, e.g. `{ values: { name: [...] } }` for ships.
   */
  fieldValues(kind: SearchKind, name: string, signal?: AbortSignal): Promise<unknown> {
    return this.#cached(`/${kind}/field_values/${encodeURIComponent(name)}`, signal);
  }

  /** A search, with the body the site sends: `filters`, `sort`, `size`, `page` and a reference. */
  search(kind: SearchKind, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.#request(`/${kind}/search`, { method: 'POST', json: body, signal });
  }

  /** The known system closest to a point. */
  nearest(coords: Coords, signal?: AbortSignal): Promise<unknown> {
    const query = new URLSearchParams({
      x: String(coords.x),
      y: String(coords.y),
      z: String(coords.z),
    });
    return this.#request(`/nearest?${query.toString()}`, { signal });
  }

  /** Systems whose names start like `name`, best match first. */
  async systemsNamed(name: string, signal?: AbortSignal): Promise<SystemMatch[]> {
    const body = await this.#request(
      `/search/systems?${new URLSearchParams({ q: name }).toString()}`,
      {
        signal,
      },
    );
    const results = field(body, 'results');
    if (!Array.isArray(results)) return [];
    return results.flatMap((result: unknown) => {
      const id64 = field(result, 'id64');
      const found = field(result, 'name');
      if (typeof found !== 'string' || !['number', 'bigint', 'string'].includes(typeof id64)) {
        return [];
      }
      return [
        {
          id64: String(id64),
          name: found,
          x: Number(field(result, 'x')),
          y: Number(field(result, 'y')),
          z: Number(field(result, 'z')),
        },
      ];
    });
  }

  /** The system spelled exactly `name` (case aside), or undefined. */
  async system(name: string, signal?: AbortSignal): Promise<SystemMatch | undefined> {
    const matches = await this.systemsNamed(name, signal);
    return matches.find((match) => match.name.toLowerCase() === name.trim().toLowerCase());
  }

  /** One record by id: `system` and `body` take an id64, `station` a market id. */
  async record(
    kind: 'system' | 'body' | 'station',
    id: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const body = await this.#request(`/${kind}/${encodeURIComponent(id)}`, { signal });
    return field(body, 'record');
  }

  /**
   * Queues a route. Most plotters take a form, the way the site's jQuery sends it (arrays as
   * repeated keys); the engineer plotter takes JSON.
   */
  async plot(
    path: string,
    params: Record<string, unknown>,
    options: { json?: boolean; signal?: AbortSignal } = {},
  ): Promise<string> {
    const body = options.json
      ? await this.#request(path, { method: 'POST', json: params, signal: options.signal })
      : await this.#request(path, { method: 'POST', form: params, signal: options.signal });
    const job = field(body, 'job');
    if (typeof job !== 'string') {
      throw new SpanshError('Spansh did not queue the route.');
    }
    return job;
  }

  /** Where a route job is: finished, or still queued or running. */
  async routeState(job: string, signal?: AbortSignal): Promise<RouteState> {
    const body = await this.#request(`/results/${encodeURIComponent(job)}`, { signal });
    const status = field(body, 'status');
    if (status === 'ok') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked `status` above
      return { done: true, route: body as RouteResult };
    }
    if (status === 'queued') {
      const state = field(body, 'state');
      return { done: false, job, state: typeof state === 'string' ? state : undefined };
    }
    throw new SpanshError(`The route job ended as "${JSON.stringify(status)}".`);
  }

  /** Polls a job, backing off, until it is done or `waitMs` has gone by. */
  async waitForRoute(job: string, waitMs: number, signal?: AbortSignal): Promise<RouteState> {
    const until = this.#now() + waitMs;
    let delay = POLL_FIRST_MS;
    for (;;) {
      const state = await this.routeState(job, signal);
      if (state.done || this.#now() + delay > until) return state;
      await this.#sleep(delay, signal);
      delay = Math.min(delay * 2, POLL_MAX_MS);
    }
  }

  #cached(path: string, signal?: AbortSignal): Promise<unknown> {
    const hit = this.#reference.get(path);
    if (hit && this.#now() - hit.at < REFERENCE_FRESH_MS) return hit.value;
    const value = this.#request(path, { signal });
    this.#reference.set(path, { at: this.#now(), value });
    value.catch(() => this.#reference.delete(path));
    return value;
  }

  async #request(
    path: string,
    options: {
      method?: 'GET' | 'POST';
      json?: unknown;
      form?: Record<string, unknown>;
      signal?: AbortSignal;
    },
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    };
    let body: string | undefined;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = formBody(options.form).toString();
    }
    const response = await this.#fetch(`${SPANSH_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: options.signal,
    });
    let parsed: unknown;
    try {
      // Body and some system id64s don't fit a double.
      parsed = parseJournalJson(await response.text());
    } catch {
      throw new Error(`Spansh answered ${response.status} with something other than JSON`);
    }
    const error = field(parsed, 'error');
    if (typeof error === 'string') throw new SpanshError(spanshMessage(error));
    if (!response.ok) throw new Error(`Spansh answered ${response.status} for ${path}`);
    return parsed;
  }
}

export interface SystemMatch {
  id64: string;
  name: string;
  x: number;
  y: number;
  z: number;
}

/** A form the way jQuery's `traditional` mode builds it: arrays as repeated keys, no brackets. */
export function formBody(params: Record<string, unknown>): URLSearchParams {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      form.append(key, typeof item === 'boolean' ? (item ? '1' : '0') : String(item));
    }
  }
  return form;
}

/** Spansh's errors are terse; the common ones get a word of what to do. */
function spanshMessage(error: string): string {
  if (error === 'Invalid request') {
    return 'Spansh rejected the request (often a reference system it does not know).';
  }
  return `Spansh: ${error}`;
}

/** A property of a JSON object, or undefined if `value` isn't one. */
export function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
