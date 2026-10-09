import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from './database';
import { PinnedPlanStore, ShoppingListStore } from './shopping-list-store';

describe('ShoppingListStore', () => {
  let db: DatabaseSync;
  let store: ShoppingListStore;
  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new ShoppingListStore(db);
  });
  afterEach(() => db.close());

  it('keeps the list in its order, replacing it whole', () => {
    expect(store.load()).toEqual([]);
    store.save([
      { id: 'a', commodity: 'Steel', needed: 500, bought: 20 },
      { id: 'b', commodity: 'Aluminium', needed: 300, bought: 0 },
    ]);
    expect(store.load()).toEqual([
      { commodity: 'Steel', needed: 500, bought: 20 },
      { commodity: 'Aluminium', needed: 300, bought: 0 },
    ]);
    store.save([{ id: 'c', commodity: 'Water', needed: 10, bought: 10 }]);
    expect(store.load()).toEqual([{ commodity: 'Water', needed: 10, bought: 10 }]);
  });
});

describe('PinnedPlanStore', () => {
  it('keeps one pinned plan until it is cleared', () => {
    const db = openDatabase(':memory:');
    const store = new PinnedPlanStore(db);
    const pinned = {
      plan: { kind: 'cheapest' as const, stops: [], tonnes: 0, cost: 0, travelLy: 0, short: [] },
      title: 'Cheapest',
      reference: 'Sol',
      pinnedAt: '2026-09-28T10:00:00Z',
    };
    expect(store.load()).toBeUndefined();
    store.save(pinned);
    store.save({ ...pinned, title: 'Other' });
    expect(store.load()).toEqual({ ...pinned, title: 'Other' });
    store.clear();
    expect(store.load()).toBeUndefined();
    db.close();
  });
});
