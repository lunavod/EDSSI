import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { openDatabase } from './database';

async function tempDatabasePath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'edssi-db-')), 'edssi.db');
}

describe('openDatabase', () => {
  it('creates the schema once and keeps data across reopening', async () => {
    const path = await tempDatabasePath();
    const first = openDatabase(path);
    first.prepare("INSERT INTO nav_route (plotted_at) VALUES ('2026-09-10T10:00:00Z')").run();
    first.close();

    const second = openDatabase(path);
    expect(second.prepare('SELECT plotted_at FROM nav_route').all()).toEqual([
      { plotted_at: '2026-09-10T10:00:00Z' },
    ]);
    second.close();
  });

  it('refuses a database from a newer EDSSI', async () => {
    const path = await tempDatabasePath();
    const future = new DatabaseSync(path);
    future.exec('PRAGMA user_version = 999');
    future.close();

    expect(() => openDatabase(path)).toThrow(/schema version 999/);
  });
});
