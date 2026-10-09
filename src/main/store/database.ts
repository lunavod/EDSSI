import { DatabaseSync } from 'node:sqlite';

/**
 * Schema changes, in order. `PRAGMA user_version` counts how many a database has had applied.
 * Never edit one that has shipped; add another.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE nav_route (
    id INTEGER PRIMARY KEY,
    plotted_at TEXT NOT NULL UNIQUE,
    cleared_at TEXT
  ) STRICT;

  CREATE TABLE nav_route_system (
    route_id INTEGER NOT NULL REFERENCES nav_route (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    system_address INTEGER NOT NULL,
    name TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL,
    star_class TEXT NOT NULL,
    PRIMARY KEY (route_id, position)
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX nav_route_system_by_address ON nav_route_system (system_address);
  `,
  `
  CREATE TABLE upload_cursor (
    target TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    event_index INTEGER NOT NULL
  ) STRICT;
  `,
  `
  CREATE TABLE upload_log (
    id INTEGER PRIMARY KEY,
    target TEXT NOT NULL,
    source TEXT NOT NULL,
    at TEXT NOT NULL,
    first_event TEXT NOT NULL,
    last_event TEXT NOT NULL,
    events INTEGER NOT NULL,
    accepted INTEGER,
    skipped INTEGER,
    outcome TEXT NOT NULL,
    message TEXT,
    detail TEXT NOT NULL
  ) STRICT;
  `,
  `
  CREATE TABLE recipe_favourite (
    recipe TEXT PRIMARY KEY,
    favourite INTEGER NOT NULL
  ) STRICT;
  `,
  `
  CREATE TABLE body_record (
    commander TEXT NOT NULL,
    category TEXT NOT NULL,
    body_class TEXT NOT NULL,
    value REAL NOT NULL,
    body_name TEXT NOT NULL,
    system_name TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    PRIMARY KEY (commander, category, body_class)
  ) STRICT, WITHOUT ROWID;
  `,
  `
  CREATE TABLE csv_route (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    route TEXT NOT NULL,
    position INTEGER
  ) STRICT;
  `,
  `
  CREATE TABLE shopping_item (
    position INTEGER PRIMARY KEY,
    commodity TEXT NOT NULL,
    needed INTEGER NOT NULL,
    bought INTEGER NOT NULL
  ) STRICT;
  `,
  `
  CREATE TABLE pinned_plan (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    plan TEXT NOT NULL
  ) STRICT;
  `,
  `
  CREATE TABLE crafting_todo (
    position INTEGER PRIMARY KEY,
    todo TEXT NOT NULL
  ) STRICT;
  `,
  `
  CREATE TABLE saved_route (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    route TEXT NOT NULL,
    position INTEGER,
    saved_at TEXT NOT NULL
  ) STRICT;
  `,
];

/** Opens EDSSI's own database (creating it if needed) and brings its schema up to date. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/** Runs `fn` in a transaction: all of its writes happen, or none do. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function migrate(db: DatabaseSync): void {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the pragma always returns this row.
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  if (version > MIGRATIONS.length) {
    throw new Error(
      `The database has schema version ${version}, newer than this EDSSI knows (${MIGRATIONS.length})`,
    );
  }
  for (const [index, sql] of MIGRATIONS.entries()) {
    if (index < version) continue;
    transaction(db, () => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${index + 1}`);
    });
  }
}
