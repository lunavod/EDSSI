import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { RefusedEvent, UploadLogEntry } from '../../shared/uploads';
import type { NewUploadLogEntry } from '../uploads/log';

/** Requests beyond this many are forgotten, oldest first. A long session is a few hundred. */
const KEEP = 5_000;

interface Row {
  id: number;
  target: string;
  source: string;
  at: string;
  first_event: string;
  last_event: string;
  events: number;
  accepted: number | null;
  skipped: number | null;
  outcome: string;
  message: string | null;
  detail: string;
}

interface Detail {
  eventCounts: Record<string, number>;
  systems: string[];
  refused: RefusedEvent[];
}

/**
 * Every request made to EDSM, Inara and EDDN, by the live upload or the send-session script, so the
 * commander can see what actually went and what the service said about it.
 */
export class UploadLogStore {
  readonly #insert: StatementSync;
  readonly #prune: StatementSync;
  readonly #recent: StatementSync;
  readonly #firstLive: StatementSync;

  constructor(db: DatabaseSync) {
    this.#insert = db.prepare(
      `INSERT INTO upload_log
         (target, source, at, first_event, last_event, events, accepted, skipped, outcome,
          message, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.#prune = db.prepare('DELETE FROM upload_log WHERE id <= ?');
    this.#recent = db.prepare('SELECT * FROM upload_log ORDER BY id DESC LIMIT ?');
    this.#firstLive = db.prepare(
      `SELECT min(first_event) AS first FROM upload_log
       WHERE target = ? AND source = 'live' AND outcome = 'sent'`,
    );
  }

  add(entry: NewUploadLogEntry): void {
    const detail: Detail = {
      eventCounts: entry.eventCounts,
      systems: entry.systems,
      refused: entry.refused,
    };
    const { lastInsertRowid } = this.#insert.run(
      entry.target,
      entry.source,
      entry.at,
      entry.firstEvent,
      entry.lastEvent,
      entry.events,
      entry.accepted ?? null,
      entry.skipped ?? null,
      entry.outcome,
      entry.message ?? null,
      JSON.stringify(detail),
    );
    const id = Number(lastInsertRowid);
    if (id > KEEP) this.#prune.run(id - KEEP);
  }

  /** The journal time of the oldest event the live upload has sent to `target`, if any. */
  firstLiveEvent(target: UploadLogEntry['target']): string | undefined {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an aggregate over this table
    const row = this.#firstLive.get(target) as { first: string | null } | undefined;
    return row?.first ?? undefined;
  }

  /** Newest first. */
  recent(limit: number): UploadLogEntry[] {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- this store's own STRICT table
    const rows = this.#recent.all(limit) as unknown as Row[];
    return rows.map((row) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by add() above
      const detail = JSON.parse(row.detail) as Detail;
      return {
        id: row.id,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by add() above
        target: row.target as UploadLogEntry['target'],
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by add() above
        source: row.source as UploadLogEntry['source'],
        at: row.at,
        firstEvent: row.first_event,
        lastEvent: row.last_event,
        events: row.events,
        eventCounts: detail.eventCounts,
        systems: detail.systems,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by add() above
        outcome: row.outcome as UploadLogEntry['outcome'],
        accepted: row.accepted ?? undefined,
        skipped: row.skipped ?? undefined,
        message: row.message ?? undefined,
        refused: detail.refused,
      };
    });
  }
}
