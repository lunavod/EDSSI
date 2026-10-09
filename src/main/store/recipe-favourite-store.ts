import type { DatabaseSync, StatementSync } from 'node:sqlite';

/**
 * Recipes the commander marked or unmarked as favourites. Only their own choices are stored, so
 * the defaults still apply to every recipe they never touched, including one unmarked on purpose.
 */
export class RecipeFavouriteStore {
  readonly #all: StatementSync;
  readonly #set: StatementSync;

  constructor(db: DatabaseSync) {
    this.#all = db.prepare('SELECT recipe, favourite FROM recipe_favourite');
    this.#set = db.prepare(
      `INSERT INTO recipe_favourite (recipe, favourite) VALUES (?, ?)
       ON CONFLICT (recipe) DO UPDATE SET favourite = excluded.favourite`,
    );
  }

  choices(): Map<string, boolean> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- this store's own STRICT table
    const rows = this.#all.all() as { recipe: string; favourite: number }[];
    return new Map(rows.map((row) => [row.recipe, row.favourite !== 0]));
  }

  set(recipe: string, favourite: boolean): void {
    this.#set.run(recipe, favourite ? 1 : 0);
  }
}
