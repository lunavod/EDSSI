import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { BodyRecord, RecordCategory } from '../records/personal-bests';
import { transaction } from './database';

interface Row {
  commander: string;
  category: string;
  body_class: string;
  value: number;
  body_name: string;
  system_name: string;
  timestamp: string;
}

/**
 * The commander's personal bests, so they outlast the journals they came from. The whole history
 * is replayed at every start, so this only matters once older journals are gone.
 */
export class BodyRecordStore {
  readonly #db: DatabaseSync;
  readonly #all: StatementSync;
  readonly #save: StatementSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#all = db.prepare(
      'SELECT commander, category, body_class, value, body_name, system_name, timestamp FROM body_record',
    );
    this.#save = db.prepare(
      `INSERT INTO body_record
         (commander, category, body_class, value, body_name, system_name, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (commander, category, body_class) DO UPDATE SET
         value = excluded.value,
         body_name = excluded.body_name,
         system_name = excluded.system_name,
         timestamp = excluded.timestamp`,
    );
  }

  all(): BodyRecord[] {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- this store's own STRICT table
    const rows = this.#all.all() as unknown as Row[];
    return rows.map((row) => ({
      commander: row.commander,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only this store writes it
      category: row.category as RecordCategory,
      bodyClass: row.body_class,
      value: row.value,
      bodyName: row.body_name,
      systemName: row.system_name,
      timestamp: row.timestamp,
    }));
  }

  save(records: readonly BodyRecord[]): void {
    if (records.length === 0) return;
    transaction(this.#db, () => {
      for (const record of records) {
        this.#save.run(
          record.commander,
          record.category,
          record.bodyClass,
          record.value,
          record.bodyName,
          record.systemName,
          record.timestamp,
        );
      }
    });
  }
}
