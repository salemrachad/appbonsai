import { AppDatabase, type Row, type SqlDriver, type SqlValue } from './database';

// The database inside the tree's Durable Object: its own SQLite (ctx.storage.sql), synchronous like
// node:sqlite. Only the shape of the storage this needs, so this file compiles without the Workers types.
export interface DurableStorageLike {
  sql: { exec(query: string, ...bindings: SqlValue[]): { toArray(): unknown[] } };
  transactionSync<T>(fn: () => T): T;
}

export function openDurableDatabase(storage: DurableStorageLike, label: string): AppDatabase {
  const driver: SqlDriver = {
    path: label,
    exec: (query) => void storage.sql.exec(query),
    all: (query, ...params) => storage.sql.exec(query, ...params).toArray() as Row[],
    transaction: (fn) => storage.transactionSync(fn), // BEGIN/COMMIT statements aren't allowed there
    close: () => {}, // the object's storage closes itself
  };
  return new AppDatabase(driver);
}
