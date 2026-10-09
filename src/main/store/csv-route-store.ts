import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { CsvRoute } from '../../shared/csv-route';

/** The one CSV route loaded on the Route tab, and how far along it the commander has got. */
export class CsvRouteStore {
  readonly #get: StatementSync;
  readonly #save: StatementSync;
  readonly #position: StatementSync;
  readonly #clear: StatementSync;

  constructor(db: DatabaseSync) {
    this.#get = db.prepare('SELECT route, position FROM csv_route WHERE id = 1');
    this.#save = db.prepare(
      `INSERT INTO csv_route (id, route, position) VALUES (1, ?, ?)
       ON CONFLICT (id) DO UPDATE SET route = excluded.route, position = excluded.position`,
    );
    this.#position = db.prepare('UPDATE csv_route SET position = ? WHERE id = 1');
    this.#clear = db.prepare('DELETE FROM csv_route');
  }

  load(): { route: CsvRoute; position: number | undefined } | undefined {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- this store's own STRICT table
    const row = this.#get.get() as { route: string; position: number | null } | undefined;
    if (!row) return undefined;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by save() below
    const route = JSON.parse(row.route) as CsvRoute;
    return { route, position: row.position ?? undefined };
  }

  save(route: CsvRoute, position: number | undefined): void {
    this.#save.run(JSON.stringify(route), position ?? null);
  }

  setPosition(position: number | undefined): void {
    this.#position.run(position ?? null);
  }

  clear(): void {
    this.#clear.run();
  }
}
