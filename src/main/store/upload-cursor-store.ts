import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { UploadTarget } from '../../shared/uploads';
import type { JournalPosition } from '../uploads/batcher';

/**
 * How far into the journal each upload has got, so a restart neither sends the session again nor
 * forgets what was still waiting when EDSSI closed.
 */
export class UploadCursorStore {
  readonly #get: StatementSync;
  readonly #set: StatementSync;

  constructor(db: DatabaseSync) {
    this.#get = db.prepare('SELECT timestamp, event_index FROM upload_cursor WHERE target = ?');
    this.#set = db.prepare(
      `INSERT INTO upload_cursor (target, timestamp, event_index) VALUES (?, ?, ?)
       ON CONFLICT (target) DO UPDATE SET timestamp = excluded.timestamp,
         event_index = excluded.event_index`,
    );
  }

  get(target: UploadTarget): JournalPosition | undefined {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- this store's own STRICT table
    const row = this.#get.get(target) as { timestamp: string; event_index: number } | undefined;
    return row && { timestamp: row.timestamp, index: row.event_index };
  }

  set(target: UploadTarget, position: JournalPosition): void {
    this.#set.run(target, position.timestamp, position.index);
  }
}
