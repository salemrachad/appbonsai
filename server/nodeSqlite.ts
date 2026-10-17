import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { AppDatabase, type Row, type SqlDriver, type SqlValue } from './database';

// The database on the laptop: node:sqlite (built into Node 22.5+, no native build step), in WAL mode so
// npm run device / db:inspect can open it while the server runs. ':memory:' gives a throwaway one (tests).
export function openDatabase(dbPath: string): AppDatabase {
  return new AppDatabase(nodeSqliteDriver(dbPath));
}

export function nodeSqliteDriver(dbPath: string): SqlDriver {
  const memory = dbPath === ':memory:';
  const file = memory ? dbPath : path.resolve(dbPath);
  if (!memory) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');

  // Compile each SQL statement once and reuse it (prepare() on every call was a noticeable share of a poll)
  const statements = new Map<string, StatementSync>();
  const prepare = (sql: string) => {
    let st = statements.get(sql);
    if (!st) statements.set(sql, (st = db.prepare(sql)));
    return st;
  };

  return {
    path: file,
    exec: (sql) => db.exec(sql),
    all: (sql: string, ...params: SqlValue[]) => prepare(sql).all(...params) as Row[],
    close: () => db.close(),
  };
}
