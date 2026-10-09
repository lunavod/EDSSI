import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { CsvRoute, SavedRouteSummary } from '../../shared/csv-route';

/**
 * Routes the commander saved under a name, to switch between on the Route tab: a carrier's long
 * trip put aside for a survey of one stop, say, and taken up again after. Each keeps how far along
 * it the commander had got.
 */
export class SavedRouteStore {
  readonly #list: StatementSync;
  readonly #get: StatementSync;
  readonly #save: StatementSync;
  readonly #update: StatementSync;
  readonly #rename: StatementSync;
  readonly #delete: StatementSync;

  constructor(db: DatabaseSync) {
    this.#list = db.prepare(
      `SELECT id, name, json_extract(route, '$.fileName') AS file_name,
         json_array_length(route, '$.systems') AS systems, position, saved_at
       FROM saved_route ORDER BY id`,
    );
    this.#get = db.prepare('SELECT route, position FROM saved_route WHERE id = ?');
    this.#save = db.prepare(
      `INSERT INTO saved_route (name, route, position, saved_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET
         route = excluded.route, position = excluded.position, saved_at = excluded.saved_at
       RETURNING id`,
    );
    this.#update = db.prepare('UPDATE saved_route SET route = ?, position = ? WHERE id = ?');
    this.#rename = db.prepare('UPDATE saved_route SET name = ? WHERE id = ?');
    this.#delete = db.prepare('DELETE FROM saved_route WHERE id = ?');
  }

  list(): SavedRouteSummary[] {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- this store's own STRICT table
    const rows = this.#list.all() as {
      id: number;
      name: string;
      file_name: string | null;
      systems: number | null;
      position: number | null;
      saved_at: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      fileName: row.file_name ?? '',
      systems: row.systems ?? 0,
      ...(row.position !== null && { position: row.position }),
      savedAt: row.saved_at,
    }));
  }

  get(id: number): { route: CsvRoute; position: number | undefined } | undefined {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- this store's own STRICT table
    const row = this.#get.get(id) as { route: string; position: number | null } | undefined;
    if (!row) return undefined;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by save() below
    const route = JSON.parse(row.route) as CsvRoute;
    return { route, position: row.position ?? undefined };
  }

  /** Saves a route under a name, over any saved under that name already. Answers its id. */
  save(name: string, route: CsvRoute, position: number | undefined, savedAt: string): number {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- RETURNING id, always a row
    const row = this.#save.get(name, stored(route), position ?? null, savedAt) as { id: number };
    return row.id;
  }

  /** Keeps a saved route up to date as it is followed. */
  update(id: number, route: CsvRoute, position: number | undefined): void {
    this.#update.run(stored(route), position ?? null, id);
  }

  /** Answers false when another route already has the name. */
  rename(id: number, name: string): boolean {
    try {
      this.#rename.run(name, id);
      return true;
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) return false;
      throw error;
    }
  }

  delete(id: number): void {
    this.#delete.run(id);
  }
}

/** The id is the row's own; it goes back on when the route is loaded. */
function stored(route: CsvRoute): string {
  const { savedId: _, ...rest } = route;
  return JSON.stringify(rest);
}
