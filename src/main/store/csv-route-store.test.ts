import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CsvRoute } from '../../shared/csv-route';
import { CsvRouteStore } from './csv-route-store';
import { openDatabase } from './database';

const route: CsvRoute = {
  fileName: 'route.csv',
  loadedAt: '2026-09-23T20:00:00Z',
  columns: ['Distance'],
  systems: [
    { name: 'Sol', values: ['0'] },
    { name: 'Barnard', values: ['5.9'] },
  ],
};

describe('CsvRouteStore', () => {
  let db: DatabaseSync;
  let store: CsvRouteStore;
  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new CsvRouteStore(db);
  });
  afterEach(() => db.close());

  it('keeps one route and its position', () => {
    expect(store.load()).toBeUndefined();
    store.save(route, undefined);
    expect(store.load()).toEqual({ route, position: undefined });
    store.setPosition(1);
    expect(store.load()?.position).toBe(1);
    store.save({ ...route, fileName: 'other.csv' }, 0);
    expect(store.load()).toEqual({ route: { ...route, fileName: 'other.csv' }, position: 0 });
    store.clear();
    expect(store.load()).toBeUndefined();
  });
});
