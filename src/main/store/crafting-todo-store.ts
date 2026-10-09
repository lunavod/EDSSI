import type { DatabaseSync, StatementSync } from 'node:sqlite';

import { type CraftingTodo, sanitizeTodo } from '../../shared/crafting';
import { transaction } from './database';

/**
 * The Materials tab's to-do lists, blueprints and syntheses together, in their order, each as
 * JSON. A row that no longer checks out (a recipe gone from the tables) is dropped on reading.
 */
export class CraftingTodoStore {
  readonly #db: DatabaseSync;
  readonly #all: StatementSync;
  readonly #clear: StatementSync;
  readonly #insert: StatementSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#all = db.prepare('SELECT todo FROM crafting_todo ORDER BY position');
    this.#clear = db.prepare('DELETE FROM crafting_todo');
    this.#insert = db.prepare('INSERT INTO crafting_todo (position, todo) VALUES (?, ?)');
  }

  load(): CraftingTodo[] {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- this store's own STRICT table
    const rows = this.#all.all() as { todo: string }[];
    return rows.flatMap((row, index) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.todo);
      } catch {
        return [];
      }
      const todo = sanitizeTodo(parsed);
      const id = typeof parsed === 'object' && parsed !== null && Reflect.get(parsed, 'id');
      return todo ? [{ ...todo, id: typeof id === 'string' ? id : `todo-${index}` }] : [];
    });
  }

  save(todos: readonly CraftingTodo[]): void {
    transaction(this.#db, () => {
      this.#clear.run();
      for (const [position, todo] of todos.entries()) {
        this.#insert.run(position, JSON.stringify(todo));
      }
    });
  }
}
