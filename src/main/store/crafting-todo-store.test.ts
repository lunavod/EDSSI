import { describe, expect, it } from 'vitest';

import type { CraftingTodo } from '../../shared/crafting';
import { CraftingTodoStore } from './crafting-todo-store';
import { openDatabase } from './database';

describe('CraftingTodoStore', () => {
  it('keeps the to-dos in order', () => {
    const store = new CraftingTodoStore(openDatabase(':memory:'));
    expect(store.load()).toEqual([]);
    const todos: CraftingTodo[] = [
      {
        id: 'b',
        kind: 'blueprint',
        blueprint: 'engineering:fsd_longrange:frame-shift-drive',
        from: 0,
        to: 5,
        targetRolls: 2,
      },
      { id: 'a', kind: 'synthesis', synthesis: 'Limpets', counts: [4, 0, 0] },
    ];
    store.save(todos);
    expect(store.load()).toEqual(todos);
  });

  it('drops a to-do whose recipe has gone', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT INTO crafting_todo (position, todo) VALUES (0, ?), (1, ?)').run(
      JSON.stringify({ id: 'x', kind: 'synthesis', synthesis: 'Nothing', counts: [1, 0, 0] }),
      'not json',
    );
    expect(new CraftingTodoStore(db).load()).toEqual([]);
  });
});
