import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CsvRoute } from '../../shared/csv-route';
import { openDatabase } from './database';
import { SavedRouteStore } from './saved-route-store';

const route: CsvRoute = {
  fileName: 'carrier.csv',
  loadedAt: '2026-09-23T20:00:00Z',
  columns: ['Distance'],
  systems: [
    { name: 'Sol', values: ['0'] },
    { name: 'Barnard', values: ['5.9'] },
    { name: 'Ross', values: ['4.1'] },
  ],
};
const at = '2026-09-30T12:00:00Z';

describe('SavedRouteStore', () => {
  let db: DatabaseSync;
  let store: SavedRouteStore;
  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new SavedRouteStore(db);
  });
  afterEach(() => db.close());

  it('saves routes under names, and lists them without their systems', () => {
    const carrier = store.save('Carrier to Colonia', { ...route, savedId: 9 }, 1, at);
    const survey = store.save('Survey', { ...route, fileName: 'survey.csv' }, undefined, at);
    expect(store.list()).toEqual([
      {
        id: carrier,
        name: 'Carrier to Colonia',
        fileName: 'carrier.csv',
        systems: 3,
        position: 1,
        savedAt: at,
      },
      { id: survey, name: 'Survey', fileName: 'survey.csv', systems: 3, savedAt: at },
    ]);
    // The id is the row's, never kept inside it.
    expect(store.get(carrier)).toEqual({ route, position: 1 });
  });

  it('replaces a route saved under the same name, whatever its case', () => {
    const first = store.save('Survey', route, 0, at);
    const second = store.save('survey', { ...route, fileName: 'other.csv' }, 2, at);
    expect(second).toBe(first);
    expect(store.list()).toMatchObject([{ id: first, fileName: 'other.csv', position: 2 }]);
  });

  it('keeps a saved route up to date, renames it and deletes it', () => {
    const id = store.save('Carrier', route, undefined, at);
    const other = store.save('Survey', route, undefined, at);
    store.update(id, { ...route, fileName: 'moved.csv' }, 2);
    expect(store.get(id)).toEqual({ route: { ...route, fileName: 'moved.csv' }, position: 2 });
    expect(store.rename(id, 'SURVEY')).toBe(false);
    expect(store.rename(id, 'Long haul')).toBe(true);
    expect(store.list().map((entry) => entry.name)).toEqual(['Long haul', 'Survey']);
    store.delete(other);
    expect(store.get(other)).toBeUndefined();
    expect(store.list()).toHaveLength(1);
  });
});
