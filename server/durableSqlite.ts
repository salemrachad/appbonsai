import { AppDatabase, type Row, type SqlDriver, type SqlValue } from './database';

// The database inside the tree's Durable Object: its own SQLite (ctx.storage.sql), synchronous like
// node:sqlite. Only the shape of the storage this needs, so this file compiles without the Workers types.
export interface DurableStorageLike {
  sql: { exec(query: string, ...bindings: SqlValue[]): { toArray(): unknown[]; readonly rowsRead?: number } };
  transactionSync<T>(fn: () => T): T;
}

export function openDurableDatabase(storage: DurableStorageLike, label: string): AppDatabase {
  // Rows read, as the storage counts and bills them (a COUNT(*) reads its whole table though it returns one row)
  let rowsRead = 0;
  const driver: SqlDriver = {
    path: label,
    exec: (query) => void storage.sql.exec(query),
    all: (query, ...params) => {
      const cursor = storage.sql.exec(query, ...params);
      const rows = cursor.toArray() as Row[];
      rowsRead += cursor.rowsRead ?? rows.length;
      return rows;
    },
    rowsRead: () => rowsRead,
    transaction: (fn) => storage.transactionSync(fn), // BEGIN/COMMIT statements aren't allowed there
    close: () => {}, // the object's storage closes itself
  };
  return new AppDatabase(driver);
}
