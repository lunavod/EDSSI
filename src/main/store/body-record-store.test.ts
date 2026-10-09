import { describe, expect, it } from 'vitest';

import type { BodyRecord } from '../records/personal-bests';
import { BodyRecordStore } from './body-record-store';
import { openDatabase } from './database';

const record = (value: number, bodyName: string): BodyRecord => ({
  commander: 'F123',
  category: 'largest',
  bodyClass: 'Water world',
  value,
  bodyName,
  systemName: 'Sol',
  timestamp: '2026-09-10T10:00:00Z',
});

describe('BodyRecordStore', () => {
  it('keeps the latest best per commander, category and class', () => {
    const db = openDatabase(':memory:');
    const store = new BodyRecordStore(db);
    expect(store.all()).toEqual([]);

    store.save([record(5_000_000, 'Sol 1')]);
    store.save([record(6_000_000, 'Sol 2'), { ...record(1, 'Sol 3'), category: 'smallest' }]);

    expect(store.all()).toEqual(
      expect.arrayContaining([
        record(6_000_000, 'Sol 2'),
        { ...record(1, 'Sol 3'), category: 'smallest' },
      ]),
    );
    expect(store.all()).toHaveLength(2);
    db.close();
  });
});
