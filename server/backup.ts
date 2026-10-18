import { type BackupCursor, type DatabaseDump, GROWING_TABLES, type Row } from './database';
import type { AppDatabase } from './database';

// Nightly backups of a tree (docs/HOSTING.md, "Backups"). A series starts with a complete backup; each next one
// holds the growing tables' rows added since the previous one (by id, so a reading stored late, e.g. from the
// device's buffer, is still caught) and the small tables and the memories whole. assemble() turns a series back
// into one full dump, which POST /api/admin/restore (npm run cf:migrate -- migrate --file …) takes like any other.
// Platform-free: the Durable Object stores them in KV (worker/index.ts); tests run it on node:sqlite.

export interface NightlyBackup extends DatabaseDump {
  treeId: string;
  series: number; // when the series started (its first, complete backup): a restore starts a new one
  seq: number; // 1, 2, 3… within the series
  createdAt: number;
  after: BackupCursor | null; // what the previous backup had already (null: complete, seq 1)
  cursor: BackupCursor; // what this one has, up to
}

// Where the last stored backup ended. In meta, but never in a dump (dumpDatabase leaves it out) and cleared by a
// restore, so a tree restored from anything starts a new series.
export const BACKUP_STATE_KEY = 'backup_state';
interface BackupState {
  series: number;
  seq: number;
  cursor: BackupCursor;
  at: number;
}

const highest = (rows: Row[], before: number) => rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), before);

export function lastBackupAt(db: AppDatabase): number | null {
  return db.getMeta<BackupState>(BACKUP_STATE_KEY)?.at ?? null;
}

// Where a backup is kept: one series per folder, in order
export const backupKey = (b: Pick<NightlyBackup, 'treeId' | 'series' | 'seq'>) => `backup/${b.treeId}/${b.series}/${String(b.seq).padStart(6, '0')}`;

// The next backup's contents. Call backupSaved() once it is stored, so the next one starts after it.
export function nextBackup(db: AppDatabase, now: number): NightlyBackup {
  const state = db.getMeta<BackupState>(BACKUP_STATE_KEY);
  const after = state?.cursor ?? null;
  const dump = db.dump(after ?? undefined);
  const cursor = Object.fromEntries(GROWING_TABLES.map((t) => [t, highest(dump.tables[t], after?.[t] ?? 0)])) as BackupCursor;
  return { ...dump, treeId: db.tree().id, series: state?.series ?? now, seq: (state?.seq ?? 0) + 1, createdAt: now, after, cursor };
}

export function backupSaved(db: AppDatabase, backup: NightlyBackup) {
  db.setMeta(BACKUP_STATE_KEY, { series: backup.series, seq: backup.seq, cursor: backup.cursor, at: backup.createdAt } satisfies BackupState);
}

// One series of nightly backups (any order) → one full dump. Refuses a gap: they must run 1, 2, 3…, each
// starting where the one before ended.
export function assemble(backups: NightlyBackup[]): DatabaseDump {
  const chain = [...backups].sort((a, b) => a.seq - b.seq);
  if (!chain.length) throw new Error('No backups');
  if (new Set(chain.map((b) => `${b.treeId}/${b.series}`)).size > 1) throw new Error('These backups are from more than one series');
  chain.forEach((b, i) => {
    if (b.seq !== i + 1) throw new Error(`Backup ${i + 1} is missing`);
    const expected = i === 0 ? null : chain[i - 1].cursor;
    if (JSON.stringify(b.after) !== JSON.stringify(expected)) throw new Error(`Backup ${b.seq} doesn't start where backup ${i} ended`);
  });
  const last = chain[chain.length - 1];
  const tables = { ...last.tables };
  for (const t of GROWING_TABLES) {
    const byId = new Map<number, Row>();
    for (const b of chain) for (const r of b.tables[t]) byId.set(Number(r.id), r);
    tables[t] = [...byId.values()].sort((a, b) => a.id - b.id);
  }
  return { schemaVersion: last.schemaVersion, tables, meta: last.meta };
}
