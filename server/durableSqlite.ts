import { AppDatabase, type Row, type SqlDriver, type SqlValue } from './database';

// The database inside the tree's Durable Object: its own SQLite (ctx.storage.sql), synchronous like
// node:sqlite. Only the shape of SqlStorage this needs, so this file compiles without the Workers types.
export interface SqlStorageLike {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): unknown[] };
}

export function openDurableDatabase(sql: SqlStorageLike, label: string): AppDatabase {
  const driver: SqlDriver = {
    path: label,
    exec: (query) => void sql.exec(query),
    all: (query, ...params) => sql.exec(query, ...params).toArray() as Row[],
    close: () => {}, // the object's storage closes itself
  };
  return new AppDatabase(driver);
}
