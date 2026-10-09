import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { PinnedPlan, ShoppingItem } from '../../shared/commodities';
import { transaction } from './database';

/** The Commodities tab's shopping list, in its order. Ids are the window's, so aren't kept. */
export class ShoppingListStore {
  readonly #db: DatabaseSync;
  readonly #all: StatementSync;
  readonly #clear: StatementSync;
  readonly #insert: StatementSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#all = db.prepare('SELECT commodity, needed, bought FROM shopping_item ORDER BY position');
    this.#clear = db.prepare('DELETE FROM shopping_item');
    this.#insert = db.prepare(
      'INSERT INTO shopping_item (position, commodity, needed, bought) VALUES (?, ?, ?, ?)',
    );
  }

  load(): Omit<ShoppingItem, 'id'>[] {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- this store's own STRICT table
    const rows = this.#all.all() as Omit<ShoppingItem, 'id'>[];
    return rows.map(({ commodity, needed, bought }) => ({ commodity, needed, bought }));
  }

  save(items: readonly ShoppingItem[]): void {
    transaction(this.#db, () => {
      this.#clear.run();
      for (const [position, item] of items.entries()) {
        this.#insert.run(position, item.commodity, item.needed, item.bought);
      }
    });
  }
}

/** The plan pinned on the Commodities tab's Plan page, as JSON. */
export class PinnedPlanStore {
  readonly #get: StatementSync;
  readonly #save: StatementSync;
  readonly #clear: StatementSync;

  constructor(db: DatabaseSync) {
    this.#get = db.prepare('SELECT plan FROM pinned_plan WHERE id = 1');
    this.#save = db.prepare(
      `INSERT INTO pinned_plan (id, plan) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET plan = excluded.plan`,
    );
    this.#clear = db.prepare('DELETE FROM pinned_plan');
  }

  load(): PinnedPlan | undefined {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- this store's own STRICT table
    const row = this.#get.get() as { plan: string } | undefined;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by save() below
    return row ? (JSON.parse(row.plan) as PinnedPlan) : undefined;
  }

  save(pinned: PinnedPlan): void {
    this.#save.run(JSON.stringify(pinned));
  }

  clear(): void {
    this.#clear.run();
  }
}
