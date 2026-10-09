// oxlint-disable typescript/no-unsafe-type-assertion -- rows come from this store's own STRICT
// tables, so their shapes are known; node:sqlite only types them as generic records.
import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { PlottedRoute, RouteSystem } from '../../shared/nav-routes';
import { transaction } from './database';

interface RouteRow {
  id: number;
  plotted_at: string;
  cleared_at: string | null;
}

/** Read with `setReadBigInts`, so 64-bit addresses come back intact. */
interface SystemRow {
  system_address: bigint;
  name: string;
  x: number;
  y: number;
  z: number;
  star_class: string;
}

const ROUTE_COLUMNS = 'id, plotted_at, cleared_at';

/** Every route the player plotted, kept forever: the game only ever holds the current one. */
export class NavRouteStore {
  readonly #db: DatabaseSync;
  readonly #insertRoute: StatementSync;
  readonly #routeAt: StatementSync;
  readonly #latestBy: StatementSync;
  readonly #latestBefore: StatementSync;
  readonly #latest: StatementSync;
  readonly #after: StatementSync;
  readonly #clear: StatementSync;
  readonly #hasSystems: StatementSync;
  readonly #insertSystem: StatementSync;
  readonly #systems: StatementSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#insertRoute = db.prepare(
      'INSERT INTO nav_route (plotted_at) VALUES (?) ON CONFLICT (plotted_at) DO NOTHING',
    );
    this.#routeAt = db.prepare(`SELECT ${ROUTE_COLUMNS} FROM nav_route WHERE plotted_at = ?`);
    this.#latestBy = db.prepare(
      `SELECT ${ROUTE_COLUMNS} FROM nav_route WHERE plotted_at <= ? ORDER BY plotted_at DESC LIMIT 1`,
    );
    this.#latestBefore = db.prepare(
      `SELECT ${ROUTE_COLUMNS} FROM nav_route WHERE plotted_at < ? ORDER BY plotted_at DESC LIMIT 1`,
    );
    this.#latest = db.prepare(
      `SELECT ${ROUTE_COLUMNS} FROM nav_route ORDER BY plotted_at DESC LIMIT 1`,
    );
    this.#after = db.prepare(
      `SELECT ${ROUTE_COLUMNS} FROM nav_route WHERE plotted_at > ? ORDER BY plotted_at`,
    );
    this.#clear = db.prepare('UPDATE nav_route SET cleared_at = ? WHERE id = ?');
    this.#hasSystems = db.prepare('SELECT 1 FROM nav_route_system WHERE route_id = ? LIMIT 1');
    this.#insertSystem = db.prepare(
      `INSERT INTO nav_route_system (route_id, position, system_address, name, x, y, z, star_class)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.#systems = db.prepare(
      `SELECT system_address, name, x, y, z, star_class FROM nav_route_system
       WHERE route_id = ? ORDER BY position`,
    );
    this.#systems.setReadBigInts(true);
  }

  /**
   * Records a route plotted at `plottedAt`, with its systems if known. The journal's NavRoute line
   * only says that a route was plotted; NavRoute.json, which has the same timestamp, lists the
   * systems. Either may come first, and both are seen again on every start.
   *
   * Returns the route if this told the store something new. Throws, keeping nothing, if a system
   * is malformed (payloads aren't validated before they get here).
   */
  recordRoute(plottedAt: string, systems: readonly RouteSystem[] = []): PlottedRoute | undefined {
    return transaction(this.#db, () => {
      const inserted = Number(this.#insertRoute.run(plottedAt).changes) > 0;
      const row = this.#routeAt.get(plottedAt) as unknown as RouteRow;
      const addSystems = systems.length > 0 && this.#hasSystems.get(row.id) === undefined;
      if (addSystems) {
        for (const [position, system] of systems.entries()) {
          const [x, y, z] = system.StarPos;
          this.#insertSystem.run(
            row.id,
            position,
            system.SystemAddress,
            system.StarSystem,
            x,
            y,
            z,
            system.StarClass,
          );
        }
      }
      return inserted || addSystems ? this.#load(row) : undefined;
    });
  }

  /**
   * Records that the route in effect at `clearedAt` was cleared: on arrival, or by the player.
   * Returns the route if it wasn't already known to be cleared. With `plottedBefore`, a route
   * plotted at that very moment is left alone.
   */
  recordCleared(clearedAt: string, { plottedBefore = false } = {}): PlottedRoute | undefined {
    const row = (plottedBefore ? this.#latestBefore : this.#latestBy).get(clearedAt) as
      | RouteRow
      | undefined;
    if (!row || row.cleared_at !== null) return undefined;
    this.#clear.run(clearedAt, row.id);
    return this.#load({ ...row, cleared_at: clearedAt });
  }

  /**
   * The route in effect at `since` and every route plotted after it, oldest first. Without
   * `since`, just the latest route.
   */
  routesSince(since: string | undefined): PlottedRoute[] {
    const first = (since === undefined ? this.#latest.get() : this.#latestBy.get(since)) as
      | RouteRow
      | undefined;
    const later = since === undefined ? [] : (this.#after.all(since) as unknown as RouteRow[]);
    return [...(first ? [first] : []), ...later].map((row) => this.#load(row));
  }

  #load(row: RouteRow): PlottedRoute {
    const systems = (this.#systems.all(row.id) as unknown as SystemRow[]).map(
      (system): RouteSystem => ({
        StarSystem: system.name,
        SystemAddress: fromSqlInteger(system.system_address),
        StarPos: [system.x, system.y, system.z],
        StarClass: system.star_class,
      }),
    );
    return {
      id: row.id,
      plottedAt: row.plotted_at,
      ...(row.cleared_at !== null && { clearedAt: row.cleared_at }),
      ...(systems.length > 0 && { systems }),
    };
  }
}

/** Like parse.ts: a number when it fits safely, else a bigint. */
function fromSqlInteger(value: bigint): number | bigint {
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value;
}
