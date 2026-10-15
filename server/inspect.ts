import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { APP_CONFIG } from '../src/config/appConfig';

// npm run db:inspect — a quick look inside data/appbonsai.db (read-only; safe while the server runs).
const file = path.resolve(process.env.APPBONSAI_DB ?? APP_CONFIG.server.dbPath);
const db = new DatabaseSync(file, { readOnly: true });
const t = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '–');

console.log(`\n${file}\n`);
for (const table of ['telemetry', 'plant_events', 'behaviour_episodes']) {
  const r = db.prepare(`SELECT COUNT(*) AS n, MIN(${table === 'behaviour_episodes' ? 'started_at' : 'timestamp'}) AS first FROM ${table}`).get() as any;
  console.log(`${table.padEnd(20)} ${String(r.n).padStart(7)} rows   since ${t(r.first)}`);
}

console.log('\nLatest readings');
console.table(
  (db.prepare('SELECT * FROM telemetry ORDER BY timestamp DESC LIMIT 8').all() as any[]).map((r) => ({
    time: t(r.timestamp),
    source: r.source,
    soil: r.soil_moisture,
    raw: r.soil_raw,
    temp: r.temperature,
    hum: r.humidity,
    light: r.light_percent,
    quality: r.data_quality,
  }))
);

console.log('Episodes (newest first)');
console.table(
  (db.prepare('SELECT * FROM behaviour_episodes ORDER BY started_at DESC LIMIT 10').all() as any[]).map((r) => ({
    started: t(r.started_at),
    ended: r.ended_at ? t(r.ended_at) : 'ongoing',
    condition: r.condition,
    modifiers: r.modifiers_json,
    peak: r.peak_severity,
  }))
);

console.log('Care events (newest first)');
console.table(
  (db.prepare('SELECT * FROM plant_events ORDER BY timestamp DESC LIMIT 10').all() as any[]).map((r) => ({
    time: t(r.timestamp),
    type: r.type,
    note: r.note,
    metadata: r.metadata_json,
  }))
);

// Attention (petting sessions), separate from care; absent in databases older than schema 4
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'interactions'").get()) {
  console.log('Attention sessions (newest first)');
  console.table(
    (db.prepare('SELECT * FROM interactions ORDER BY started_at DESC LIMIT 10').all() as any[]).map((r) => ({
      started: t(r.started_at),
      minutes: Math.round(((r.ended_at - r.started_at) / 60000) * 10) / 10,
      kind: r.kind,
      count: r.count,
      metadata: r.metadata_json,
    }))
  );
}
db.close();
